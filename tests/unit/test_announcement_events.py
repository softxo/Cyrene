import unittest
from datetime import datetime
from types import SimpleNamespace

from utils.web.announcement_events import (
    announcement_reward_events,
    announcement_rewards,
    merge_announcement_events,
)


def notice(
    id=1,
    title='Complete the Archon Quest "Example" Within the Specified Duration to Obtain Additional Rewards',
    subtitle="Example",
    content=None,
):
    return SimpleNamespace(
        id=id,
        title=title,
        subtitle=subtitle,
        banner="https://example.com/banner.jpg",
        img=None,
        content=content
        or '<p>〓Specified Duration〓</p><p>After the Version 7.1 update – &lt;t class="t_lc"&gt;2026/11/03 14:59&lt;/t&gt;</p>',
    )


def update():
    return notice(
        id=2,
        title='"Example" Version 7.1 Update Details',
        content=(
            '<p>〓Update Schedule〓</p>Update maintenance begins &lt;t class="t_gl"&gt;2026/09/23 06:00&lt;/t&gt;'
            " and is estimated to take 5 hours.<p>〓How to Update Game Client〓</p>"
        ),
    )


class AnnouncementEventsTests(unittest.TestCase):
    now = int(datetime.fromisoformat("2026-10-27T12:00:00+00:00").timestamp())

    def extract(self, *notices, server="os_euro", now=None):
        return announcement_reward_events(
            [update(), *notices], server, self.now if now is None else now
        )

    def test_extracts_only_documented_rewards_and_amounts(self):
        rewards = announcement_rewards(
            "<p>Obtain an additional reward of <span>Primogems ×400</span>.</p>"
        )
        self.assertEqual(rewards[0]["amount"], 400)
        rewards = announcement_rewards(
            "Obtain Primogems, Character Ascension Materials, Character Level-Up Materials, "
            "Snezhnaya regional specialties, and other rewards. 〓Eligibility〓 Mora ×900"
        )
        self.assertEqual(len(rewards), 4)
        self.assertTrue(all(reward["amount"] is None for reward in rewards))
        self.assertEqual(
            announcement_rewards("No rewards listed. 〓Eligibility〓 Primogems ×100"), []
        )

    def test_discovers_bonus_window_and_uses_content_dates(self):
        event = self.extract(notice())[0]
        self.assertEqual(event["category"], "Quest")
        self.assertFalse(event["progress_available"])
        self.assertEqual(
            event["end_time"], int(datetime.fromisoformat("2026-11-03T14:59:59+01:00").timestamp())
        )
        self.assertEqual(
            event["start_time"],
            int(datetime.fromisoformat("2026-09-23T11:00:00+08:00").timestamp()),
        )

    def test_server_local_deadline_and_global_opening(self):
        asia = self.extract(notice(), server="os_asia")[0]
        america = self.extract(notice(), server="os_usa")[0]
        self.assertEqual(america["end_time"] - asia["end_time"], 13 * 3600)
        self.assertEqual(america["start_time"], asia["start_time"])
        self.assertEqual(self.extract(notice(), server="unknown"), [])

    def test_expired_and_future_windows(self):
        event = self.extract(notice())[0]
        self.assertEqual(self.extract(notice(), now=event["end_time"]), [])
        self.assertTrue(self.extract(notice(), now=event["start_time"] - 1)[0]["is_upcoming"])

    def test_exploration_from_an_earlier_version(self):
        event = self.extract(
            notice(
                title='"Area" Event: Complete Exploration Missions Within the Specified Duration',
                content=notice().content.replace("7.1", "7.0"),
            )
        )[0]
        self.assertEqual(event["category"], "World Exploration")
        self.assertEqual(event["start_time"], 0)
        self.assertFalse(event["is_upcoming"])

    def test_rejects_permanent_quests_prerequisites_and_notice_visibility_dates(self):
        self.assertEqual(self.extract(notice(title='"Example" World Quest Overview')), [])
        self.assertEqual(
            self.extract(notice(title='"Minigame" Event: Complete the Archon Quest to Unlock')), []
        )
        self.assertEqual(self.extract(notice(content="<p>Available permanently</p>")), [])
        self.assertEqual(
            self.extract(notice(content="<p>〓Specified Duration〓</p>After the version update")),
            [],
        )

    def test_malformed_dates_are_skipped_without_losing_valid_events(self):
        invalid = notice(id=9, content=notice().content.replace("2026/11/03", "2026/99/03"))
        events = self.extract(invalid, notice())
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["id"], "announcement:1")

    def test_explicit_global_duration_ignores_other_dates(self):
        content = (
            '<p>Other date: &lt;t class="t_gl"&gt;2026/01/01 06:00&lt;/t&gt;</p>'
            '<p>〓Event Duration〓</p>&lt;t class="t_gl"&gt;2026/10/01 10:00&lt;/t&gt; – '
            '&lt;t class="t_gl"&gt;2026/11/03 14:59&lt;/t&gt;<p>〓Eligibility〓</p>'
            '&lt;t class="t_gl"&gt;2027/01/01 10:00&lt;/t&gt;'
        )
        event = self.extract(notice(content=content))[0]
        self.assertEqual(
            event["end_time"], int(datetime.fromisoformat("2026-11-03T14:59:59+08:00").timestamp())
        )

    def test_merge_preserves_account_progress_and_rewards(self):
        supplement = self.extract(notice())[0]
        original = dict(
            supplement,
            id=42,
            name="<b>EXAMPLE!</b>",
            is_finished=True,
            rewards=[{"id": 1}],
            progress_available=True,
        )
        merged = merge_announcement_events([original], [supplement])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["id"], 42)
        self.assertTrue(merged[0]["is_finished"])
        self.assertEqual(merged[0]["rewards"], [{"id": 1}])
        different_period = dict(original, start_time=1, end_time=2)
        self.assertEqual(len(merge_announcement_events([different_period], [supplement])), 2)


if __name__ == "__main__":
    unittest.main()
