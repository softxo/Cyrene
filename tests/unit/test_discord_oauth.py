import json
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from utils.web import discord_oauth as oauth
from utils.web.app import app


class DiscordOAuthTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            "os.environ",
            {
                "DISCORD_CLIENT_ID": "123",
                "DISCORD_CLIENT_SECRET": "secret",
                "DISCORD_REDIRECT_URI": "https://testserver/auth/discord/callback",
                "HOYOLAB_ENCRYPTION_KEY": Fernet.generate_key().decode(),
            },
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.client = TestClient(app, base_url="https://testserver", follow_redirects=False)

    def begin(self, destination="/settings"):
        response = self.client.get("/auth/discord", params={"next": destination})
        query = parse_qs(urlsplit(response.headers["location"]).query)
        self.assertEqual(query["scope"], ["identify"])
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertIn("Secure", response.headers["set-cookie"])
        return query["state"][0]

    def test_invalid_state_denial_and_missing_cookie_never_exchange(self):
        state = self.begin()
        with patch.object(oauth, "exchange", AsyncMock()) as exchange:
            response = self.client.get(
                "/auth/discord/callback", params={"state": "wrong", "code": "code"}
            )
            self.assertIn("discord_error=failed", response.headers["location"])
            self.client.get("/auth/discord/callback", params={"state": state, "code": "code"})
            state = self.begin()
            self.client.get(
                "/auth/discord/callback", params={"state": state, "error": "access_denied"}
            )
            exchange.assert_not_awaited()

    def test_success_uses_discord_identity_and_secure_session(self):
        state = self.begin()
        profile = SimpleNamespace(user_id=7)
        context = AsyncMock()
        with (
            patch.object(
                oauth,
                "exchange",
                AsyncMock(return_value={"scope": "identify", "access_token": "access"}),
            ),
            patch.object(oauth, "fetch_profile", AsyncMock(return_value=profile)),
            patch.object(
                oauth, "get_pool", return_value=SimpleNamespace(connection=lambda: context)
            ),
            patch.object(oauth, "save_tokens", AsyncMock()) as tokens,
            patch.object(oauth, "save_discord_profile", AsyncMock()) as save,
            patch.object(
                oauth,
                "create_web_session",
                AsyncMock(return_value=SimpleNamespace(token="session")),
            ) as session,
        ):
            response = self.client.get(
                "/auth/discord/callback", params={"state": state, "code": "code"}
            )
        self.assertEqual(response.headers["location"], "/settings")
        session.assert_awaited_once_with(7)
        save.assert_awaited_once_with(profile)
        self.assertEqual(tokens.await_args.args[0], 7)
        self.assertIn("cyrene_session=session", response.headers["set-cookie"])

    def test_expired_cookie_is_rejected(self):
        with patch("time.time", return_value=1000):
            raw = oauth.HoYoLABCrypto().encrypt(json.dumps({"state": "old", "next": "/"}))
        self.client.cookies.set(oauth.STATE_COOKIE, raw, path="/auth/discord")
        with patch.object(oauth, "exchange", AsyncMock()) as exchange:
            self.client.get("/auth/discord/callback?state=old&code=code")
        exchange.assert_not_awaited()

    def test_destinations_cannot_redirect_to_other_origins(self):
        for destination in [
            "//evil.example",
            "/\\evil.example",
            "https://evil.example",
            "/\n/evil.example",
        ]:
            self.assertEqual(oauth.safe_next(destination), "/verify")

    def test_unconfigured_authorisation_keeps_button_and_code_visible(self):
        with (
            patch.object(oauth, "configuration", return_value=None),
            patch("utils.web.app.get_web_session", AsyncMock(return_value=None)),
        ):
            response = self.client.get("/verify")
            self.assertIn("Authorise with Discord", response.text)
            self.assertIn('id="verification-code"', response.text)
            redirect = self.client.get("/auth/discord")
            self.assertEqual(redirect.headers["location"], "/verify?discord_error=unavailable")
            response = self.client.get(redirect.headers["location"])
            self.assertIn("Discord authorisation is not available yet", response.text)
            self.assertIn("Authorise with Discord", response.text)


class RefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_expired_tokens_rotate_and_profile_identity_is_checked(self):
        crypto = SimpleNamespace(decrypt=lambda value: value)
        row = {
            "access_token": "old",
            "refresh_token": "refresh",
            "expires_at": datetime.now(timezone.utc) - timedelta(seconds=1),
        }
        connection = SimpleNamespace(
            execute=AsyncMock(return_value=SimpleNamespace(fetchone=AsyncMock(return_value=row)))
        )
        context = AsyncMock()
        context.__aenter__.return_value = connection
        with (
            patch.object(oauth, "configuration", return_value=("id", "secret", "redirect")),
            patch.object(
                oauth, "get_pool", return_value=SimpleNamespace(connection=lambda: context)
            ),
            patch.object(oauth, "HoYoLABCrypto", return_value=crypto),
            patch.object(
                oauth, "exchange", AsyncMock(return_value={"access_token": "new"})
            ) as exchange,
            patch.object(oauth, "save_tokens", AsyncMock()) as save,
            patch.object(oauth, "fetch_profile", AsyncMock()) as profile,
            patch.object(oauth, "save_discord_profile", AsyncMock()),
        ):
            await oauth.refresh_profile(7)
        exchange.assert_awaited_once_with(grant_type="refresh_token", refresh_token="refresh")
        profile.assert_awaited_once_with("new", 7)
        save.assert_awaited_once()

    async def test_outage_preserves_saved_profile(self):
        with (
            patch.object(oauth, "configuration", return_value=True),
            patch.object(oauth, "get_pool", side_effect=oauth.DiscordUnavailable),
            patch.object(oauth, "save_discord_profile", AsyncMock()) as save,
        ):
            await oauth.refresh_profile(7)
        save.assert_not_awaited()
