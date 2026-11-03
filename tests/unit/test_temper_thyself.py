import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from utils.web import app as web
from utils.web.temper_thyself import build_temper_thyself, is_temper_thyself

TITLE = "To Temper Thyself and Journey Far"
NOW = 1793620800


def event(**changes):
    return SimpleNamespace(
        **dict(name=TITLE, start_timestamp=NOW - 3600, end_timestamp=NOW + 86400, is_finished=False)
        | changes
    )


class TemperThyselfTests(unittest.TestCase):
    def test_recognises_official_and_short_names_but_not_other_tempering_events(self):
        self.assertTrue(is_temper_thyself(TITLE))
        self.assertTrue(is_temper_thyself("<b>Temper Thyself</b>"))
        self.assertTrue(is_temper_thyself('"' + TITLE + '": Rewards of Dedication'))
        self.assertFalse(is_temper_thyself("The Forge Realm's Temper"))

    def test_unavailable_progress_still_has_a_permanent_entry(self):
        data = build_temper_thyself(now=NOW)
        self.assertEqual(data["name"], TITLE)
        self.assertFalse(data["has_data"])
        self.assertFalse(data["is_finished"])
        self.assertEqual(data["end_time"], 0)

    def test_active_cycle_wins_over_a_future_cycle_or_expired_completed_cycle(self):
        data = build_temper_thyself(
            [
                event(start_timestamp=NOW + 86400, is_finished=True),
                event(end_timestamp=NOW - 1, is_finished=True),
                event(),
            ],
            now=NOW,
        )
        self.assertTrue(data["has_data"])
        self.assertFalse(data["is_finished"])
        self.assertFalse(data["is_upcoming"])
        self.assertEqual(data["start_time"], NOW - 3600)

    def test_completion_only_comes_from_current_account_calendar(self):
        self.assertTrue(build_temper_thyself([event(is_finished=True)], now=NOW)["is_finished"])
        self.assertFalse(
            build_temper_thyself([event(end_timestamp=NOW, is_finished=True)], now=NOW)["has_data"]
        )
        self.assertFalse(
            build_temper_thyself([event(start_timestamp=NOW + 100, is_finished=True)], now=NOW)[
                "is_finished"
            ]
        )

    def test_explicit_official_notice_dates_supply_a_window_but_not_progress(self):
        notice = SimpleNamespace(
            title=TITLE,
            content='<p>Event Duration</p><t class="t_lc">2026/11/02 04:00</t> - <t class="t_lc">2027/01/25 03:59</t>',
        )
        data = build_temper_thyself(announcements=[notice], server="os_euro", now=NOW)
        self.assertGreater(data["end_time"], NOW)
        self.assertLess(data["start_time"], NOW)
        self.assertFalse(data["has_data"])
        self.assertFalse(data["is_finished"])
        self.assertEqual(
            build_temper_thyself(announcements=[notice], server="unknown", now=NOW)["end_time"], 0
        )

    def test_publication_dates_and_eligibility_dates_are_not_cycle_dates(self):
        notice = SimpleNamespace(
            title=TITLE,
            start_time=NOW - 1,
            end_time=NOW + 500,
            content='<p>Event Eligibility</p><t class="t_lc">2026/11/02 04:00</t><t class="t_lc">2027/01/25 03:59</t>',
        )
        self.assertEqual(
            build_temper_thyself(announcements=[notice], server="os_euro", now=NOW)["end_time"], 0
        )
        notice.content = '<p>Event Duration: Available permanently</p><p>Participation Requirements</p><t class="t_lc">2026/11/02 04:00</t><t class="t_lc">2027/01/25 03:59</t>'
        self.assertEqual(
            build_temper_thyself(announcements=[notice], server="os_euro", now=NOW)["end_time"], 0
        )

    def test_live_notes_zero_is_available_and_escaped_notice_has_cycle_dates(self):
        import html

        notice = SimpleNamespace(
            title=TITLE,
            content=html.escape(
                '<p>Event Duration</p><t class="t_lc">2026/11/02 04:00</t> - <t class="t_lc">2027/01/25 03:59</t>'
            ),
        )
        progress = dict(
            progress_current=0,
            progress_total=5,
            period_progress_current=0,
            period_progress_total=8,
            unlock=True,
            is_active_period=True,
            current_weekday=1,
            progress_current_arr=[],
        )
        data = build_temper_thyself(
            announcements=[notice],
            server="os_euro",
            now=NOW,
            notes={"week_active_progress": progress},
            weekly_end=NOW + 100,
        )
        self.assertTrue(data["has_data"])
        self.assertEqual(
            (data["days_completed"], data["days_total"], data["days_required"]), (0, 7, 5)
        )
        self.assertEqual(data["weeks_required"], 8)
        self.assertGreater(data["end_time"], NOW)
        self.assertEqual(data["weekly_end"], NOW + 100)
        progress.update(progress_current=5, period_progress_current=8)
        data = build_temper_thyself(notes={"week_active_progress": progress})
        self.assertTrue(data["weekly_finished"])
        self.assertFalse(data["is_finished"])
        for changes in ({"unlock": False}, {"is_active_period": False}, {"progress_current": None}):
            with self.subTest(changes=changes):
                self.assertFalse(
                    build_temper_thyself(notes={"week_active_progress": progress | changes})[
                        "has_data"
                    ]
                )


class TemperThyselfIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        saved = patch.object(web, "get_event_activity_checks", AsyncMock(return_value={}))
        saved.start()
        self.addCleanup(saved.stop)

    async def test_account_and_overview_keep_the_entry_during_upstream_unavailability(self):
        account = {
            "id": 91,
            "genshin_uid": "777000091",
            "genshin_server": "os_euro",
            "nickname": "Test",
        }
        web._events_cache.clear()
        with (
            patch.object(web, "get_accounts", AsyncMock(return_value=[account])),
            patch.object(web, "get_account_client", AsyncMock(return_value=None)),
        ):
            normal = await web.get_events_data(10, 91)
            overview = await web.get_events_data(10, 91, True)
        self.assertEqual(normal["temper_thyself"]["name"], TITLE)
        self.assertFalse(normal["temper_thyself"]["has_data"])
        self.assertEqual(overview["overview_data"][0]["temper_thyself"], normal["temper_thyself"])
        self.assertEqual(normal["limited_events"], [])
        web._events_cache.clear()

    async def test_saved_checks_survive_unavailable_hoyolab(self):
        account = {"id": 94, "genshin_uid": "777000094", "genshin_server": "os_euro"}
        web._events_cache.clear()
        with (
            patch.object(web, "get_account_client", AsyncMock(return_value=None)),
            patch.object(
                web,
                "get_event_activity_checks",
                AsyncMock(
                    return_value={
                        "daily_commissions": True,
                        "trounce_domains": True,
                        "temper_thyself": True,
                    }
                ),
            ),
        ):
            result = await web.get_single_account_events(10, account)
        self.assertTrue(result["daily"]["checked"])
        self.assertTrue(result["trounce"]["checked"])
        self.assertTrue(result["temper_thyself"]["checked"])
        web._events_cache.clear()


class TemperCacheTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        saved = patch.object(web, "get_event_activity_checks", AsyncMock(return_value={}))
        saved.start()
        self.addCleanup(saved.stop)

    async def test_finished_cycle_does_not_survive_inside_cache_ttl(self):
        account = {"id": 92, "genshin_uid": "777000092", "genshin_server": "os_euro"}
        web._events_cache.clear()
        with patch.object(web, "get_account_client", AsyncMock(return_value=None)) as fetch:
            first = await web.get_single_account_events(10, account)
            first["temper_thyself"].update(end_time=1, has_data=True, is_finished=True)
            refreshed = await web.get_single_account_events(10, account)
        self.assertEqual(fetch.await_count, 2)
        self.assertFalse(refreshed["temper_thyself"]["is_finished"])
        web._events_cache.clear()

    async def test_week_reset_invalidates_cached_training_progress(self):
        account = {"id": 93, "genshin_uid": "777000093", "genshin_server": "os_euro"}
        web._events_cache.clear()
        with patch.object(web, "get_account_client", AsyncMock(return_value=None)) as fetch:
            first = await web.get_single_account_events(10, account)
            first["temper_thyself"].update(weekly_end=1, has_data=True, days_completed=5)
            refreshed = await web.get_single_account_events(10, account)
        self.assertEqual(fetch.await_count, 2)
        self.assertIsNone(refreshed["temper_thyself"]["days_completed"])
        web._events_cache.clear()


class NotesEnvelopeTests(unittest.IsolatedAsyncioTestCase):
    async def test_raw_sdk_notes_keep_success_envelope_for_archon_completion(self):
        from utils.hoyolab.client import HoYoLABClient
        from utils.web.limited_event_checks import apply_archon_quest_progress

        raw = {
            "archon_quest_progress": {
                "is_open_archon_quest": True,
                "is_finish_all_mainline": True,
                "list": [],
            },
            "week_active_progress": {"progress_current": 0},
        }
        client = SimpleNamespace(
            session=object(),
            genshin_uid="777527709",
            genshin_server="os_euro",
            genshin_client=SimpleNamespace(request_game_record=AsyncMock(return_value=raw)),
        )
        response = await HoYoLABClient.get_genshin_notes(client)
        events = [
            dict(
                name="A Rekviem for the Underworld",
                quest_type="archon",
                quest_is_mainline=True,
                progress_available=False,
                is_finished=False,
                start_time=1,
                end_time=100,
            )
        ]
        apply_archon_quest_progress(events, response, 50)
        self.assertEqual(response["retcode"], 0)
        self.assertTrue(events[0]["is_finished"])
        self.assertEqual(response["data"]["week_active_progress"], raw["week_active_progress"])
