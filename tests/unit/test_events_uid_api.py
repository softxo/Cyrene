import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from utils.web import app as web


class EventsUidApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_objective_progress_is_clamped_after_target_changes(self):
        event = {"id": 71, "progress": [{"title": "Reputation", "target": 5, "current": 2}]}
        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=20)),
            patch.object(web, "get_accounts", AsyncMock(return_value=[{"id": 93}])),
            patch.object(web, "get_custom_events", AsyncMock(return_value=[event])),
            patch.object(web, "get_custom_event_account_progress", AsyncMock(return_value={0: 9})),
            patch.object(web, "get_custom_event_completions", AsyncMock(return_value=[])),
        ):
            response = await web.api_get_custom_events("session", 93)
        self.assertEqual(response["events"][0]["progress"][0]["current"], 5)

    async def test_new_objective_retains_initial_progress_until_uid_record_exists(self):
        event = {"id": 71, "progress": [{"title": "Reputation", "target": 5, "current": 2}]}
        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=20)),
            patch.object(web, "get_accounts", AsyncMock(return_value=[{"id": 93}])),
            patch.object(web, "get_custom_events", AsyncMock(return_value=[event])),
            patch.object(web, "get_custom_event_account_progress", AsyncMock(return_value={})),
            patch.object(web, "get_custom_event_completions", AsyncMock(return_value=[])),
        ):
            response = await web.api_get_custom_events("session", 93)
        self.assertEqual(response["events"][0]["progress"][0]["current"], 2)

    async def test_all_account_edit_is_forwarded_without_creating_duplicates(self):
        fields = {"account_scope": "all", "account_id": None}
        update = AsyncMock(return_value={"id": 71})
        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=20)),
            patch.object(web, "get_custom_event", AsyncMock(return_value={"id": 71})),
            patch.object(web, "validate_custom_event_payload", AsyncMock(return_value=fields)),
            patch.object(web, "update_custom_event", update),
            patch.object(web, "get_custom_event_completions", AsyncMock(return_value=[])),
        ):
            result = await web.api_update_custom_event(
                71, SimpleNamespace(json=AsyncMock(return_value=fields)), "session"
            )
        self.assertTrue(result["success"])
        update.assert_awaited_once_with(discord_user_id=20, event_id=71, **fields)
