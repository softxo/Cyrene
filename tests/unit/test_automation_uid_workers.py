"""Workers honour shared UID reservations and retain results across unlinking."""

import json
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from utils.hoyolab import daily_checkin_worker as daily
from utils.hoyolab import gift_code_worker as gifts
from utils.hoyolab.client import RedemptionAuthenticationError
from utils.web import app as web

ACCOUNT = {"account_id": 2, "discord_user_id": 20, "genshin_uid": "777000001"}


class AutomationWorkers(unittest.IsolatedAsyncioTestCase):
    async def run_gifts(self, history=None, reserved=True, error=None):
        client = AsyncMock()
        client.redeem_genshin_code.side_effect = error
        with (
            patch.object(gifts, "get_gift_code_redemptions", AsyncMock(return_value=history or {})),
            patch.object(
                gifts, "reserve_gift_code_redemption", AsyncMock(return_value=reserved)
            ) as reserve,
            patch.object(gifts, "get_account_client", AsyncMock(return_value=client)) as load,
            patch.object(gifts, "update_gift_code_redemption", AsyncMock()) as update,
            patch.object(gifts.asyncio, "sleep", AsyncMock()),
        ):
            await gifts.process_account(ACCOUNT, [{"code": "DONE"}, {"code": "NEW"}])
        return client, reserve, load, update

    async def test_completed_codes_never_contact_hoyolab(self):
        client, reserve, load, _ = await self.run_gifts(
            {
                "DONE": {"status": "submitted"},
                "NEW": {"status": "failed"},
            }
        )
        reserve.assert_not_awaited()
        load.assert_not_awaited()
        client.redeem_genshin_code.assert_not_awaited()

    async def test_reservation_lost_to_another_worker_skips_requests(self):
        client, reserve, load, update = await self.run_gifts(reserved=False)
        self.assertEqual(reserve.await_count, 2)
        load.assert_not_awaited()
        update.assert_not_awaited()
        client.redeem_genshin_code.assert_not_awaited()

    async def test_results_are_saved_to_uid_even_if_link_disappears(self):
        client, _, _, update = await self.run_gifts({"DONE": {"status": "submitted"}})
        client.redeem_genshin_code.assert_awaited_once_with("NEW")
        self.assertEqual(update.await_args.args[2], "submitted")
        self.assertEqual(update.await_args.kwargs["genshin_uid"], ACCOUNT["genshin_uid"])

    async def test_authentication_failure_is_retryable_and_stops_the_batch(self):
        client, _, _, update = await self.run_gifts(
            error=RedemptionAuthenticationError("Reconnect")
        )
        client.redeem_genshin_code.assert_awaited_once_with("DONE")
        self.assertEqual(update.await_args.args[2], "cooldown")
        self.assertEqual(update.await_args.kwargs["genshin_uid"], ACCOUNT["genshin_uid"])

    async def test_daily_claim_reservation_prevents_duplicate_requests(self):
        with (
            patch.object(
                daily,
                "get_daily_checkin_settings",
                AsyncMock(
                    return_value={
                        "auto_checkin_enabled": True,
                        "last_claimed_date": None,
                    }
                ),
            ),
            patch.object(daily, "reserve_daily_checkin", AsyncMock(return_value=False)) as reserve,
            patch.object(daily, "get_account_client", AsyncMock()) as load,
        ):
            await daily.process_daily_checkin_account(ACCOUNT)
        reserve.assert_awaited_once()
        load.assert_not_awaited()

    async def test_daily_claimed_date_is_checked_before_loading_credentials(self):
        today = datetime.now(daily.HOYOLAB_TIMEZONE).date().isoformat()
        with (
            patch.object(
                daily,
                "get_daily_checkin_settings",
                AsyncMock(
                    return_value={
                        "auto_checkin_enabled": True,
                        "last_claimed_date": today,
                    }
                ),
            ),
            patch.object(daily, "reserve_daily_checkin", AsyncMock()) as reserve,
            patch.object(daily, "get_account_client", AsyncMock()) as load,
        ):
            await daily.process_daily_checkin_account(ACCOUNT)
        reserve.assert_not_awaited()
        load.assert_not_awaited()

    async def test_daily_result_is_saved_by_uid(self):
        client = AsyncMock()
        client.genshin_client.claim_daily_reward.return_value = SimpleNamespace(
            name="Primogem", amount=20
        )
        with (
            patch.object(
                daily,
                "get_daily_checkin_settings",
                AsyncMock(
                    return_value={
                        "auto_checkin_enabled": True,
                        "last_claimed_date": None,
                    }
                ),
            ),
            patch.object(daily, "reserve_daily_checkin", AsyncMock(return_value=True)),
            patch.object(daily, "get_account_client", AsyncMock(return_value=client)),
            patch.object(daily, "update_daily_checkin_status", AsyncMock()) as update,
        ):
            await daily.process_daily_checkin_account(ACCOUNT)
        self.assertEqual(update.await_args.kwargs["status"], "claimed")
        self.assertEqual(update.await_args.kwargs["genshin_uid"], ACCOUNT["genshin_uid"])

    async def test_manual_request_cannot_duplicate_a_reserved_code(self):
        request = SimpleNamespace(json=AsyncMock(return_value={"account_id": 2, "code": "new"}))
        client = AsyncMock()
        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=20)),
            patch.object(web, "get_accounts", AsyncMock(return_value=[dict(ACCOUNT, id=2)])),
            patch.object(web, "get_account_client", AsyncMock(return_value=client)),
            patch.object(web, "reserve_gift_code_redemption", AsyncMock(return_value=False)),
            patch.object(web, "update_gift_code_redemption", AsyncMock()) as update,
        ):
            response = await web.redeem_genshin_code(request, "session")
        self.assertEqual(response.status_code, 409)
        self.assertFalse(json.loads(response.body)["success"])
        client.redeem_genshin_code.assert_not_awaited()
        update.assert_not_awaited()
