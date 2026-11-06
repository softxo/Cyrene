import unittest
from datetime import datetime
from unittest.mock import AsyncMock, patch

from utils.web.wiki_event_details import (
    enrich_upcoming_events,
    event_page_from_index,
    parse_event_details,
)

INDEX = """<table><tr><td><a href="/wiki/Example_Event">Example Event</a></td>
<td>November 20, 2026 – November 30, 2026</td></tr>
<tr><td><a href="/wiki/Ley_Line_Overflow/2026-12-07">Ley Line Overflow 2026-12-07</a></td>
<td>December 7, 2026 – December 14, 2026</td></tr>
<tr><td><a href="/wiki/Heated_Battle_Mode/2026-06-06">Sprinting Stratagems</a></td>
<td>June 6, 2026 – June 22, 2026</td></tr></table>"""

CARD = """<div class="card-container"><span class="card-quality-5">
<img alt="Primogem" src="https://static.wikia.nocookie.net/example/Item_Primogem.png"></span>
<span class="card-text card-font">420</span></div>"""

PAGE = (
    """<table><tr><td data-source="time_start">November 20, 2026 10:00 (Server Time)</td>
<td data-source="time_end">November 30, 2026 03:59 (Server Time)</td></tr></table>
<h2><span id="Total_Rewards">Total Rewards</span></h2>"""
    + CARD
    + """
<h2><span id="Other_Languages">Other Languages</span></h2>"""
    + CARD
)


class WikiEventTests(unittest.IsolatedAsyncioTestCase):
    now = int(datetime.fromisoformat("2026-11-06T12:00:00+00:00").timestamp())

    def test_index_follows_edition_links_and_rejects_old_occurrences(self):
        self.assertEqual(
            event_page_from_index(INDEX, "Ley Line Overflow", self.now),
            "Ley Line Overflow/2026-12-07",
        )
        self.assertIsNone(
            event_page_from_index(INDEX, "Heated Battle Mode: Sprinting Stratagems", self.now)
        )
        self.assertIsNone(
            event_page_from_index(
                INDEX.replace(
                    'href="/wiki/Example_Event"', 'href="https://untrusted.example/Example_Event"'
                ),
                "Example Event",
                self.now,
            )
        )

    def test_exact_server_times_and_total_rewards_exclude_unrelated_cards(self):
        details = parse_event_details(PAGE, "os_euro", self.now)
        self.assertEqual(
            details["start_time"],
            int(datetime.fromisoformat("2026-11-20T10:00:00+01:00").timestamp()),
        )
        self.assertEqual(
            details["end_time"],
            int(datetime.fromisoformat("2026-11-30T03:59:59+01:00").timestamp()),
        )
        self.assertEqual(len(details["rewards"]), 1)
        self.assertEqual(details["rewards"][0]["amount"], 420)
        asia = parse_event_details(PAGE, "os_asia", self.now)
        self.assertEqual(details["start_time"] - asia["start_time"], 7 * 3600)

    def test_expired_missing_and_ambiguous_dates_do_not_supply_schedules(self):
        self.assertIsNone(parse_event_details(PAGE.replace("2026", "2025"), "os_euro", self.now))
        self.assertIsNone(parse_event_details(PAGE.replace("10:00", "TBA"), "os_euro", self.now))
        self.assertIsNone(
            parse_event_details(
                PAGE.replace("Server Time", "unknown timezone"), "os_euro", self.now
            )
        )
        self.assertIsNone(parse_event_details(PAGE, "unknown", self.now))

    async def test_enrichment_supplies_missing_data_but_keeps_official_rewards_and_completion(self):
        events = [
            dict(
                name="Example Event",
                is_upcoming=True,
                start_time=0,
                end_time=0,
                rewards=[],
                is_finished=False,
            )
        ]

        async def fetch(_session, title):
            return INDEX if title == "Event" else PAGE

        with (
            patch("utils.web.wiki_event_details._page", side_effect=fetch),
            patch("utils.web.wiki_event_details.localise_reward_images", AsyncMock()),
        ):
            await enrich_upcoming_events(events, "os_euro", self.now)
            self.assertEqual(events[0]["rewards"][0]["amount"], 420)
            self.assertTrue(events[0]["is_upcoming"])
            self.assertFalse(events[0]["is_finished"])
            events[0]["rewards"] = [{"name": "Official reward", "amount": 99}]
            await enrich_upcoming_events(events, "os_euro", self.now)
            self.assertEqual(events[0]["rewards"][0]["amount"], 99)

    async def test_unavailable_wiki_keeps_the_original_event(self):
        event = dict(name="Example Event", is_upcoming=True, start_time=0, end_time=0, rewards=[])
        with patch("utils.web.wiki_event_details._page", AsyncMock(return_value=None)):
            await enrich_upcoming_events([event], "os_euro", self.now)
        self.assertEqual(event["start_time"], 0)
        self.assertEqual(event["rewards"], [])
