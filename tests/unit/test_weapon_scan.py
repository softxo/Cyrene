import copy
import json
import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from tests.integration.legacy_uid_fixtures import migrate_weapon_scans
from utils.hoyolab import database
from utils.web import app as web
from utils.web.weapon_scan import validate_weapon_scan


def export(uid="700000001"):
    return {
        "format": "GOOD",
        "version": 3,
        "source": "Cyrene Scanner",
        "cyrene": {
            "uid": uid,
            "complete": True,
            "expected_count": 2,
            "scan_id": "d29f84a5-f5be-49cc-a710-e7e9d47c28aa",
        },
        "weapons": [
            {"key": "TheWidsith", "cyrene_id": 14402, "level": 70, "refinement": 2, "location": ""}
            for _ in range(2)
        ],
    }


class WeaponScanTests(unittest.IsolatedAsyncioTestCase):
    def test_identical_copies_are_preserved_and_server_identity_is_authoritative(self):
        scan = export()
        scan["weapons"][0]["icon"] = "javascript:bad"
        rows = validate_weapon_scan(scan, "700000001")["weapons"]
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]["scan_copy_id"], rows[1]["scan_copy_id"])
        self.assertEqual(rows[0]["name"], "The Widsith")
        self.assertTrue(rows[0]["icon"].startswith("https://"))

    def test_account_nickname_maps_to_traveler_for_new_and_saved_imports(self):
        from utils.web.weapon_scan import normalise_scan_character

        payload = export()
        payload["weapons"][0]["location"] = "melody"
        row = validate_weapon_scan(payload, "700000001", "melody")["weapons"][0]
        self.assertEqual(row["equipped"], "Traveler")
        self.assertIn("UI_AvatarIcon_Player", row["character_icon"])
        self.assertEqual(row["character_rarity"], 5)
        for nickname in ("AnotherAccount", "Stella", "旅人", "Étoile"):
            payload["weapons"][0]["location"] = nickname
            row = validate_weapon_scan(payload, "700000001", nickname)["weapons"][0]
            self.assertEqual(row["equipped"], "Traveler")
            self.assertEqual(row["character_rarity"], 5)
        saved = normalise_scan_character({"equipped": "melody", "scan_copy_id": "old:0"}, "melody")
        self.assertEqual(saved["equipped"], "Traveler")
        self.assertEqual(saved["scan_copy_id"], "old:0")

    async def test_imported_delete_is_owner_scoped_and_reports_missing_copy(self):
        with (
            patch.object(web, "_manual_weapon_owner", AsyncMock(return_value=10)),
            patch.object(database, "remove_scanned_weapon", AsyncMock(return_value=True)) as remove,
        ):
            self.assertEqual(await web.scanned_weapon_remove("scan:0", 1, "session"), {"ok": True})
            remove.assert_awaited_once_with(10, 1, "scan:0")
            remove.return_value = False
            with self.assertRaises(HTTPException) as error:
                await web.scanned_weapon_remove("scan:missing", 1, "session")
            self.assertEqual(error.exception.status_code, 404)

    def test_wrong_uid_partial_count_mismatch_and_invalid_progression_are_rejected(self):
        cases = []
        wrong = export("700000002")
        cases.append(wrong)
        partial = export()
        partial["cyrene"]["complete"] = False
        cases.append(partial)
        count = export()
        count["cyrene"]["expected_count"] = 3
        cases.append(count)
        for value in (0, 91, True, "70"):
            bad = export()
            bad["weapons"][0]["level"] = value
            cases.append(bad)
        bad = export()
        bad["weapons"][0]["refinement"] = 6
        cases.append(bad)
        bad = export()
        bad["weapons"][0]["cyrene_id"] = 12502
        cases.append(bad)
        for payload in cases:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate_weapon_scan(payload, "700000001")

    async def test_import_does_not_reach_storage_for_foreign_account(self):
        with (
            patch.object(
                web, "get_web_session", AsyncMock(return_value=SimpleNamespace(user_id=10))
            ),
            patch.object(web, "get_accounts", AsyncMock(return_value=[{"id": 1}])),
            patch.object(database, "replace_weapon_scan", AsyncMock()) as save,
        ):
            with self.assertRaises(HTTPException) as error:
                await web.import_weapon_scan(None, 2, "session")
            self.assertEqual(error.exception.status_code, 404)
            save.assert_not_called()

    async def test_invalid_scan_is_rejected_before_replacing_previous_snapshot(self):
        class Request:
            async def stream(self):
                yield json.dumps(export("700000002")).encode()

        with (
            patch.object(web, "_manual_weapon_owner", AsyncMock(return_value=10)),
            patch.object(
                web, "get_accounts", AsyncMock(return_value=[{"id": 1, "genshin_uid": "700000001"}])
            ),
            patch.object(database, "replace_weapon_scan", AsyncMock()) as save,
        ):
            with self.assertRaises(HTTPException) as error:
                await web.import_weapon_scan(Request(), 1, "session")
            self.assertEqual(error.exception.status_code, 422)
            save.assert_not_called()

    async def test_snapshot_reimport_is_idempotent_and_survives_relink_without_touching_manual_copies(
        self,
    ):
        db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        db.executescript("""
            CREATE TABLE accounts (id INTEGER PRIMARY KEY, discord_user_id INTEGER, genshin_uid TEXT);
            CREATE TABLE weapon_account_scan_snapshots (genshin_uid TEXT PRIMARY KEY, scan_id TEXT,
                weapons TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE manual_weapons (copy_id TEXT, discord_user_id INTEGER, genshin_uid TEXT, weapon TEXT);
            INSERT INTO accounts VALUES (1,10,'700000001'),(2,10,'700000002'),(3,20,'700000001');
            INSERT INTO manual_weapons VALUES ('manual',10,'700000001','{}');
        """)

        class Connection:
            def connection(self):
                return self

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def execute(self, query, params):
                params = tuple(
                    json.dumps(v.obj) if isinstance(v, database.Jsonb) else v for v in params
                )
                cursor = db.execute(
                    query.replace("%s", "?")
                    .replace("::text", "")
                    .replace("NOW()", "CURRENT_TIMESTAMP"),
                    params,
                )

                class Result:
                    rowcount = cursor.rowcount

                    async def fetchone(self):
                        row = cursor.fetchone()
                        return (
                            None
                            if row is None
                            else {**dict(row), "weapons": json.loads(row["weapons"])}
                        )

                return Result()

        scan = validate_weapon_scan(export(), "700000001")
        with patch.object(database, "get_pool", return_value=Connection()):
            for _ in range(2):
                await database.replace_weapon_scan(
                    10, 1, scan["scan_id"], copy.deepcopy(scan["weapons"])
                )
            self.assertEqual(len((await database.get_weapon_scan(10, 1))["weapons"]), 2)
            self.assertEqual((await database.get_weapon_scan(10, 2))["weapons"], [])
            self.assertEqual(len((await database.get_weapon_scan(20, 3))["weapons"]), 2)
            self.assertEqual((await database.get_weapon_scan(20, 1))["weapons"], [])
            with self.assertRaises(ValueError):
                await database.replace_weapon_scan(20, 1, "forbidden", [])
            newer = copy.deepcopy(scan["weapons"][:1])
            newer[0]["scan_copy_id"] = "new-scan:0"
            await database.replace_weapon_scan(20, 3, "new-scan", newer)
            replacement = await database.get_weapon_scan(10, 1)
            self.assertEqual(len(replacement["weapons"]), 1)
            self.assertEqual(replacement["scan_id"], "new-scan")
            self.assertEqual(replacement["weapons"][0]["scan_copy_id"], "new-scan:0")
            db.execute("DELETE FROM accounts WHERE id=1")
            db.execute("INSERT INTO accounts VALUES(4,30,'700000001')")
            self.assertEqual(len((await database.get_weapon_scan(30, 4))["weapons"]), 1)
            self.assertEqual(db.execute("SELECT count(*) FROM manual_weapons").fetchone()[0], 1)
            await database.replace_weapon_scan(20, 3, "empty", [])
            self.assertEqual((await database.get_weapon_scan(30, 4))["weapons"], [])


class SharedWeaponMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_latest_legacy_scan_is_recovered_and_restarts_preserve_shared_edits(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.executescript("""
            CREATE TABLE weapon_scan_snapshots (
                discord_user_id INTEGER, genshin_uid TEXT, scan_id TEXT,
                weapons TEXT, updated_at TEXT
            );
            INSERT INTO weapon_scan_snapshots VALUES
                (10, '7001', 'old', '[{"id":1}]', '2026-10-30'),
                (20, '7001', 'new', '[{"id":2}]', '2026-11-01'),
                (10, '7002', 'other', '[{"id":3}]', '2026-10-31'),
                (10, '7003', 'empty', '[]', '2026-11-01'),
                (20, '7003', 'stale', '[{"id":4}]', '2026-10-31');
        """)

        class Connection:
            async def execute(self, query):
                # Exercise historical migration selection and conflict handling locally.
                db.execute(query.replace("NOW()", "CURRENT_TIMESTAMP"))

        await migrate_weapon_scans(Connection())
        self.assertEqual(
            db.execute(
                "SELECT genshin_uid, scan_id FROM weapon_account_scan_snapshots ORDER BY genshin_uid"
            ).fetchall(),
            [("7001", "new"), ("7002", "other"), ("7003", "empty")],
        )
        # Both a shared replacement and an intentional empty inventory survive restart.
        db.execute(
            "UPDATE weapon_account_scan_snapshots SET scan_id='edited', weapons='[]' WHERE genshin_uid='7001'"
        )
        await migrate_weapon_scans(Connection())
        self.assertEqual(
            db.execute(
                "SELECT scan_id, weapons FROM weapon_account_scan_snapshots WHERE genshin_uid='7001'"
            ).fetchone(),
            ("edited", "[]"),
        )
        self.assertEqual(db.execute("SELECT count(*) FROM weapon_scan_snapshots").fetchone()[0], 5)
