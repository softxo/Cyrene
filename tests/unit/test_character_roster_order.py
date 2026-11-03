"""The first HTML paint must use the same default order as the browser."""

import re
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from utils.web import app as web


class CharacterRosterOrderTests(unittest.TestCase):
    def test_initial_roster_uses_ownership_level_rarity_then_name(self):
        names = [(1, "Alpha", 4), (2, "Zulu", 5), (3, "Beta", 5), (4, "Aardvark", 4)]
        catalogue = {
            id: SimpleNamespace(
                name=name, rarity=rarity, element="Cryo", icon_name=name, weapon_type=1
            )
            for id, name, rarity in names
        }
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.get_genshin_characters.return_value = [
            SimpleNamespace(
                id=id,
                name=name,
                rarity=rarity,
                element="Cryo",
                icon="/icon.png",
                level=90,
                friendship=1,
                constellation=0,
                weapon_type=1,
            )
            for id, name, rarity in names[:2]
        ]
        with (
            patch.object(
                web, "get_web_session", AsyncMock(return_value=SimpleNamespace(user_id=7))
            ),
            patch.object(
                web, "get_accounts", AsyncMock(return_value=[{"id": 1, "genshin_uid": "7001"}])
            ),
            patch.object(web, "get_account_client", AsyncMock(return_value=client)),
            patch.object(web, "CHARACTER_NAMES", {"en-us": catalogue}),
        ):
            response = TestClient(web.app).get("/characters?account_id=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            re.findall(r'data-character-id="(\d+)"', response.text), ["2", "1", "3", "4"]
        )


class CharacterWeaponTypeTests(unittest.TestCase):
    def test_roster_populates_unowned_types_when_library_records_have_no_weapon_field(self):
        catalogue = {
            10000002: SimpleNamespace(
                name="Kamisato Ayaka", rarity=5, element="Cryo", icon_name="Ayaka"
            ),
            10000133: SimpleNamespace(
                name="Sandrone", rarity=5, element="Cryo", icon_name="Sandrone"
            ),
            10000199: SimpleNamespace(name="Mitya", rarity=5, element="Electro", icon_name="Mitya"),
        }
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.get_genshin_characters.return_value = []
        with (
            patch.object(
                web, "get_web_session", AsyncMock(return_value=SimpleNamespace(user_id=7))
            ),
            patch.object(
                web, "get_accounts", AsyncMock(return_value=[{"id": 1, "genshin_uid": "7001"}])
            ),
            patch.object(web, "get_account_client", AsyncMock(return_value=client)),
            patch.object(web, "CHARACTER_NAMES", {"en-us": catalogue}),
        ):
            response = TestClient(web.app).get("/characters?account_id=1")
        self.assertEqual(response.status_code, 200)
        for character_id, weapon_type in [
            (10000002, "sword"),
            (10000133, "claymore"),
            (10000199, "catalyst"),
        ]:
            self.assertRegex(
                response.text,
                rf'data-planner-character-id="{character_id}"[\s\S]*?data-planner-character-weapon="{weapon_type}"',
            )

    def test_missing_library_weapon_types_have_catalogue_and_preview_fallbacks(self):
        from utils.web.content_metadata import character_weapon_type

        for character_id, name, expected in [
            (10000002, "Kamisato Ayaka", "Sword"),
            (10000133, "Sandrone", "Claymore"),
            (999, "Mitya", "Catalyst"),
            (998, "Valeriy", "Sword"),
        ]:
            self.assertEqual(character_weapon_type(character_id, name), expected)
        self.assertEqual(character_weapon_type(999, "Unknown"), "")
