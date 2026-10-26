"""Regression coverage for UID persistence using an in-memory SQL database.

Run: python -m unittest discover -s tests/unit -p 'test_*.py'
"""

import ast
import json
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from utils.achievements import importer
from utils.hoyolab import database
from utils.web import auth


class Result:
    def __init__(self, cursor):
        self.cursor = cursor
        self.rowcount = cursor.rowcount

    async def fetchone(self):
        row = self.cursor.fetchone()
        if row is None:
            return None
        result = dict(row)
        if "expires_at" in result:
            result["created_at"] = datetime.fromisoformat(result["created_at"])
            result["expires_at"] = datetime.fromisoformat(result["expires_at"])
        return result

    async def fetchall(self):
        return [dict(row) for row in self.cursor.fetchall()]


class Connection:
    def __init__(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.create_function("GREATEST", -1, max)
        self.db.create_function("LEAST", -1, min)
        self.db.create_function("jsonb_array_length", 1, lambda value: len(json.loads(value)))
        self.db.executescript("""
            PRAGMA foreign_keys = ON;
            CREATE TABLE accounts (id INTEGER PRIMARY KEY, discord_user_id INTEGER, genshin_uid TEXT, genshin_server TEXT DEFAULT 'os_euro');
            CREATE TABLE game_data_accounts (
                id INTEGER PRIMARY KEY, discord_user_id INTEGER, genshin_uid TEXT,
                UNIQUE(discord_user_id, genshin_uid));
            CREATE TABLE achievement_progress (
                discord_user_id INTEGER, account_id INTEGER REFERENCES game_data_accounts(id),
                achievement_id TEXT, tier INTEGER, completed BOOLEAN, current INTEGER,
                completed_at TEXT, note TEXT, updated_at TEXT);
            CREATE UNIQUE INDEX progress_unique ON achievement_progress
                (discord_user_id, account_id, achievement_id, tier) WHERE account_id IS NOT NULL;
            CREATE TABLE wish_history (
                account_id INTEGER REFERENCES game_data_accounts(id), wish_id TEXT,
                genshin_uid TEXT, gacha_type TEXT, item_name TEXT, item_type TEXT,
                rank_type INTEGER, icon_url TEXT, pulled_at TEXT,
                PRIMARY KEY(account_id, wish_id));
            INSERT INTO accounts (id, discord_user_id, genshin_uid) VALUES
                (1, 10, '700000001'), (2, 10, '700000002'), (3, 20, '700000001');
        """)

    async def execute(self, query, params=()):
        query = query.replace("%s", "?").replace("NOW()", "CURRENT_TIMESTAMP")
        params = tuple(
            json.dumps(value.obj) if isinstance(value, database.Jsonb) else value
            for value in params
        )
        query = query.replace("(xmax = 0) AS inserted", "1 AS inserted").replace("::integer", "")
        return Result(self.db.execute(query, params))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def connection(self):
        return self


class UIDPersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_progress_survives_unlink_relink_and_remains_isolated(self):
        connection = Connection()
        self.addCleanup(connection.db.close)
        with patch.object(database, "get_pool", return_value=connection):
            await database.import_achievement_progress(
                10,
                1,
                {
                    "100": {"tiers": {"1": {"completed": True, "current": 5}}},
                },
            )
            await database.update_achievement_tier_note(10, 1, "100", 1, "Saved note")
            await database.import_wish_history(
                1,
                [
                    {
                        "id": "123",
                        "uid": "700000001",
                        "gacha_type": "301",
                        "name": "Test",
                        "item_type": "Character",
                        "rank_type": 5,
                        "pulled_at": "2026-10-26 12:00:00",
                    }
                ],
            )
            connection.db.execute("DELETE FROM accounts WHERE id = 1")
            connection.db.execute(
                "INSERT INTO accounts (id, discord_user_id, genshin_uid) VALUES (4, 10, '700000001')"
            )
            progress = await database.get_achievement_progress(10, 4)
            self.assertEqual(progress[0]["current"], 5)
            self.assertEqual(progress[0]["note"], "Saved note")
            self.assertEqual(len(await database.get_wish_history(4)), 1)
            for user, account in [(10, 2), (20, 3)]:
                self.assertEqual(await database.get_achievement_progress(user, account), [])
                self.assertEqual(await database.get_wish_history(account), [])
            await database.update_achievement_tier(10, 4, "100", 1, current=6)
            await database.update_achievement_tier_note(10, 4, "101", 1, "New note")
            self.assertEqual(
                (await database.get_achievement_tier_progress(10, 4, "100", 1))["current"], 6
            )
            self.assertEqual(
                (await database.get_achievement_tier_progress(10, 4, "101", 1))["note"], "New note"
            )

    async def test_import_survives_website_logout_login(self):
        connection = Connection()
        self.addCleanup(connection.db.close)
        connection.db.execute(
            "CREATE TABLE web_sessions (token TEXT, discord_user_id INTEGER, created_at TEXT, expires_at TEXT)"
        )
        catalogue = [{"id": [100], "stages": 1, "stage1": {"progress": 5}}]
        with tempfile.TemporaryDirectory() as folder:
            export = Path(folder) / "achievements.json"
            export.write_text(json.dumps({"list": [{"id": 100, "status": 3, "current": 5}]}))
            with (
                patch.object(database, "get_pool", return_value=connection),
                patch.object(auth, "get_pool", return_value=connection),
                patch.object(importer, "load_achievements", return_value=catalogue),
            ):
                first_session = await auth.create_web_session(10)
                result = await importer.import_achievements(first_session.user_id, 1, export)
                self.assertEqual(result["matched"], 1)
                await auth.delete_web_session(first_session.token)
                self.assertIsNone(await auth.get_web_session(first_session.token))
                second_session = await auth.create_web_session(10)
                restored = await auth.get_web_session(second_session.token)
                rows = await database.get_achievement_progress(restored.user_id, 1)
                self.assertEqual(rows[0]["current"], 5)
                self.assertTrue(rows[0]["completed"])

    async def test_custom_event_and_objectives_survive_relink(self):
        connection = Connection()
        self.addCleanup(connection.db.close)
        # Exercise the production event schema, including its identity CHECK.
        tree = ast.parse(Path(database.__file__).read_text())
        schema = next(
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and "CREATE TABLE IF NOT EXISTS custom_events (" in node.value
        )
        schema = schema.replace(
            "BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT"
        )
        schema = schema.replace("::jsonb", "").replace("NOW()", "CURRENT_TIMESTAMP")
        connection.db.executescript(schema)
        connection.db.executescript("""
            ALTER TABLE custom_events ADD COLUMN icon_url TEXT;
            ALTER TABLE custom_events ADD COLUMN sort_order INTEGER;
            CREATE TABLE custom_event_account_order (
                discord_user_id INTEGER, account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
                event_id INTEGER REFERENCES custom_events(id) ON DELETE CASCADE, sort_order INTEGER,
                PRIMARY KEY(discord_user_id, account_id, event_id));
            CREATE TABLE custom_event_progress (
                event_id INTEGER REFERENCES custom_events(id) ON DELETE CASCADE,
                discord_user_id INTEGER, account_id INTEGER, objective_index INTEGER,
                current INTEGER, genshin_uid TEXT, genshin_server TEXT, updated_at TEXT);
            CREATE UNIQUE INDEX custom_progress_unique ON custom_event_progress
                (event_id, genshin_uid, genshin_server, objective_index)
                WHERE genshin_uid IS NOT NULL AND genshin_server IS NOT NULL;
            CREATE TABLE custom_event_completions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER REFERENCES custom_events(id) ON DELETE CASCADE,
                discord_user_id INTEGER, account_id INTEGER, genshin_uid TEXT,
                genshin_server TEXT, occurrence_start TEXT, completed BOOLEAN, completed_at TEXT);
            CREATE UNIQUE INDEX custom_completion_unique ON custom_event_completions
                (event_id, genshin_uid, genshin_server, occurrence_start)
                WHERE genshin_uid IS NOT NULL AND genshin_server IS NOT NULL;
        """)
        fields = dict(
            title="Reputation",
            description=None,
            account_scope="account",
            account_id=1,
            start_at="2026-10-26 12:00:00",
            end_at=None,
            recurrence={"type": "none"},
            colour="#7c83ff",
            reminder_minutes=None,
            progress=[{"target": 3}],
        )
        with patch.object(database, "get_pool", return_value=connection):
            event = await database.create_custom_event(10, **fields)
            self.assertEqual(
                await database.change_custom_event_account_progress(10, event["id"], 1, 0, 1, 3), 1
            )
            self.assertEqual(
                await database.change_custom_event_account_progress(10, event["id"], 1, 0, 1, 3), 2
            )
            self.assertTrue(
                await database.set_custom_event_completion(
                    10, event["id"], fields["start_at"], True, 1
                )
            )
            shared = await database.create_custom_event(
                10, **dict(fields, title="Shared", account_scope="all", account_id=None)
            )
            connection.db.execute("DELETE FROM accounts WHERE id = 1")
            self.assertIsNone(
                connection.db.execute(
                    "SELECT account_id FROM custom_events WHERE id = ?", (event["id"],)
                ).fetchone()[0]
            )
            connection.db.execute(
                "INSERT INTO accounts (id, discord_user_id, genshin_uid) VALUES (4, 10, '700000001')"
            )
            events = await database.get_custom_events(10, 4)
            self.assertEqual({row["id"] for row in events}, {event["id"], shared["id"]})
            self.assertEqual(
                next(row for row in events if row["id"] == event["id"])["account_id"], 4
            )
            self.assertEqual(
                await database.get_custom_event_account_progress(10, event["id"], 4), {0: 2}
            )
            self.assertEqual(
                len(await database.get_custom_event_completions(10, event["id"], 4)), 1
            )
            self.assertEqual(
                await database.change_custom_event_account_progress(10, event["id"], 4, 0, 1, 3), 3
            )
            self.assertIsNotNone(await database.get_visible_custom_event(10, event["id"], 4))
            self.assertIsNone(await database.get_visible_custom_event(10, event["id"], 2))
            self.assertEqual(
                [row["id"] for row in await database.get_custom_events(10, 2)], [shared["id"]]
            )
            await database.update_custom_event(
                10, event["id"], **dict(fields, account_id=4, title="Updated")
            )
            self.assertEqual((await database.get_custom_event(10, event["id"]))["title"], "Updated")


if __name__ == "__main__":
    unittest.main()
