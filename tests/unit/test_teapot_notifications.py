import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from utils.hoyolab.daily_note import get_home_coin
from utils.reminders.scheduler import ReminderScheduler


class TeapotNotificationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.user = SimpleNamespace(send=AsyncMock())
        self.scheduler = ReminderScheduler(SimpleNamespace(get_user=lambda _: self.user))
        client = MagicMock()
        client.genshin_uid = "777000001"
        client.genshin_server = "os_euro"
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        self.fetch = client.get_genshin_daily_note = AsyncMock()
        self.reminder = {
            "id": 1,
            "genshin_uid": "777000001",
            "discord_user_id": 10,
            "reminder_type": "teapot",
            "reminder_mode": "automatic",
            "config": {},
        }
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, value in {
            "get_reminder_recipients": AsyncMock(return_value=[10]),
            "get_account_client": AsyncMock(return_value=client),
            "get_accounts": AsyncMock(return_value=[]),
        }.items():
            self.stack.enter_context(patch("utils.reminders.scheduler." + name, value))
        self.update = self.stack.enter_context(
            patch("utils.reminders.scheduler.update_reminder", AsyncMock())
        )

    async def check(self, current=2400, recovery=0):
        self.fetch.return_value = {
            "retcode": 0,
            "data": {
                "current_home_coin": current,
                "max_home_coin": 2400,
                "home_coin_recovery_time": str(recovery),
            },
        }
        result = await self.scheduler.process_reminder(self.reminder)
        if "config" in self.update.await_args.kwargs:
            self.reminder["config"] = self.update.await_args.kwargs["config"]
        return result

    async def test_automatic_notifies_once_and_rearms_after_collection(self):
        self.assertTrue(await self.check())
        self.assertEqual(self.user.send.await_args.kwargs["embed"].title, "Realm Currency Full")
        embed = self.user.send.await_args.kwargs["embed"]
        self.assertIn("<:Realm_Currency:1567870868434980895>**2400/2400**", embed.description)
        self.assertNotIn("Collect it", embed.description)
        self.assertEqual(embed.footer.text, "UID: 777000001 \u2014 Automatic Reminder")
        self.assertEqual(embed.thumbnail.url, "attachment://Realm_Currency.png")
        self.assertFalse(await self.check())
        self.user.send.assert_awaited_once()
        self.assertFalse(await self.check(100, 3600))
        self.assertFalse(self.reminder["config"]["triggered"])
        self.assertTrue(await self.check())
        self.assertEqual(self.user.send.await_count, 2)

    async def test_chosen_amount_triggers_before_full_and_rearms(self):
        self.reminder["config"] = {"amount": 1400}
        self.assertFalse(await self.check(1399, 100000))
        self.assertTrue(await self.check(1400, 100000))
        self.assertEqual(self.user.send.await_args.kwargs["embed"].title, "Realm Currency Reminder")
        self.assertFalse(await self.check(1401, 100000))
        self.assertFalse(await self.check(100, 100000))
        self.assertTrue(await self.check(1400, 100000))
        self.assertEqual(self.user.send.await_count, 2)

    def test_invalid_amounts_are_rejected(self):
        from fastapi import HTTPException

        from utils.web.app import _validate_realm_currency_amount

        for value in (0, -1, 2401, 1.5, True, "1400", None):
            with self.assertRaises(HTTPException):
                _validate_realm_currency_amount(value)
        self.assertEqual(_validate_realm_currency_amount(1400), 1400)

    async def test_manual_disables_after_delivery(self):
        self.reminder["reminder_mode"] = "manual"
        self.assertTrue(await self.check())
        self.assertFalse(self.update.await_args.kwargs["enabled"])
        self.assertIsNone(self.update.await_args.kwargs["next_trigger_at"])

    async def test_failed_delivery_keeps_cycle_untriggered(self):
        self.scheduler.send_reminder = AsyncMock(return_value=False)
        self.assertFalse(await self.check())
        self.assertNotIn("triggered", self.reminder["config"])
        self.assertNotIn("enabled", self.update.await_args.kwargs)

    async def test_missing_data_retries_without_sending(self):
        self.fetch.return_value = {"retcode": 0, "data": {"current_resin": 10}}
        self.assertFalse(await self.scheduler.process_reminder(self.reminder))
        self.user.send.assert_not_awaited()

    def test_currency_parsing_and_unavailable_recovery(self):
        self.assertEqual(
            get_home_coin(
                {
                    "retcode": 0,
                    "data": {
                        "current_home_coin": "100",
                        "max_home_coin": "2400",
                        "home_coin_recovery_time": "60",
                    },
                }
            ),
            (100, 2400, 60),
        )
        with self.assertRaises(ValueError):
            get_home_coin(
                {
                    "retcode": 0,
                    "data": {
                        "current_home_coin": 100,
                        "max_home_coin": 2400,
                        "home_coin_recovery_time": "0",
                    },
                }
            )


class TeapotPlannerApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_account_capacity_rejects_excessive_amount(self):
        from fastapi import HTTPException

        from utils.web import app as web

        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=10)),
            patch.object(web, "get_accounts", AsyncMock(return_value=[{"genshin_uid": "123"}])),
            patch.object(web, "_realm_currency_capacity", AsyncMock(return_value=2000)),
            patch.object(web, "create_reminder", AsyncMock()) as create,
        ):
            with self.assertRaises(HTTPException) as error:
                await web.create_planner_reminder(
                    {"type": "teapot", "genshin_uid": "123", "config": {"amount": 2300}}, "session"
                )
            self.assertEqual(error.exception.status_code, 400)
            create.assert_not_awaited()

    async def test_currency_data_and_reminder_creation(self):
        from utils.web import app as web

        account = {"genshin_uid": "777000001", "genshin_server": "os_euro"}
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.get_genshin_daily_note = AsyncMock(
            return_value={
                "retcode": 0,
                "data": {
                    "current_resin": 200,
                    "max_resin": 200,
                    "resin_recovery_time": "0",
                    "current_home_coin": 1200,
                    "max_home_coin": 2400,
                    "home_coin_recovery_time": "3600",
                },
            }
        )
        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=10)),
            patch.object(web, "get_accounts", AsyncMock(return_value=[account])),
            patch.object(web, "get_reminders", AsyncMock(return_value=[])),
            patch.object(web, "get_account_client", AsyncMock(return_value=client)),
            patch.object(web.time, "time", return_value=1000),
            patch.object(web, "create_reminder", AsyncMock(return_value=1)) as create,
        ):
            result = await web.planner_data("session")
            self.assertEqual(
                result["accounts"][0]["teapot"],
                {
                    "current": 1200,
                    "maximum": 2400,
                    "full_at": 4600,
                },
            )
            result = await web.create_planner_reminder(
                {
                    "type": "teapot",
                    "mode": "automatic",
                    "genshin_uid": "777000001",
                },
                "session",
            )
            self.assertTrue(result["success"])
            self.assertEqual(create.await_args.kwargs["reminder_type"], "teapot")
            self.assertIsNotNone(create.await_args.kwargs["next_trigger_at"])
