import unittest

from utils.web.limited_event_checks import (
    annotate_daily_events,
    apply_completion_checks,
    completion_key,
)


class DailyLimitedEventsTests(unittest.TestCase):
    def event(self, name):
        return {"name": name, "end_time": 1900000000, "is_finished": False}

    def test_bonus_campaigns_have_daily_category_and_server_reset(self):
        events = [
            self.event(name)
            for name in (
                "Overflowing Favor",
                "Ley Line Overflow",
                "Overflowing Mastery",
                "Overflowing Abundance",
            )
        ]
        annotate_daily_events(events, 1800000000)
        for event in events:
            self.assertEqual(event["category"], "Daily")
            self.assertEqual(event["daily_reset_time"], 1800000000)

    def test_ordinary_daily_tasks_do_not_make_a_campaign_daily(self):
        event = self.event("A Festival With Daily Challenges")
        annotate_daily_events([event], 1800000000)
        self.assertNotIn("daily_reset_time", event)

    def test_completion_is_shared_within_day_but_resets_next_day(self):
        today = self.event("Overflowing Favor")
        annotate_daily_events([today], 1800000000)
        checks = {completion_key(today): True}
        apply_completion_checks([today], checks)
        self.assertTrue(today["is_finished"])
        same_day = self.event("Overflowing Favor")
        annotate_daily_events([same_day], 1800000000)
        apply_completion_checks([same_day], checks)
        self.assertTrue(same_day["is_finished"])
        tomorrow = self.event("Overflowing Favor")
        annotate_daily_events([tomorrow], 1800086400)
        apply_completion_checks([tomorrow], checks)
        self.assertFalse(tomorrow["is_finished"])

    def test_daily_events_follow_ordinary_events_in_the_pill_group(self):
        daily = self.event("Overflowing Favor")
        daily["end_time"] -= 86400
        ordinary = self.event("Across the Frozen Wilds")
        quest = dict(self.event("A Requiem"), category="Quest")
        upcoming = dict(self.event("Future Event"), is_upcoming=True, start_time=1899990000)
        events = [daily, quest, upcoming, ordinary]
        annotate_daily_events(events, 1800000000)
        self.assertEqual(
            [event["name"] for event in events],
            [
                "Across the Frozen Wilds",
                "Overflowing Favor",
                "A Requiem",
                "Future Event",
            ],
        )

    def test_non_daily_completion_identity_stays_unchanged(self):
        event = self.event("Regular Limited Event")
        key = completion_key(event)
        annotate_daily_events([event], 1800000000)
        self.assertEqual(key, completion_key(event))


if __name__ == "__main__":
    unittest.main()
