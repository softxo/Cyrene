import copy
import unittest

from utils.web.limited_event_checks import apply_archon_quest_progress, apply_completion_checks

NAME = "A Rekviem for the Underworld"


def event(**changes):
    return dict(
        name=NAME,
        quest_type="archon",
        quest_is_mainline=True,
        progress_available=False,
        is_finished=False,
        is_upcoming=False,
        start_time=10,
        end_time=100,
        **changes,
    )


def notes(quests=None, **changes):
    return {
        "retcode": 0,
        "data": {
            "archon_quest_progress": dict(
                list=[] if quests is None else quests,
                is_open_archon_quest=True,
                is_finish_all_mainline=False,
                **changes,
            )
        },
    }


class ArchonQuestProgressTests(unittest.TestCase):
    def test_target_act_completed_without_finishing_all_mainline_quests(self):
        events = [event()]
        events[0]["quest_chapter"] = "Chapter VII: Act IV"
        response = notes(
            [
                {
                    "chapter_title": "A localized title",
                    "chapter_num": "Chapter VII: Act IV",
                    "status": "StatusFinished",
                },
                {"chapter_title": "Earlier quest", "status": "StatusOngoing"},
            ]
        )
        apply_archon_quest_progress(events, response, 50)
        self.assertTrue(events[0]["is_finished"])
        self.assertTrue(events[0]["progress_available"])
        self.assertFalse(response["data"]["archon_quest_progress"]["is_finish_all_mainline"])

    def test_live_completed_account_shape_uses_explicit_mainline_flag(self):
        response = notes()
        response["data"]["archon_quest_progress"].update(
            is_finish_all_mainline=True,
            is_finish_all_interchapter=True,
        )
        events = [event()]
        apply_archon_quest_progress(events, response, 50)
        self.assertTrue(events[0]["is_finished"])
        self.assertTrue(events[0]["progress_available"])
        self.assertIn("claiming is not reported", events[0]["description"])

    def test_empty_missing_unavailable_or_disabled_notes_do_not_complete(self):
        for response in (
            {},
            {"retcode": -1},
            notes(),
            {"retcode": 0, "data": {"archon_quest_progress": None}},
            {
                "retcode": 0,
                "data": {
                    "archon_quest_progress": {
                        "list": [],
                        "is_open_archon_quest": False,
                        "is_finish_all_mainline": True,
                    }
                },
            },
        ):
            with self.subTest(response=response):
                events = [event()]
                apply_archon_quest_progress(events, response, 50)
                self.assertFalse(events[0]["is_finished"])
                self.assertFalse(events[0]["progress_available"])

    def test_matching_explicit_statuses(self):
        for status, expected in (
            ("StatusFinished", True),
            ("StatusOngoing", False),
            ("StatusNotOpen", False),
        ):
            events = [event()]
            apply_archon_quest_progress(
                events,
                notes(
                    [
                        {"id": 42, "chapter_title": NAME, "status": status},
                    ]
                ),
                50,
            )
            self.assertEqual(events[0]["is_finished"], expected)
            self.assertTrue(events[0]["progress_available"])

    def test_absence_other_chapters_unknown_and_conflicting_statuses_stay_unknown(self):
        for quests in (
            [{"chapter_title": "Another quest", "status": "StatusFinished"}],
            [{"chapter_title": NAME, "status": "UnknownStatus"}],
            [
                {"chapter_title": NAME, "status": "StatusFinished"},
                {"chapter_title": NAME, "status": "StatusOngoing"},
            ],
        ):
            events = [event()]
            apply_archon_quest_progress(events, notes(quests), 50)
            self.assertFalse(events[0]["progress_available"])

    def test_unrelated_future_expired_interlude_and_calendar_events_are_not_inferred(self):
        response = notes()
        response["data"]["archon_quest_progress"]["is_finish_all_mainline"] = True
        for changes in (
            {"quest_type": None},
            {"quest_is_mainline": False},
            {"is_upcoming": True},
            {"start_time": 51},
            {"end_time": 50},
            {"progress_available": True},
        ):
            events = [event()]
            events[0].update(changes)
            original = copy.deepcopy(events)
            apply_archon_quest_progress(events, response, 50)
            self.assertEqual(events, original)

    def test_matching_pending_status_precedes_global_flag(self):
        response = notes([{"chapter_title": NAME, "status": "StatusOngoing"}])
        response["data"]["archon_quest_progress"]["is_finish_all_mainline"] = True
        events = [event()]
        apply_archon_quest_progress(events, response, 50)
        self.assertFalse(events[0]["is_finished"])

    def test_account_results_and_manual_override_remain_separate(self):
        account_a, account_b = [event()], [event()]
        response = notes()
        response["data"]["archon_quest_progress"]["is_finish_all_mainline"] = True
        apply_archon_quest_progress(account_a, response, 50)
        apply_archon_quest_progress(account_b, notes(), 50)
        apply_completion_checks(account_a, {})
        apply_completion_checks(account_b, {})
        self.assertTrue(account_a[0]["automatic_finished"])
        self.assertFalse(account_b[0]["automatic_finished"])
        key = account_a[0]["completion_key"]
        apply_completion_checks(account_a, {key: False})
        self.assertTrue(account_a[0]["is_finished"])
