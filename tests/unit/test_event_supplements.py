import unittest
from datetime import datetime
from pathlib import Path

from utils.web.event_supplements import apply_reviewed_event_details, apply_reviewed_stygian_opening
from utils.web.limited_event_checks import annotate_daily_events


class EventSupplementTests(unittest.TestCase):
    now = int(datetime.fromisoformat("2026-11-06T12:00:00+00:00").timestamp())

    def test_stygian_cycle_start_does_not_end_hibernation_early(self):
        stygian = {
            "start_time": self.now - 86400,
            "end_time": int(datetime.fromisoformat("2026-12-15T03:59:59+01:00").timestamp()),
        }
        apply_reviewed_stygian_opening(stygian, "os_euro", self.now)
        self.assertEqual(
            stygian["start_time"],
            int(datetime.fromisoformat("2026-11-11T10:00:00+01:00").timestamp()),
        )
        other_cycle = {"end_time": self.now + 100 * 86400}
        apply_reviewed_stygian_opening(other_cycle, "os_euro", self.now)
        self.assertNotIn("start_time", other_cycle)

    def test_image_only_dates_keep_day_precision_and_sort_before_unknown_dates(self):
        events = [
            dict(name=name, is_upcoming=True, start_time=0, end_time=0)
            for name in (
                "Frames of Fierce Splendor",
                "Unknown event",
                "Ley Line Overflow",
                "Stress Block Smashing Project",
            )
        ]
        apply_reviewed_event_details(events, "os_euro", self.now)
        annotate_daily_events(events, self.now + 86400)
        self.assertEqual(
            [event["name"] for event in events],
            [
                "Stress Block Smashing Project",
                "Frames of Fierce Splendor",
                "Ley Line Overflow",
                "Unknown event",
            ],
        )
        self.assertEqual(events[0]["opening_date"], "2026-11-20")
        self.assertTrue(all(event["start_time"] == 0 for event in events))
        self.assertTrue(all(event["is_upcoming"] for event in events))

    def test_precise_schedules_and_other_editions_are_not_overwritten(self):
        scheduled = dict(
            name="Ley Line Overflow", is_upcoming=True, start_time=self.now + 86400, end_time=0
        )
        apply_reviewed_event_details([scheduled], "os_euro", self.now)
        self.assertNotIn("opening_date", scheduled)
        future = dict(scheduled, start_time=0)
        apply_reviewed_event_details([future], "os_euro", self.now + 100 * 86400)
        self.assertNotIn("opening_date", future)

    def test_material_preview_has_real_shipped_icons_without_invented_quantities(self):
        event = dict(
            name="Hour of Ruin",
            category="Quest",
            end_time=int(datetime.fromisoformat("2026-12-15T14:59:59+01:00").timestamp()),
            rewards=[{"icon": None}],
        )
        apply_reviewed_event_details([event], "os_euro", self.now)
        self.assertEqual(event["rewards"][0]["amount"], 560)
        for reward in event["rewards"][1:]:
            self.assertIsNone(reward["amount"])
            path = Path("website") / reward["icon"].lstrip("/")
            self.assertTrue(path.is_file())
        self.assertIn("Test Run", event["reward_preview_note"])

    def test_concrete_rewards_and_other_quest_periods_are_not_overwritten(self):
        event = dict(name="Hour of Ruin", category="Quest", end_time=1, rewards=[{"icon": None}])
        apply_reviewed_event_details([event], "os_euro", self.now)
        self.assertEqual(event["rewards"], [{"icon": None}])
        event["end_time"] = int(datetime.fromisoformat("2026-12-15T14:59:59+01:00").timestamp())
        event["rewards"] = [{"icon": "/existing.png", "amount": 123}]
        apply_reviewed_event_details([event], "os_euro", self.now)
        self.assertEqual(event["rewards"], [{"icon": "/existing.png", "amount": 123}])
