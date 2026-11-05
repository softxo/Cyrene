import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from utils.hoyolab.daily_note import get_transformer_status
from utils.reminders.scheduler import ReminderScheduler


class TransformerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.user = SimpleNamespace(send=AsyncMock())
        self.scheduler = ReminderScheduler(SimpleNamespace(get_user=lambda _: self.user))
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        self.fetch = client.get_genshin_daily_note = AsyncMock()
        self.reminder = {
            "id": 1,
            "discord_user_id": 10,
            "genshin_uid": "123",
            "reminder_type": "transformer",
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

    async def check(self, days=0, obtained=True):
        self.fetch.return_value = {
            "retcode": 0,
            "data": {
                "transformer": {
                    "obtained": obtained,
                    "recovery_time": {"Day": days, "Hour": 0, "Minute": 0, "Second": 0},
                }
            },
        }
        result = await self.scheduler.process_reminder(self.reminder)
        if "config" in self.update.await_args.kwargs:
            self.reminder["config"] = self.update.await_args.kwargs["config"]
        return result

    async def test_ready_once_then_rearms_after_use(self):
        self.assertTrue(await self.check())
        self.assertFalse(await self.check())
        self.user.send.assert_awaited_once()
        self.assertFalse(await self.check(days=7))
        self.assertTrue(await self.check())
        self.assertEqual(self.user.send.await_count, 2)
        embed = self.user.send.await_args.kwargs["embed"]
        self.assertEqual(embed.title, "Parametric Transformer Ready")
        self.assertEqual(embed.thumbnail.url, "attachment://Parametric_Transformer.webp")

    async def test_not_obtained_does_not_notify(self):
        self.assertFalse(await self.check(obtained=False))
        self.user.send.assert_not_awaited()

    async def test_manual_disables_after_delivery(self):
        self.reminder["reminder_mode"] = "manual"
        self.assertTrue(await self.check())
        self.assertFalse(self.update.await_args.kwargs["enabled"])
        self.assertIsNone(self.update.await_args.kwargs["next_trigger_at"])

    async def test_failed_delivery_retries(self):
        self.scheduler.send_reminder = AsyncMock(return_value=False)
        self.assertFalse(await self.check())
        self.assertNotIn("triggered", self.reminder["config"])

    def test_recovery_includes_days_and_rejects_missing_data(self):
        status = get_transformer_status(
            {
                "retcode": 0,
                "data": {
                    "transformer": {
                        "obtained": True,
                        "recovery_time": {"Day": 2, "Hour": 3, "Minute": 4, "Second": 5},
                    }
                },
            }
        )
        self.assertEqual(status["remaining_seconds"], 183845)
        with self.assertRaises(ValueError):
            get_transformer_status({"retcode": 0, "data": {"current_resin": 10}})
