import json
import sqlite3
import unittest
from types import SimpleNamespace as Item
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from utils.hoyolab import database
from utils.web import app as web
from utils.web.weapons import owned_weapon_rows, validate_manual_weapon, weapon_tag


class WeaponsTests(unittest.IsolatedAsyncioTestCase):
    def test_tags_cover_signature_and_acquisition_examples(self):
        for weapon_id, expected in {
            14522: "Columbina's Signature",
            13415: "Fishing Association",
            13424: "BP",
            12502: "Gacha",
            14432: "Event",
            14433: "Craftable",
            13301: "Exploration",
            # Fontaine craftables were incorrectly labelled BP upstream.
            11425: "Craftable",
        }.items():
            with self.subTest(weapon_id=weapon_id):
                self.assertEqual(weapon_tag(weapon_id)["label"], expected)
        self.assertEqual(weapon_tag(999999)["label"], "Source unavailable")

    def test_manual_progression_limits_and_unsafe_icons(self):
        weapon = dict(
            id=1,
            name="Sword",
            icon="https://example.com/icon.png",
            rarity=4,
            type="Sword",
            level=90,
            refinement=5,
        )
        self.assertEqual(validate_manual_weapon(weapon), weapon)
        for invalid in (
            {"refinement": 0},
            {"refinement": 6},
            {"level": 91},
            {"level": True},
            {"rarity": 2},
            {"icon": "javascript:alert(1)"},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_manual_weapon(dict(weapon, **invalid))
        self.assertEqual(validate_manual_weapon(dict(weapon, rarity=2, level=70))["level"], 70)

    async def test_manual_add_keeps_distinct_copies_and_persists_validated_fields(self):
        weapon = dict(
            id=1,
            name="Sword",
            icon="https://example.com/icon.png",
            rarity=4,
            type="Sword",
            level=80,
            refinement=3,
            copy_id="forged",
            equipped="forged",
        )
        request = Item(json=AsyncMock(return_value=weapon))
        with (
            patch.object(web, "_manual_weapon_owner", AsyncMock(return_value=7)),
            patch("utils.hoyolab.database.add_manual_weapon", AsyncMock()) as save,
        ):
            first = await web.manual_weapon_add(request, 2, "session")
            second = await web.manual_weapon_add(request, 2, "session")
        self.assertNotEqual(first["weapon"]["copy_id"], second["weapon"]["copy_id"])
        self.assertNotIn("equipped", first["weapon"])
        self.assertEqual(save.call_args.args[:2], (7, 2))
        self.assertEqual(save.call_args.args[3]["refinement"], 3)

    async def test_manual_routes_reject_other_accounts_before_storage(self):
        with (
            patch.object(web, "get_web_session", AsyncMock(return_value=Item(user_id=1))),
            patch.object(web, "get_accounts", AsyncMock(return_value=[{"id": 2}])),
            patch("utils.hoyolab.database.add_manual_weapon", AsyncMock()) as save,
            patch("utils.hoyolab.database.remove_manual_weapon", AsyncMock()) as remove,
            patch("utils.hoyolab.database.get_manual_weapons", AsyncMock()) as load,
        ):
            for action in (
                web.manual_weapons_data(3, "session"),
                web.manual_weapon_add(Item(), 3, "session"),
                web.manual_weapon_remove("copy", 3, "session"),
            ):
                with self.assertRaises(HTTPException) as error:
                    await action
                self.assertEqual(error.exception.status_code, 404)
            save.assert_not_called()
            remove.assert_not_called()
            load.assert_not_called()

    def test_same_weapon_on_two_characters_keeps_both_copies(self):
        weapon = Item(id=1, name="Sword", icon="", rarity=4, type=1, level=80, refinement=3)
        rows = owned_weapon_rows(
            [
                Item(name="A", rarity=5, icon="a.png", weapon=weapon),
                Item(name="B", rarity=4, icon="b.png", weapon=weapon),
            ]
        )
        self.assertEqual([row["equipped"] for row in rows], ["A", "B"])
        self.assertEqual(rows[0]["type"], "Sword")
        self.assertEqual(rows[0]["refinement"], 3)

    async def test_rejects_account_not_owned_by_session(self):
        with (
            patch.object(web, "get_web_session", AsyncMock(return_value=Item(user_id=1))),
            patch.object(web, "get_accounts", AsyncMock(return_value=[{"id": 2}])),
            patch.object(web, "get_account_client", AsyncMock()) as client,
        ):
            with self.assertRaises(HTTPException) as error:
                await web.weapons_data("session", 3)
            self.assertEqual(error.exception.status_code, 404)
            client.assert_not_called()

    async def test_catalogue_survives_owned_failure_without_leaking_error(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.get_genshin_characters.side_effect = RuntimeError("PRIVATE_TOKEN")
        client.genshin_client.get_calculator_weapons.return_value = [
            Item(id=1, name="Sword", icon="", rarity=4, type="Sword", max_level=90)
        ]
        with (
            patch.object(web, "get_web_session", AsyncMock(return_value=Item(user_id=1))),
            patch.object(
                web, "get_accounts", AsyncMock(return_value=[{"id": 2, "genshin_uid": 123}])
            ),
            patch.object(web, "get_account_client", AsyncMock(return_value=client)),
        ):
            result = await web.weapons_data("session", 2)
        self.assertEqual(result["catalogue"][0]["name"], "Sword")
        self.assertEqual(result["owned"], [])
        self.assertIn("owned_error", result)
        self.assertNotIn("PRIVATE_TOKEN", str(result))

    async def test_requires_session(self):
        with patch.object(web, "get_web_session", AsyncMock(return_value=None)):
            with self.assertRaises(HTTPException) as error:
                await web.weapons_data(None, 2)
        self.assertEqual(error.exception.status_code, 401)


class ManualWeaponStorageTests(unittest.IsolatedAsyncioTestCase):
    async def test_copies_are_shared_by_uid_and_survive_discord_change(self):
        db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        db.executescript("""
            CREATE TABLE accounts (id INTEGER PRIMARY KEY, discord_user_id INTEGER, genshin_uid TEXT);
            CREATE TABLE manual_weapons (copy_id TEXT PRIMARY KEY, discord_user_id INTEGER,
                genshin_uid TEXT, weapon TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
            INSERT INTO accounts VALUES (1, 10, '7001'), (2, 10, '7002'), (3, 20, '7001');
        """)

        class Connection:
            def connection(self):
                return self

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def execute(self, query, params):
                values = tuple(
                    json.dumps(v.obj) if isinstance(v, database.Jsonb) else v for v in params
                )
                cursor = db.execute(query.replace("%s", "?").replace("::text", ""), values)

                class Result:
                    rowcount = cursor.rowcount

                    async def fetchall(self):
                        return [
                            {**dict(row), "weapon": json.loads(row["weapon"])}
                            for row in cursor.fetchall()
                        ]

                return Result()

        with patch.object(database, "get_pool", return_value=Connection()):
            await database.add_manual_weapon(10, 1, "copy-a", {"id": 1, "level": 80})
            await database.add_manual_weapon(10, 1, "copy-b", {"id": 1, "level": 90})
            self.assertEqual(len(await database.get_manual_weapons(10, 1)), 2)
            for user, account in [(10, 2), (20, 1)]:
                self.assertEqual(await database.get_manual_weapons(user, account), [])
                self.assertFalse(await database.remove_manual_weapon(user, account, "copy-a"))
            self.assertEqual(len(await database.get_manual_weapons(20, 3)), 2)
            await database.add_manual_weapon(20, 3, "copy-c", {"id": 2, "level": 20})
            self.assertEqual(len(await database.get_manual_weapons(10, 1)), 3)
            self.assertTrue(await database.remove_manual_weapon(20, 3, "copy-c"))
            with self.assertRaises(ValueError):
                await database.add_manual_weapon(20, 1, "forbidden", {"id": 1})
            db.execute("DELETE FROM accounts WHERE id = 1")
            db.execute("INSERT INTO accounts VALUES (4, 30, '7001')")
            self.assertEqual(len(await database.get_manual_weapons(30, 4)), 2)
            self.assertTrue(await database.remove_manual_weapon(30, 4, "copy-a"))
            rows = await database.get_manual_weapons(30, 4)
            self.assertEqual(rows, [{"copy_id": "copy-b", "id": 1, "level": 90}])
