"""Security regressions exercise real handlers with isolated accounts and providers."""

import contextlib
import io
import json
import re
import unittest
from html.parser import HTMLParser
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from genshin.models.auth.geetest import SessionMMT, SessionMMTv4

from utils.web import app as web
from utils.web import planner_costs, sessions

SECRET = "SYNTHETIC_PRIVATE_TOKEN_/srv/private/config"
PAYLOAD = '</ScRiPt><script>globalThis.injected = true</script><img src=x onerror="alert(1)">'


class ScriptParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self.active = False

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.active = True
            self.scripts.append({"attrs": dict(attrs), "text": ""})

    def handle_endtag(self, tag):
        if tag == "script":
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.scripts[-1]["text"] += data


def metadata(v4=False, value="challenge"):
    common = {"new_captcha": True, "success": 1, "session_id": value}
    if v4:
        return SessionMMTv4(**common, gt=value, risk_type="slide")
    return SessionMMT(**common, gt=value, challenge=value)


class ChallengeSecurityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        # Avoid touching challenges belonging to another in-process test.
        self.store = patch.object(sessions, "_sessions", {})
        self.store.start()
        self.addCleanup(self.store.stop)

    async def render(self, challenge):
        with contextlib.redirect_stdout(io.StringIO()):
            return await web.challenge(challenge.token)

    async def test_metadata_cannot_terminate_script_and_round_trips_both_versions(self):
        for v4 in (False, True):
            with self.subTest(v4=v4):
                value = PAYLOAD + " ' \" \\ & < > \u2028\u2029"
                challenge = sessions.create_challenge_session(123, metadata(v4, value))
                response = await self.render(challenge)
                parser = ScriptParser()
                parser.feed(response.body.decode())
                self.assertEqual(len(parser.scripts), 2)
                inline = parser.scripts[-1]["text"]
                encoded = re.search(r"const mmt = (.*?);", inline).group(1)
                self.assertEqual(json.loads(encoded), challenge.mmt.model_dump(mode="json"))
                self.assertNotIn("</script", inline.lower())
                self.assertNotIn("\u2028", inline)
                self.assertNotIn("\u2029", inline)

    async def test_normal_versions_keep_sdk_and_submission_contract(self):
        for v4 in (False, True):
            with self.subTest(v4=v4):
                challenge = sessions.create_challenge_session(123, metadata(v4))
                response = await self.render(challenge)
                html = response.body.decode()
                self.assertIn("initGeetest4(" if v4 else "initGeetest(", html)
                self.assertIn(f"/challenge/{challenge.token}/send-data", html)
                self.assertIn("showSuccess();", html)
                self.assertEqual(response.status_code, 200)

    async def test_challenge_lookup_expiry_and_completion_are_preserved(self):
        self.assertEqual((await web.challenge("unknown<script>")).status_code, 410)
        challenge = sessions.create_challenge_session(123, metadata())
        challenge.created_at -= sessions.SESSION_TIMEOUT + 1
        self.assertEqual((await self.render(challenge)).status_code, 410)
        challenge = sessions.create_challenge_session(123, metadata())
        challenge.completed = True
        self.assertEqual((await self.render(challenge)).status_code, 410)

    async def test_valid_results_bind_to_the_original_challenge(self):
        for v4 in (False, True):
            with self.subTest(v4=v4):
                challenge = sessions.create_challenge_session(123, metadata(v4))
                other = sessions.create_challenge_session(456, metadata(v4))
                data = {"session_id": "challenge"}
                data.update(
                    {key: "value" for key in (
                        ("captcha_id", "lot_number", "pass_token", "gen_time", "captcha_output")
                        if v4 else ("geetest_challenge", "geetest_validate", "geetest_seccode")
                    )}
                )
                self.assertEqual(await web.challenge_send_data(challenge.token, data), {"success": True})
                self.assertTrue(challenge.completion_event.is_set())
                self.assertFalse(other.completed)
                self.assertEqual(challenge.user_id, 123)
                with self.assertRaises(HTTPException) as error:
                    await web.challenge_send_data(challenge.token, data)
                self.assertEqual(error.exception.status_code, 410)

    async def test_expired_and_unknown_results_are_rejected(self):
        challenge = sessions.create_challenge_session(123, metadata())
        challenge.created_at -= sessions.SESSION_TIMEOUT + 1
        for token in ("unknown", challenge.token):
            with self.assertRaises(HTTPException) as error:
                await web.challenge_send_data(token, {})
            self.assertEqual(error.exception.status_code, 410)

    async def test_invalid_result_does_not_complete_challenge(self):
        challenge = sessions.create_challenge_session(123, metadata())
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(HTTPException) as error:
            await web.challenge_send_data(challenge.token, {})
        self.assertEqual(error.exception.status_code, 400)
        self.assertFalse(challenge.completed)


class PublicErrorSecurityTests(unittest.IsolatedAsyncioTestCase):
    inventory_loader = staticmethod(web.get_cached_inventory)

    async def asyncSetUp(self):
        self.accounts = [{"id": 7, "genshin_uid": "123456789"}]
        for name, value in (
            ("get_web_session", SimpleNamespace(user_id=123)),
            ("get_accounts", self.accounts),
            ("get_cached_inventory", []),
        ):
            patcher = patch.object(web, name, AsyncMock(return_value=value))
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)

    async def test_inventory_missing_client_and_cache_are_account_scoped(self):
        with patch.dict(web._inventory_cache, {}, clear=True), \
             patch.object(web, "get_account_client", AsyncMock(return_value=None)) as client:
            with self.assertRaises(RuntimeError):
                await self.inventory_loader(123, self.accounts[0])
            client.assert_awaited_once_with(123, "123456789")
        provider = AsyncMock()
        provider.__aenter__.return_value = provider
        provider.get_genshin_inventory.return_value = [{"id": 42}]
        with patch.dict(web._inventory_cache, {}, clear=True), \
             patch.object(web, "get_account_client", AsyncMock(return_value=provider)) as client:
            await self.inventory_loader(123, self.accounts[0])
            await self.inventory_loader(123, self.accounts[0])
            await self.inventory_loader(456, self.accounts[0])
            self.assertEqual(client.await_count, 2)

    async def test_inventory_internal_runtime_error_is_not_public(self):
        self.get_cached_inventory.side_effect = RuntimeError(SECRET)
        response = await web.inventory_data(7, "session")
        self.assertEqual(response.status_code, 404)
        self.assertNotIn(SECRET, response.body.decode())
        self.assertTrue(json.loads(response.body)["error"])

    async def test_inventory_ownership_checks_precede_provider_calls(self):
        self.get_web_session.return_value = None
        self.assertEqual((await web.inventory_data(7, None)).status_code, 401)
        self.get_cached_inventory.assert_not_called()
        self.get_web_session.return_value = SimpleNamespace(user_id=123)
        self.assertEqual((await web.inventory_data(99, "session")).status_code, 404)
        self.get_cached_inventory.assert_not_called()

    async def test_inventory_upstream_exception_and_success(self):
        self.get_cached_inventory.side_effect = Exception(SECRET)
        with patch.object(web.logger, "exception"):
            response = await web.inventory_data(7, "session")
        self.assertEqual(response.status_code, 502)
        self.assertNotIn(SECRET, response.body.decode())
        self.get_cached_inventory.side_effect = None
        self.get_cached_inventory.return_value = [{"id": 42}]
        result = await web.inventory_data(7, "session")
        self.assertIn("inventory", result)

    async def costs(self, **overrides):
        values = dict(character_id=10000005, character_name="Traveler", current_level=1,
                      target_level=20, current_talents="1,1,1", target_talents="2,2,2",
                      target_weapon_level=20, cyrene_session="session")
        values.update(overrides)
        return await web.character_planner_costs(**values)

    async def test_planner_arbitrary_value_error_is_not_public(self):
        with patch.object(web, "calculate_planner_costs", AsyncMock(side_effect=ValueError(SECRET))):
            response = await self.costs()
        self.assertEqual(response.status_code, 400)
        self.assertNotIn(SECRET, response.body.decode())

    async def test_planner_validation_and_success_contract(self):
        response = await self.costs(current_level=0)
        self.assertEqual(response.status_code, 400)
        self.assertIn("between 1 and 90", json.loads(response.body)["error"])
        response = await self.costs(current_talents="1,2")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.body)["error"], "Exactly three talent levels are required.")
        with patch.object(web, "calculate_planner_costs", AsyncMock(return_value={"level": "ok"})) as calculate:
            self.assertEqual(await self.costs(), {"character_id": 10000005, "costs": {"level": "ok"}})
            self.assertEqual(calculate.call_args.kwargs["character_level_name"], "Aether")

    async def test_planner_unauthenticated_does_not_calculate(self):
        self.get_web_session.return_value = None
        with patch.object(web, "calculate_planner_costs", AsyncMock()) as calculate:
            self.assertEqual((await self.costs()).status_code, 401)
            calculate.assert_not_called()

    async def test_nested_catalogue_exception_is_not_public(self):
        with patch.object(planner_costs, "_level_cost", AsyncMock(side_effect=planner_costs.GenshinDBError(SECRET))), \
             patch.object(planner_costs, "_talent_cost", AsyncMock(return_value={})), \
             patch.object(planner_costs, "_weapon_cost", AsyncMock(return_value={})):
            result = await planner_costs.calculate_planner_costs(
                "Aether", 1, 20, [1, 1, 1], [2, 2, 2], None, None, None, 20,
            )
        self.assertNotIn(SECRET, json.dumps(result))
        self.assertEqual(result["level"]["status"], "unavailable")
