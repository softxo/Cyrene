import asyncio
import json
import time
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import genshin
from fastapi import HTTPException, Request
from genshin.models.auth import ActionTicket, AppLoginResult
from genshin.models.auth.geetest import SessionMMT, SessionMMTv4

from utils.hoyolab import database, login
from utils.hoyolab.auth import HoYoLABCredentials
from utils.hoyolab.client import HoYoLABClient
from utils.hoyolab.errors import HoYoLABVerificationError
from utils.hoyolab.refresh_login import _device_id, login_with_refresh_credentials
from utils.web import app as web
from utils.web import sessions
from utils.web.app import challenge, challenge_send_data


def app_result():
    return AppLoginResult(
        stoken="refresh",
        ltuid_v2="123",
        ltmid_v2="mid",
        account_id_v2="123",
        account_mid_v2="mid",
    )


class RefreshLoginTests(unittest.IsolatedAsyncioTestCase):
    async def authenticate(self, responses, email_challenges=None):
        client = SimpleNamespace(
            generate_app_device_id=Mock(return_value="device"),
            _app_login=AsyncMock(side_effect=responses),
            _send_verification_email=AsyncMock(side_effect=email_challenges or [None]),
            _verify_email=AsyncMock(),
            set_cookies=Mock(),
        )

        async def submit_captcha(mmt, validate=None):
            if validate is not None:
                return await validate("captcha-result")
            return "captcha-result"

        solve = AsyncMock(side_effect=submit_captcha)

        async def submit_email(verify):
            await verify("123456")

        email = AsyncMock(side_effect=submit_email)
        with patch(
            "utils.hoyolab.refresh_login.genshin.fetch_cookie_with_stoken_v2",
            AsyncMock(return_value={"ltoken_v2": "login", "cookie_token_v2": "redeem"}),
        ) as mint:
            cookies = await login_with_refresh_credentials(
                client, "account", "password", solve=solve, email_code=email
            )
        return client, solve, email, mint, cookies

    async def test_password_login_mints_both_cookies_and_retains_stoken(self):
        client, solve, email, mint, cookies = await self.authenticate([app_result()])
        self.assertEqual(cookies["stoken"], "refresh")
        self.assertEqual(cookies["cookie_token_v2"], "redeem")
        self.assertEqual(mint.await_args.kwargs["token_types"], [2, 4])
        client.set_cookies.assert_called_once_with(cookies)
        solve.assert_not_awaited()
        email.assert_not_awaited()

    async def test_shared_password_login_passes_refresh_token_to_encrypted_storage(self):
        cookies = app_result().model_dump() | {"ltoken_v2": "login", "cookie_token_v2": "redeem"}
        client = Mock()
        connection = AsyncMock()
        pool = MagicMock()
        pool.connection.return_value.__aenter__.return_value = connection
        crypto = Mock()
        crypto.encrypt.side_effect = lambda value: f"encrypted:{value}"
        with (
            patch.object(login.genshin, "Client", return_value=client),
            patch.object(login, "login_with_refresh_credentials", AsyncMock(return_value=cookies)),
            patch.object(database, "get_pool", return_value=pool),
            patch.object(database, "HoYoLABCrypto", return_value=crypto),
        ):
            returned, credentials = await login.login_with_password(
                "account", "password", user_id=1, notify=AsyncMock()
            )
            self.assertIs(returned, client)
            await database.save_account(
                1, credentials, genshin_uid="785050004", genshin_server="os_euro"
            )
        self.assertEqual(credentials.stoken, "refresh")
        self.assertIn("encrypted:refresh", connection.execute.await_args.args[1])
        self.assertNotIn("refresh", connection.execute.await_args.args[1])

    async def test_abandoned_email_verification_cleans_up_and_fails(self):
        async def authenticate(client, account, password, *, solve, email_code):
            await email_code(AsyncMock())

        initial_sessions = set(sessions._sessions)
        with (
            patch.object(login, "login_with_refresh_credentials", authenticate),
            patch.object(login, "SESSION_TIMEOUT", 0.001),
        ):
            with self.assertRaises(HoYoLABVerificationError):
                await login.login_with_password(
                    "account", "password", user_id=1, notify=AsyncMock()
                )
        self.assertEqual(set(sessions._sessions), initial_sessions)

    async def test_captcha_and_email_use_browser_callbacks_with_same_device(self):
        captcha = SessionMMT.model_construct()
        ticket = ActionTicket.model_construct()
        client, solve, email, _, _ = await self.authenticate(
            [captcha, ticket, app_result()], [captcha, None]
        )
        self.assertEqual(solve.await_count, 2)
        email.assert_awaited_once()
        client._verify_email.assert_awaited_once_with("123456", ticket)
        self.assertTrue(
            len({call.kwargs["device_id"] for call in client._app_login.await_args_list}) == 1
        )
        self.assertIs(client._app_login.await_args.kwargs["ticket"], ticket)

    async def test_email_resend_cooldown_allows_received_code_without_new_captcha(self):
        ticket = ActionTicket.model_construct()
        cooldown = genshin.errors.VerificationCodeRateLimited({"retcode": -3206})
        with self.assertLogs("utils.hoyolab.refresh_login", level="INFO") as logs:
            client, solve, email, _, cookies = await self.authenticate(
                [ticket, app_result()], [cooldown]
            )
        email.assert_awaited_once()
        solve.assert_not_awaited()
        client._verify_email.assert_awaited_once_with("123456", ticket)
        self.assertEqual(client._send_verification_email.await_count, 1)
        self.assertEqual(cookies["stoken"], "refresh")
        self.assertFalse(any("WARNING" in line for line in logs.output))

    async def test_email_captcha_resend_cooldown_keeps_ticket_and_accepts_received_code(self):
        login_captcha = SessionMMT.model_construct()
        email_captcha = SessionMMT.model_construct()
        ticket = ActionTicket.model_construct()
        cooldown = genshin.errors.VerificationCodeRateLimited({"retcode": -3206})
        client, solve, email, _, _ = await self.authenticate(
            [login_captcha, ticket, app_result()], [email_captcha, cooldown]
        )
        self.assertEqual(solve.await_count, 2)
        self.assertEqual(client._send_verification_email.await_count, 2)
        email.assert_awaited_once()
        client._verify_email.assert_awaited_once_with("123456", ticket)
        self.assertIs(client._app_login.await_args.kwargs["ticket"], ticket)

    async def test_other_email_rate_limits_still_fail(self):
        ticket = ActionTicket.model_construct()
        error = genshin.errors.VerificationCodeRateLimited({"retcode": -999})
        with self.assertRaises(genshin.errors.VerificationCodeRateLimited):
            await self.authenticate([ticket], [error])

    async def test_unresolved_challenge_cannot_silently_save_nonrefreshable_login(self):
        with self.assertRaises(HoYoLABVerificationError):
            await self.authenticate([SessionMMT.model_construct() for _ in range(2)])

    async def test_rejected_captcha_does_not_prompt_for_another_puzzle(self):
        first = SessionMMT.model_construct()
        second = SessionMMTv4.model_construct()
        with self.assertRaisesRegex(HoYoLABVerificationError, "stopped this login"):
            await self.authenticate([first, second])

    async def test_app_v4_page_uses_app_server_and_session_id(self):
        mmt = SessionMMTv4(
            new_captcha=1,
            success=1,
            gt="captcha-id",
            risk_type="slide",
            session_id="session-id",
        )
        session = sessions.create_challenge_session(1, mmt, app_login=True)
        try:
            request = Request(
                {
                    "type": "http",
                    "method": "GET",
                    "path": "/challenge/test",
                    "headers": [],
                    "scheme": "http",
                    "server": ("localhost", 80),
                    "query_string": b"",
                }
            )
            response = await challenge(session.token, request)
            html = response.body.decode()
            self.assertIn('apiServers: ["gcaptcha4.captchami.com"]', html)
            self.assertIn("session_id: mmt.session_id", html)
            self.assertNotIn("mmt_key:", html)
            session.app_login = False
            web_html = (await challenge(session.token, request)).body.decode()
            self.assertIn('apiServers: ["api-na.geetest.com"]', web_html)
            self.assertIn("mmt_key: mmt.session_id", web_html)
        finally:
            sessions.delete_challenge_session(session.token)

    async def test_failure_diagnostics_log_stage_and_retcode_without_secrets(self):
        error = genshin.errors.GenshinException({"retcode": -999, "message": "secret-response"})
        with self.assertLogs("utils.hoyolab.refresh_login", level="WARNING") as logs:
            with self.assertRaises(genshin.errors.GenshinException):
                await self.authenticate([error])
        output = " ".join(logs.output)
        self.assertIn("stage=app-login", output)
        self.assertIn("retcode=-999", output)
        self.assertNotIn("secret-response", output)

    async def test_email_submission_is_validated_and_one_use(self):
        session = sessions.create_challenge_session(1, sessions.EmailChallenge(verify=AsyncMock()))
        try:
            with self.assertRaises(HTTPException) as invalid:
                await challenge_send_data(session.token, {"code": "bad"})
            self.assertEqual(invalid.exception.status_code, 400)
            self.assertFalse(session.completed)
            await challenge_send_data(session.token, {"code": "123456"})
            self.assertEqual(session.result, "123456")
            self.assertTrue(session.completion_event.is_set())
            with self.assertRaises(HTTPException) as reused:
                await challenge_send_data(session.token, {"code": "654321"})
            self.assertEqual(reused.exception.status_code, 410)
        finally:
            sessions.delete_challenge_session(session.token)

    async def test_incorrect_email_code_can_be_corrected_without_restarting_login(self):
        verify = AsyncMock(side_effect=[genshin.errors.WrongOTP(), None])
        session = sessions.create_challenge_session(1, sessions.EmailChallenge(verify=verify))
        try:
            with self.assertRaises(HTTPException) as wrong:
                await challenge_send_data(session.token, {"code": "111111"})
            self.assertIn("incorrect", wrong.exception.detail)
            self.assertFalse(session.completed)
            self.assertFalse(session.completion_event.is_set())
            self.assertFalse(session.submitting)
            await challenge_send_data(session.token, {"code": "222222"})
            self.assertTrue(session.completed)
            self.assertEqual(session.result, "222222")
        finally:
            sessions.delete_challenge_session(session.token)

    async def test_captcha_submission_waits_for_upstream_acceptance(self):
        pending = asyncio.get_running_loop().create_future()

        async def validate(answer):
            return await pending

        session = sessions.create_challenge_session(
            1, SessionMMT.model_construct(), app_login=True, validate=validate
        )
        data = {
            "session_id": "test",
            "geetest_challenge": "test",
            "geetest_validate": "test",
            "geetest_seccode": "test",
        }
        task = asyncio.create_task(challenge_send_data(session.token, data))
        try:
            await asyncio.sleep(0)
            self.assertFalse(task.done())
            self.assertFalse(session.completed)
            self.assertFalse(session.completion_event.is_set())
            accepted = app_result()
            pending.set_result(accepted)
            self.assertEqual(await task, {"success": True})
            self.assertIs(session.result, accepted)
            self.assertTrue(session.completed)
        finally:
            task.cancel()
            sessions.delete_challenge_session(session.token)

    async def test_rejected_captcha_reports_error_and_unblocks_login_without_success(self):
        error = HoYoLABVerificationError("HoYoLAB rejected the completed login CAPTCHA.")
        session = sessions.create_challenge_session(
            1,
            SessionMMT.model_construct(),
            app_login=True,
            validate=AsyncMock(side_effect=error),
        )
        try:
            with self.assertRaises(HTTPException) as rejected:
                await challenge_send_data(
                    session.token,
                    {
                        "session_id": "test",
                        "geetest_challenge": "test",
                        "geetest_validate": "test",
                        "geetest_seccode": "test",
                    },
                )
            self.assertEqual(rejected.exception.status_code, 400)
            self.assertIn("rejected", rejected.exception.detail)
            self.assertIs(session.result, error)
            self.assertTrue(session.completion_event.is_set())
        finally:
            sessions.delete_challenge_session(session.token)

    async def test_reconnect_device_identity_is_stable_and_account_specific(self):
        with patch.dict("os.environ", {"HOYOLAB_ENCRYPTION_KEY": "test-key"}):
            first = _device_id(Mock(), "User@example.com")
            self.assertEqual(first, _device_id(Mock(), " user@example.com "))
            self.assertNotEqual(first, _device_id(Mock(), "another@example.com"))
            self.assertEqual(len(first), 16)

    async def test_email_resume_does_not_replay_single_use_captcha_proof(self):
        first = SessionMMT.model_construct()
        ticket = ActionTicket.model_construct()
        client, _, _, _, _ = await self.authenticate([first, ticket, app_result()])
        self.assertNotIn("mmt_result", client._app_login.await_args.kwargs)

    async def test_browser_tabs_complete_the_same_login_only_once(self):
        account = {"game_uid": "785050004", "region": "os_euro", "nickname": "Mellow", "level": 60}
        attempt = {
            "user_id": 1,
            "created_at": time.time(),
            "status": "select",
            "accounts": [account],
            "credentials": HoYoLABCredentials(stoken="refresh"),
        }

        async def save(*args, **kwargs):
            await asyncio.sleep(0)

        with (
            patch.dict(web._account_link_attempts, {"test-attempt": attempt}),
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=1)),
            patch.object(web, "get_account", AsyncMock(return_value=None)),
            patch.object(web, "get_account_count", AsyncMock(return_value=0)),
            patch.object(web, "get_account_limit", return_value=5),
            patch.object(web, "save_account", AsyncMock(side_effect=save)) as persist,
        ):
            data = {"token": "test-attempt", "uid": account["game_uid"]}
            results = await asyncio.gather(
                web.complete_hoyolab_link(data, "session"),
                web.complete_hoyolab_link(data, "session"),
            )
            self.assertEqual(results[0], results[1])
            self.assertTrue(results[0]["success"])
            persist.assert_awaited_once()
            self.assertEqual(attempt["status"], "complete")
            self.assertIsNone(attempt["credentials"])

    async def test_email_challenge_is_exposed_in_original_login_without_popup_link(self):
        attempt = {"user_id": 1, "created_at": time.time(), "status": "authenticating"}
        captured = []

        async def authenticate(*args, **options):
            session = sessions.create_challenge_session(
                1, sessions.EmailChallenge(verify=AsyncMock())
            )
            try:
                await options["notify"](f"https://example.test/challenge/{session.token}")
                response = await web.hoyolab_link_status("inline-attempt", "session")
                captured.append(json.loads(response.body))
                await options["on_challenge_complete"]()
                return Mock(), HoYoLABCredentials(stoken="refresh")
            finally:
                sessions.delete_challenge_session(session.token)

        with (
            patch.dict(web._account_link_attempts, {"inline-attempt": attempt}),
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=1)),
            patch.object(web, "login_with_password", authenticate),
            patch.object(
                web, "get_genshin_accounts", AsyncMock(return_value=[{"game_uid": "785050004"}])
            ),
        ):
            await web._run_web_account_login("inline-attempt", "account", "password")
        self.assertEqual(attempt["status"], "select")
        self.assertEqual(captured[0]["status"], "email")
        self.assertTrue(captured[0]["submission_url"].endswith("/send-data"))
        self.assertNotIn("challenge_url", captured[0])

    async def test_expired_redemption_mints_persists_and_retries(self):
        credentials = HoYoLABCredentials(**app_result().model_dump(), cookie_token_v2="old")
        save = AsyncMock()
        client = HoYoLABClient(credentials, on_cookie_token_update=save)
        client.genshin_uid = "785050004"
        client.genshin_server = "os_euro"
        client.genshin_client = SimpleNamespace(
            redeem_code=AsyncMock(
                side_effect=[genshin.errors.InvalidCookies({"retcode": -1071}), None]
            ),
            set_cookies=Mock(),
        )
        with patch(
            "utils.hoyolab.client.genshin.fetch_cookie_with_stoken_v2",
            AsyncMock(return_value={"cookie_token_v2": "new"}),
        ):
            await client.redeem_genshin_code("CODE")
        save.assert_awaited_once_with("new")
        self.assertEqual(credentials.cookie_token_v2, "new")
        self.assertEqual(client.genshin_client.redeem_code.await_count, 2)


if __name__ == "__main__":
    unittest.main()
