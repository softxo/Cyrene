import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from utils.web import app as web


class RemindersPageTests(unittest.TestCase):
    def test_legacy_page_redirect_preserves_tab(self):
        response = TestClient(web.app).get("/planner?tab=transformer", follow_redirects=False)
        self.assertEqual(response.status_code, 308)
        self.assertEqual(response.headers["location"], "/reminders?tab=transformer")

    def test_new_page_labels_and_mode_selector(self):
        with (
            patch.object(
                web, "get_web_session", AsyncMock(return_value=SimpleNamespace(user_id=10))
            ),
            patch.object(web, "get_accounts", AsyncMock(return_value=[{"genshin_uid": "123"}])),
        ):
            response = TestClient(web.app).get("/reminders")
        self.assertEqual(response.status_code, 200)
        self.assertIn('href="/reminders"', response.text)
        self.assertIn("<span>Reminders</span>", response.text)
        self.assertIn('id="reminder-create-mode"', response.text)
        self.assertNotIn("<span>Planner</span>", response.text)

    def test_both_modes_can_be_created_for_every_active_type(self):
        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=10)),
            patch.object(web, "get_accounts", AsyncMock(return_value=[{"genshin_uid": "123"}])),
            patch.object(web, "_realm_currency_capacity", AsyncMock(return_value=2000)),
            patch.object(web, "create_reminder", AsyncMock(return_value=1)) as create,
        ):
            client = TestClient(web.app)
            for kind in ("resin", "teapot", "expedition", "transformer"):
                for mode in ("automatic", "manual"):
                    with self.subTest(kind=kind, mode=mode):
                        response = client.post(
                            "/api/reminders",
                            json={
                                "type": kind,
                                "mode": mode,
                                "genshin_uid": "123",
                                "config": {"amount": 160},
                            },
                        )
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(create.await_args.kwargs["reminder_mode"], mode)
