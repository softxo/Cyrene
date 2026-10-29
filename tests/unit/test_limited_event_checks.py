import json
import os
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from utils.web import app as web
from utils.web.limited_event_checks import apply_completion_checks, completion_key, completion_token


def event(**changes):
    return dict(name="Example Event", end_time=1900000000, is_finished=False, **changes)


class CompletionIdentityTests(unittest.TestCase):
    def test_source_changes_keep_identity_but_future_runs_are_independent(self):
        self.assertEqual(completion_key(event(id=1)), completion_key(event(id="announcement:2")))
        next_run = event()
        next_run["end_time"] += 86400
        self.assertNotEqual(completion_key(event()), completion_key(next_run))

    def test_automatic_completion_wins_over_manual_false(self):
        automatic = event()
        automatic["is_finished"] = True
        events = [automatic]
        apply_completion_checks(events, {})
        self.assertTrue(events[0]["is_finished"])
        automatic = event()
        automatic["is_finished"] = True
        apply_completion_checks([automatic], {completion_key(automatic): False})
        self.assertTrue(automatic["is_finished"])
        manual = event()
        apply_completion_checks([manual], {completion_key(manual): True})
        self.assertTrue(manual["is_finished"])


class CompletionEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def post(self, payload, accounts=None):
        account = {"id": 1, "genshin_uid": "700000001", "genshin_server": "os_euro"}
        events = [event()]
        apply_completion_checks(events, {})
        with (
            patch.dict(os.environ, {"HOYOLAB_ENCRYPTION_KEY": "test-key"}),
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=10)),
            patch.object(
                web,
                "get_accounts",
                AsyncMock(return_value=[account] if accounts is None else accounts),
            ),
            patch.object(
                web,
                "get_single_account_events",
                AsyncMock(side_effect=AssertionError("No upstream fetch should be needed")),
            ),
            patch.object(web, "set_event_activity_check", AsyncMock()) as save,
        ):
            payload = dict(payload)
            payload.setdefault(
                "event_token",
                completion_token(10, "700000001", payload["event_key"], int(time.time()) + 3600),
            )
            response = await web.update_event_activity_check(
                SimpleNamespace(json=AsyncMock(return_value=payload)), "session"
            )
            return response, save.await_args

    async def test_save_targets_authenticated_user_uid_and_event(self):
        key = completion_key(event())
        response, args = await self.post(
            {"account_id": 1, "activity_type": "limited_event", "event_key": key, "checked": True}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(args.args, (10, "700000001", "limited_event", key, True))
        self.assertTrue(json.loads(response.body)["checked"])

    async def test_other_accounts_and_unknown_events_cannot_be_written(self):
        payload = {
            "account_id": 2,
            "activity_type": "limited_event",
            "event_key": completion_key(event()),
            "checked": True,
        }
        response, args = await self.post(payload)
        self.assertEqual(response.status_code, 404)
        self.assertIsNone(args)

    async def test_invalid_and_cross_account_tokens_are_rejected(self):
        payload = {
            "account_id": 1,
            "activity_type": "limited_event",
            "event_key": completion_key(event()),
            "checked": True,
            "event_token": "invalid",
        }
        response, args = await self.post(payload)
        self.assertEqual(response.status_code, 404)
        self.assertIsNone(args)
        with patch.dict(os.environ, {"HOYOLAB_ENCRYPTION_KEY": "test-key"}):
            payload["event_token"] = completion_token(
                10, "700000002", payload["event_key"], int(time.time()) + 3600
            )
        response, args = await self.post(payload)
        self.assertEqual(response.status_code, 404)
        self.assertIsNone(args)
        payload.update(account_id=1, event_key="invalid")
        response, args = await self.post(payload)
        self.assertEqual(response.status_code, 404)
        self.assertIsNone(args)


if __name__ == "__main__":
    unittest.main()
