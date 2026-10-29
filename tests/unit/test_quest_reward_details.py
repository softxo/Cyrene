import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from utils.web.limited_event_checks import apply_archon_quest_progress
from utils.web.quest_reward_details import (
    enrich_quest_rewards,
    image_extension,
    localise_reward_images,
    parse_quest_reward_table,
)


def card(name, count):
    return (
        f'<div class="card-container mini-card"><span class="card-quality-5">'
        f'<img alt="{name}" src="data:image/gif;base64,blank" '
        f'data-src="https://static.wikia.nocookie.net/example/{name}.png"></span>'
        f'<span class="card-text">{count}</span></div>'
    )


def table(characters):
    markup = '<table><tr><th colspan="3">Archon Quest Rewards</th></tr>'
    markup += (
        "<tr><td></td><td><a>Example Quest</a></td><td>" + card("Primogem", "500") + "</td></tr>"
    )
    markup += '<tr><th colspan="3">Insight Rewards</th></tr>'
    for character in characters:
        markup += (
            f'<tr><td><a title="{character}"><img alt="{character} Icon" '
            f'src="https://static.wikia.nocookie.net/example/{character}.png"></a></td>'
            "<td><a>Finish the Quest</a><br><small>Act IV</small></td><td>"
            + card("Primogem", "60")
            + card("Material", "9")
            + "</td></tr>"
        )
    return markup + "</table>"


class QuestRewardTableTests(unittest.TestCase):
    def test_character_count_and_rewards_come_from_table(self):
        for names in [["One"], ["One", "Two", "Three"]]:
            details = parse_quest_reward_table(table(names), "Example Quest")
            self.assertEqual(details["rewards"][0]["amount"], 500)
            self.assertEqual([entry["character"] for entry in details["insight_rewards"]], names)
            self.assertEqual(details["insight_rewards"][0]["rewards"][0]["amount"], 60)
            self.assertEqual(details["insight_rewards"][0]["rewards"][1]["amount"], 9)
            self.assertEqual(details["insight_rewards"][0]["task"], "Finish the Quest")

    def test_unrelated_or_malformed_tables_are_rejected(self):
        self.assertIsNone(parse_quest_reward_table(table(["One"]), "Another Quest"))
        self.assertIsNone(
            parse_quest_reward_table(
                "<table><tr><td>No reward data</td></tr></table>", "Example Quest"
            )
        )
        self.assertIsNone(
            parse_quest_reward_table(
                table(["One"]).replace("static.wikia.nocookie.net", "untrusted.example"),
                "Example Quest",
            )
        )


class EnrichmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_automatic_progress_keeps_the_same_reward_preview(self):
        base = {
            "name": "Example Quest",
            "category": "Quest",
            "quest_type": "archon",
            "progress_available": False,
            "start_time": 1,
            "end_time": 100,
            "rewards": [{"name": "Primogems", "amount": None}],
        }
        manual, automatic = dict(base), dict(base)
        apply_archon_quest_progress(
            [automatic],
            {
                "retcode": 0,
                "data": {
                    "archon_quest_progress": {
                        "is_open_archon_quest": True,
                        "list": [{"chapter_title": "Example Quest", "status": "StatusFinished"}],
                    }
                },
            },
            50,
        )
        details = parse_quest_reward_table(table(["Vesna", "Vodyanitsa"]), "Example Quest")
        with patch(
            "utils.web.quest_reward_details.get_quest_reward_details",
            AsyncMock(return_value=details),
        ) as lookup:
            await enrich_quest_rewards([manual, automatic])
        self.assertEqual(lookup.await_count, 2)
        self.assertEqual(automatic["rewards"], manual["rewards"])
        self.assertEqual(automatic["rewards"][0]["amount"], 500)
        self.assertEqual(automatic["insight_rewards"], manual["insight_rewards"])
        self.assertTrue(automatic["progress_available"])
        self.assertTrue(automatic["is_finished"])
        self.assertFalse(manual["progress_available"])

    async def test_existing_image_cache_and_bundled_primogem_use_local_urls(self):
        url = "https://static.wikia.nocookie.net/example/Character.png"
        digest = hashlib.sha256(url.encode()).hexdigest()
        details = {
            "rewards": [{"name": "Primogem", "icon": url}],
            "insight_rewards": [{"icon": url, "rewards": []}],
        }
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / (digest + ".webp")).write_bytes(b"RIFF1234WEBP")
            with patch("utils.web.quest_reward_details.IMAGE_DIRECTORY", Path(directory)):
                await localise_reward_images(details)
        self.assertEqual(details["rewards"][0]["icon"], "/static/images/misc/Primogem.webp")
        self.assertEqual(
            details["insight_rewards"][0]["icon"],
            f"/static/images/events/quest-rewards/{digest}.webp",
        )

    async def test_html_error_pages_are_not_cached_as_images(self):
        self.assertIsNone(image_extension(b"<html>Access denied</html>"))
        self.assertEqual(image_extension(b"RIFF1234WEBP"), ".webp")

    async def test_old_cache_urls_migrate_to_shipped_assets_without_network(self):
        filename = "a" * 64 + ".webp"
        details = {
            "rewards": [],
            "insight_rewards": [{"icon": "/static/cache/quest-rewards/" + filename, "rewards": []}],
        }
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / filename).write_bytes(b"RIFF1234WEBP")
            with patch("utils.web.quest_reward_details.IMAGE_DIRECTORY", Path(directory)):
                await localise_reward_images(details)
        self.assertEqual(
            details["insight_rewards"][0]["icon"], "/static/images/events/quest-rewards/" + filename
        )

    async def test_failed_lookup_preserves_official_rewards(self):
        event = {
            "name": "Example Quest",
            "category": "Quest",
            "progress_available": False,
            "rewards": [{"amount": 400}],
        }
        with patch(
            "utils.web.quest_reward_details.get_quest_reward_details", AsyncMock(return_value=None)
        ):
            await enrich_quest_rewards([event])
        self.assertEqual(event["rewards"], [{"amount": 400}])

    async def test_hoyolab_rewards_are_not_overwritten(self):
        event = {"name": "Example Quest", "category": "Quest", "rewards": [{"amount": 500}]}
        with patch(
            "utils.web.quest_reward_details.get_quest_reward_details", AsyncMock()
        ) as lookup:
            await enrich_quest_rewards([event])
            lookup.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
