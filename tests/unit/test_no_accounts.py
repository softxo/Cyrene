import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from utils.web import app as web


class NoAccountsTests(unittest.TestCase):
    paths = [
        "/characters",
        "/weapons",
        "/inventory",
        "/planner",
        "/events",
        "/achievements",
        "/wishes",
        "/codes",
    ]

    def test_account_pages_share_the_same_empty_state(self):
        client = TestClient(web.app)
        with (
            patch.object(
                web, "get_web_session", AsyncMock(return_value=SimpleNamespace(user_id=7))
            ),
            patch.object(web, "get_accounts", AsyncMock(return_value=[])),
        ):
            for path in [*self.paths, "/events?overview=true", "/events/refresh"]:
                with self.subTest(path=path):
                    response = client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.text.count("data-no-accounts"), 1)
                    self.assertIn("No accounts added", response.text)
                    self.assertIn(
                        'class="cyrene-button no-accounts-action" href="/settings"', response.text
                    )
                    self.assertNotIn("No accounts connected", response.text)
                    self.assertNotIn('id="planner-loading"', response.text)

    def test_sign_in_requirements_are_preserved(self):
        with patch.object(web, "get_web_session", AsyncMock(return_value=None)):
            for path in self.paths:
                with self.subTest(path=path):
                    response = TestClient(web.app).get(path, follow_redirects=False)
                    self.assertEqual(response.status_code, 303)
                    self.assertEqual(response.headers["location"], f"/verify?next={path}")

    def test_home_discord_and_settings_keep_their_content(self):
        with patch.object(web, "get_web_session", AsyncMock(return_value=None)):
            for path, content in [
                ("/", "Your adventure"),
                ("/verify", "Verify your account"),
                ("/settings", "HoYoLAB Accounts"),
            ]:
                with self.subTest(path=path):
                    response = TestClient(web.app).get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertNotIn("data-no-accounts", response.text)
                    self.assertIn(content, response.text)
