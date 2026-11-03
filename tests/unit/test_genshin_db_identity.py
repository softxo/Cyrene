import unittest
from datetime import date
from unittest.mock import AsyncMock, MagicMock

from utils.genshin_db import GenshinDB, GenshinDBIdentityError, _cache
from utils.web.content_metadata import character_content_metadata


class CatalogueIdentityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        _cache.clear()

    def provider(self, data):
        response = MagicMock()
        response.json = AsyncMock(return_value=data)
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=response)
        context.__aexit__ = AsyncMock(return_value=False)
        session = MagicMock()
        session.get.return_value = context
        return GenshinDB(session)

    async def test_unreleased_names_cannot_borrow_inazuma_costs(self):
        for folder in ("characters", "talents"):
            for name, wrong in (("Mitya", "Kamisato Ayaka"), ("Valeriy", "Raiden Shogun")):
                with self.subTest(folder=folder, name=name):
                    db = self.provider(
                        {"name": wrong, "costs": {"ascend1": [{"name": "Old Handguard"}]}}
                    )
                    result = await db.get(folder, name)
                    self.assertEqual(result["name"], name)
                    self.assertTrue(result["preview"])
                    self.assertNotIn("Old Handguard", str(result))
                    self.assertNotIn((folder, name.casefold()), _cache)

    async def test_exact_new_character_costs_are_used_when_published(self):
        for name in ("Mitya", "Valeriy"):
            from utils.web.preview_materials import preview_entry

            data = preview_entry("characters", name)
            data.pop("preview")
            self.assertEqual(await self.provider(data).get("characters", name), data)

    async def test_material_punctuation_does_not_reject_the_right_entry(self):
        result = await self.provider({"name": "Hero’s Wit"}).get("materials", "Hero's Wit")
        self.assertEqual(result["name"], "Hero’s Wit")

    async def test_poisoned_cache_is_not_reused(self):
        import time

        _cache[("characters", "mitya")] = (time.monotonic(), {"name": "Kamisato Ayaka"})
        self.assertEqual(
            (await self.provider({"name": "Mitya"}).get("characters", "Mitya"))["name"], "Mitya"
        )

    def test_unreleased_metadata_overrides_missing_release_dates(self):
        for name in ("Mitya", "Valeriy"):
            metadata = character_content_metadata(name, today=date(2026, 11, 3))
            self.assertTrue(metadata["unreleased"])
            self.assertEqual(metadata["release_date"], "2026-11-04")
        self.assertFalse(character_content_metadata("Ayaka")["unreleased"])

    def test_characters_stop_being_unreleased_on_the_release_date(self):
        self.assertFalse(character_content_metadata("Mitya", today=date(2026, 11, 4))["unreleased"])
        self.assertTrue(
            character_content_metadata("Future character", "2026-12-01", today=date(2026, 11, 3))[
                "unreleased"
            ]
        )

    async def test_other_unknown_names_still_reject_wrong_records(self):
        with self.assertRaises(GenshinDBIdentityError):
            await self.provider({"name": "Kamisato Ayaka"}).get("characters", "Unknown character")

    async def test_preview_ascension_and_talent_totals(self):
        from utils.web.planner_costs import _level_cost, _talent_cost
        from utils.web.preview_materials import DATA

        for name in ("Mitya", "Valeriy"):
            with self.subTest(name=name):
                db = self.provider({"name": "Kamisato Ayaka"})
                level = await _level_cost(db, name, 1, 90, 0)
                self.assertEqual(level["status"], "ok")
                self.assertTrue(level["preview"])
                amounts = {item["name"]: item["amount"] for item in level["items"]}
                sheet = DATA["characters"][name]
                self.assertEqual(amounts[sheet["speciality"]], 168)
                self.assertEqual(amounts[sheet["boss"]], 46)
                self.assertEqual([amounts[material] for material in sheet["common"]], [18, 30, 36])
                self.assertEqual(
                    [
                        amounts["Vajrada Amethyst " + suffix]
                        for suffix in ("Sliver", "Fragment", "Chunk", "Gemstone")
                    ],
                    [1, 9, 9, 6],
                )
                unknown = [
                    item for item in level["items"] if str(item["id"]).startswith("preview:")
                ]
                self.assertTrue(unknown)
                self.assertTrue(
                    all(
                        item["inventory_unavailable"]
                        and item["icon"].startswith("/static/images/materials/preview/")
                        for item in unknown
                    )
                )
                talents = await _talent_cost(db, name, [1, 1, 1], [10, 10, 10])
                self.assertTrue(talents["preview"])
                amounts = {item["name"]: item["amount"] for item in talents["items"]}
                self.assertEqual([amounts[material] for material in sheet["books"]], [9, 63, 114])
                self.assertEqual([amounts[material] for material in sheet["common"]], [18, 66, 93])
                self.assertEqual(amounts[sheet["weekly"]], 18)
                self.assertEqual(amounts["Crown of Insight"], 3)
                self.assertEqual(amounts["Mora"], 4957500)

    async def test_preview_partial_upgrades_only_count_remaining_steps(self):
        from utils.web.planner_costs import _talent_cost

        result = await _talent_cost(
            self.provider({"name": "Kamisato Ayaka"}), "Mitya", [9, 10, 10], [10, 10, 10]
        )
        amounts = {item["name"]: item["amount"] for item in result["items"]}
        self.assertEqual(amounts["Philosophies of Charity"], 16)
        self.assertEqual(amounts["Mask of the Virtuous Doctor"], 2)
        self.assertEqual(amounts["Crown of Insight"], 1)
        self.assertEqual(amounts["Mora"], 700000)

    async def test_exact_name_with_placeholder_inazuma_materials_uses_correct_preview(self):
        for folder in ("characters", "talents"):
            for name in ("Mitya", "Valeriy"):
                result = await self.provider(
                    {"name": name, "costs": {"ascend1": [{"name": "Old Handguard"}]}}
                ).get(folder, name)
                self.assertTrue(result["preview"])
                self.assertNotIn("Old Handguard", str(result))

    async def test_starsealed_edict_costs_work_when_the_provider_has_no_record(self):
        from utils.web.planner_costs import _weapon_cost

        result = await _weapon_cost(self.provider({}), "Starsealed Edict", 1, 90, 0)
        self.assertEqual(result["status"], "ok")
        self.assertTrue(result["preview"])
        amounts = {item["name"]: item["amount"] for item in result["items"]}
        for name, count in {
            "The Frost Emperor's Revival": 5,
            "The Frost Emperor's Ceremony": 14,
            "The Frost Emperor's Lament": 14,
            "The Frost Emperor's Farewell": 6,
            "Snowborn Heartshard": 23,
            "Snowborn Mirrorheart": 27,
            "Snowborn Heart of Ignorance": 41,
            "Ethereal Glimmershard": 15,
            "Ethereal Crystal": 23,
            "Ethereal Crystalscale Stone": 27,
        }.items():
            self.assertEqual(amounts[name], count)
        self.assertTrue(all(item["icon"] for item in result["items"]))
        self.assertEqual(
            [item["id"] for item in result["items"]],
            [
                202,
                104013,
                114096,
                114095,
                114094,
                114093,
                112160,
                112159,
                112158,
                112148,
                112147,
                112146,
            ],
        )
        partial = await _weapon_cost(self.provider({}), "Starsealed Edict", 80, 90, 5)
        partial_amounts = {item["name"]: item["amount"] for item in partial["items"]}
        self.assertEqual(partial_amounts["The Frost Emperor's Farewell"], 6)
        self.assertNotIn("The Frost Emperor's Revival", partial_amounts)

    async def test_published_weapon_costs_replace_the_fallback(self):
        from utils.web.preview_materials import preview_entry

        record = preview_entry("weapons", "Starsealed Edict")
        record.pop("preview")
        self.assertEqual(await self.provider(record).get("weapons", "Starsealed Edict"), record)
