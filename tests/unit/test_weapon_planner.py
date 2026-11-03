import copy
import json
import sqlite3
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from utils.genshin_db import GenshinDBError
from utils.hoyolab import weapon_plan_store
from utils.web import app as web
from utils.web.weapon_planner import (
    calculate_weapon_plan,
    normalise_weapon_plan,
    refinement_cost,
)

WEAPON = {
    "id": 11401,
    "name": "Favonius Sword",
    "rarity": 4,
    "type": "Sword",
    "icon": "https://example.com/sword.webp",
    "level": 70,
    "refinement": 1,
}
PLAN = {
    "key": "copy-a",
    "weapon": WEAPON,
    "currentLevel": 70,
    "targetLevel": 90,
    "currentRefinement": 1,
    "targetRefinement": 5,
    "ascension": 4,
}


class WeaponPlannerTests(unittest.IsolatedAsyncioTestCase):
    def test_source_and_character_survive_plan_round_trip(self):
        plan = {**PLAN, "source": "hoyolab", "equippedCharacter": "Jean"}
        self.assertEqual(normalise_weapon_plan(plan), plan)
        with self.assertRaises(ValueError):
            normalise_weapon_plan({**PLAN, "source": "invalid"})

    def test_validation_rejects_downgrades_invalid_refinement_and_low_rarity_caps(self):
        self.assertEqual(normalise_weapon_plan(PLAN), PLAN)
        for changes in (
            {"targetLevel": 69},
            {"targetRefinement": 6},
            {"currentRefinement": True},
            {"ascension": 7},
            {"targetLevel": 91},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                normalise_weapon_plan({**PLAN, **changes})
        for changes in ({"targetLevel": 71}, {"targetRefinement": 2}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                normalise_weapon_plan(
                    {
                        **PLAN,
                        "weapon": {**WEAPON, "rarity": 2},
                        "targetLevel": 70,
                        "targetRefinement": 1,
                        **changes,
                    }
                )

    async def test_refinements_require_r1_copies_and_sum_mora_per_step(self):
        db = AsyncMock()
        # A non-empty R2 record is what the provider supplies for refinable weapons.
        db.get.side_effect = lambda folder, name: (
            {"id": 11401, "rarity": 4, "r2": {"description": "Passive"}}
            if folder == "weapons"
            else {"id": 202, "name": "Mora"}
        )
        result = await refinement_cost(db, WEAPON, 2, 5)
        self.assertEqual(result["status"], "ok")
        mora, copies = result["items"]
        self.assertEqual(mora["amount"], 14000)
        self.assertEqual(copies["id"], "weapon:11401")
        self.assertEqual(copies["amount"], 3)
        self.assertTrue(copies["inventory_unavailable"])

    async def test_fishing_and_event_weapons_use_special_materials(self):
        for weapon_id, name, material_id in [
            (13415, '"The Catch"', 200107),
            (11413, "Festering Desire", 200103),
        ]:
            db = AsyncMock()
            db.get.side_effect = lambda folder, _, identity=weapon_id: (
                {"id": identity, "rarity": 4, "r2": {"description": "Passive"}}
                if folder == "weapons"
                else {"id": 202, "name": "Mora"}
            )
            result = await refinement_cost(db, {**WEAPON, "id": weapon_id, "name": name}, 1, 5)
            self.assertEqual(result["items"][1]["id"], material_id)
            self.assertEqual(result["items"][1]["amount"], 4)
            self.assertEqual(result["items"][0]["amount"], 15000)

    async def test_unrefinable_weapon_and_identity_mismatch(self):
        db = AsyncMock()
        db.get.return_value = {"id": 11416, "rarity": 4}
        result = await refinement_cost(db, {**WEAPON, "id": 11416}, 1, 5)
        self.assertEqual(result["items"], [])
        self.assertIn("cannot be refined", result["message"])
        with self.assertRaises(GenshinDBError):
            await refinement_cost(db, WEAPON, 1, 5)

    async def test_level_failure_does_not_hide_refinement_costs(self):
        with (
            patch(
                "utils.web.weapon_planner._weapon_cost",
                AsyncMock(side_effect=GenshinDBError("provider failed")),
            ),
            patch(
                "utils.web.weapon_planner.refinement_cost",
                AsyncMock(return_value={"status": "ok", "items": [{"id": 202, "amount": 15000}]}),
            ),
        ):
            costs = await calculate_weapon_plan(PLAN)
        self.assertEqual(costs["level"]["status"], "unavailable")
        self.assertEqual(costs["refinements"]["items"][0]["amount"], 15000)

    async def test_endpoints_authorise_account_before_reading_or_mutating(self):
        request = AsyncMock()
        with patch.object(web, "_manual_weapon_owner", AsyncMock(side_effect=HTTPException(404))):
            for call in [
                lambda: web.weapon_plans_data(2, "session"),
                lambda: web.save_weapon_plans(request, 2, "session"),
                lambda: web.weapon_planner_costs(request, 2, "session"),
                lambda: web.reset_weapon_inventory(2, "session"),
            ]:
                with self.assertRaises(HTTPException):
                    await call()
        request.json.assert_not_called()


class WeaponPlanStorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        db = self.db = sqlite3.connect(":memory:")
        db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        db.executescript("""
            CREATE TABLE accounts (id INTEGER PRIMARY KEY, discord_user_id INTEGER, genshin_uid TEXT);
            INSERT INTO accounts VALUES (1,10,'7001'),(2,10,'7002'),(3,20,'7001');
            CREATE TABLE weapon_uid_plans (genshin_uid TEXT PRIMARY KEY, plans TEXT, updated_at TEXT);
            CREATE TABLE manual_weapons (genshin_uid TEXT, copy_id TEXT);
            CREATE TABLE weapon_account_scan_snapshots (genshin_uid TEXT, scan_id TEXT);
            INSERT INTO manual_weapons VALUES ('7001','m1'),('7002','m2');
            INSERT INTO weapon_account_scan_snapshots VALUES ('7001','s1'),('7002','s2');
        """)

        class Pool:
            def connection(self):
                return self

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            @asynccontextmanager
            async def transaction(self):
                db.execute("SAVEPOINT reset_inventory")
                try:
                    yield
                    db.execute("RELEASE reset_inventory")
                except Exception:
                    db.execute("ROLLBACK TO reset_inventory")
                    db.execute("RELEASE reset_inventory")
                    raise

            async def execute(self, sql, params):
                sql = (
                    sql.replace("%s", "?")
                    .replace("::text", "")
                    .replace(" FOR UPDATE", "")
                    .replace("NOW()", "CURRENT_TIMESTAMP")
                )
                cursor = db.execute(
                    sql,
                    tuple(
                        json.dumps(value.obj) if isinstance(value, Jsonb) else value
                        for value in params
                    ),
                )

                class Result:
                    rowcount = cursor.rowcount

                    async def fetchone(self):
                        row = cursor.fetchone()
                        if row is None:
                            return None
                        result = dict(row)
                        if "plans" in result:
                            result["plans"] = json.loads(result["plans"])
                        return result

                return Result()

        self.pool = Pool()

    async def test_uid_persistence_relink_and_reset_keep_plans_and_other_accounts(self):
        original = [copy.deepcopy(PLAN)]
        await weapon_plan_store.replace_plans(self.pool, 10, 1, original)
        self.assertEqual(await weapon_plan_store.get_plans(self.pool, 20, 3), original)
        self.assertEqual(await weapon_plan_store.get_plans(self.pool, 10, 2), [])
        with self.assertRaises(ValueError):
            await weapon_plan_store.replace_plans(self.pool, 99, 1, [])
        with self.assertRaises(ValueError):
            await weapon_plan_store.reset_inventory(self.pool, 99, 1)
        await weapon_plan_store.reset_inventory(self.pool, 20, 3)
        self.assertEqual(await weapon_plan_store.get_plans(self.pool, 10, 1), original)
        self.assertEqual(
            [tuple(row) for row in self.db.execute("SELECT * FROM manual_weapons")],
            [("7002", "m2")],
        )
        self.assertEqual(
            [tuple(row) for row in self.db.execute("SELECT * FROM weapon_account_scan_snapshots")],
            [("7002", "s2")],
        )
        self.db.execute("DELETE FROM accounts WHERE genshin_uid='7001'")
        self.db.execute("INSERT INTO accounts VALUES (4,30,'7001')")
        self.assertEqual(await weapon_plan_store.get_plans(self.pool, 30, 4), original)
        await weapon_plan_store.replace_plans(self.pool, 30, 4, [])
        self.assertEqual(await weapon_plan_store.get_plans(self.pool, 30, 4), [])
