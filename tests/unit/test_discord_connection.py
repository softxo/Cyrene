import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from utils.web import app as web
from utils.web import auth


class DiscordConnectionTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(web.app)

    def test_signed_out_keeps_verification_screen(self):
        with (
            patch.object(web, "get_web_session", AsyncMock(return_value=None)),
            patch.object(web, "get_discord_profile", AsyncMock()) as profile,
        ):
            response = self.client.get("/verify")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("data-discord-connected-panel", response.text)
        self.assertIn("data-verification-flow >", response.text)
        profile.assert_not_awaited()

    def test_connected_page_shows_identity_and_escapes_names(self):
        profile = {
            "id": "1557792995179495497",
            "username": "example",
            "display_name": '<img src=x onerror="bad()">',
            "avatar_url": "/static/images/ui/ui_icons/Discord.png",
        }
        with (
            patch.object(
                web, "get_web_session", AsyncMock(return_value=SimpleNamespace(user_id=7))
            ),
            patch.object(web, "get_discord_profile", AsyncMock(return_value=profile)) as load,
        ):
            response = self.client.get("/verify", cookies={"cyrene_session": "session"})
        load.assert_awaited_once_with(7)
        self.assertIn("data-discord-connected-panel", response.text)
        self.assertIn("@example", response.text)
        self.assertIn("1557792995179495497", response.text)
        self.assertIn("&lt;img", response.text)
        self.assertIn("data-verification-flow hidden", response.text)

    def test_disconnect_only_deletes_the_current_web_session(self):
        with (
            patch.object(web, "delete_web_session", AsyncMock()) as delete,
            patch.object(web, "delete_account", AsyncMock()) as unlink,
        ):
            response = self.client.post(
                "/api/auth/logout", cookies={"cyrene_session": "current-session"}
            )
        self.assertEqual(response.status_code, 200)
        delete.assert_awaited_once_with("current-session")
        unlink.assert_not_awaited()
        self.assertIn("Max-Age=0", response.headers["set-cookie"])

    def test_claim_captures_profile_and_cannot_be_reassigned(self):
        verification = auth.create_verification()
        self.addCleanup(auth._verifications.pop, verification.token, None)
        self.assertTrue(
            auth.claim_verification(verification.code, 7, "example", "Example", "a" * 32)
        )
        self.assertEqual(verification.username, "example")
        self.assertEqual(verification.display_name, "Example")
        self.assertFalse(auth.claim_verification(verification.code, 8, "another"))
        self.assertEqual(verification.user_id, 7)

    def test_pending_request_keeps_current_session_then_success_replaces_cookie(self):
        verification = auth.create_verification()
        self.addCleanup(auth._verifications.pop, verification.token, None)
        with (
            patch.object(
                web,
                "create_web_session",
                AsyncMock(return_value=SimpleNamespace(token="new-session")),
            ) as create,
            patch.object(web, "save_discord_profile", AsyncMock()) as save,
        ):
            response = self.client.get(
                f"/api/verify/status?token={verification.token}",
                cookies={"cyrene_session": "old-session"},
            )
            self.assertEqual(response.json(), {"verified": False})
            self.assertNotIn("set-cookie", response.headers)
            create.assert_not_awaited()
            self.assertTrue(auth.claim_verification(verification.code, 8, "new-user"))
            response = self.client.get(
                f"/api/verify/status?token={verification.token}",
                cookies={"cyrene_session": "old-session"},
            )
        self.assertEqual(response.json(), {"verified": True})
        create.assert_awaited_once_with(8)
        save.assert_awaited_once_with(verification)
        self.assertIn("cyrene_session=new-session", response.headers["set-cookie"])
        self.assertIn("HttpOnly", response.headers["set-cookie"])


class DiscordProfileTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_account_profile_fallback_and_avatar_validation(self):
        for saved, expected_avatar in [
            (None, "/static/images/ui/ui_icons/Discord.png"),
            (
                {"username": "name", "display_name": "Name", "avatar_hash": "javascript:bad"},
                "/static/images/ui/ui_icons/Discord.png",
            ),
            (
                {"username": "name", "display_name": "Name", "avatar_hash": "a" * 32},
                f"https://cdn.discordapp.com/avatars/7/{'a' * 32}.png?size=128",
            ),
        ]:
            result = SimpleNamespace(
                fetchone=AsyncMock(
                    side_effect=[saved, {"username": "old-name", "display_name": "Old Name"}]
                )
            )
            connection = SimpleNamespace(execute=AsyncMock(return_value=result))
            context = AsyncMock()
            context.__aenter__.return_value = connection
            with patch.object(
                auth, "get_pool", return_value=SimpleNamespace(connection=lambda: context)
            ):
                profile = await auth.get_discord_profile(7)
            self.assertEqual(profile["id"], "7")
            self.assertEqual(profile["avatar_url"], expected_avatar)
            self.assertEqual(profile["display_name"], "Old Name" if saved is None else "Name")
