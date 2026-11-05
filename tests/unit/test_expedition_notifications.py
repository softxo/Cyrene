import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from utils.reminders.scheduler import ReminderScheduler


class ExpeditionNotificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_completion_sends_dm_and_does_not_repeat(self):
        user = SimpleNamespace(send=AsyncMock())
        scheduler = ReminderScheduler(SimpleNamespace(get_user=lambda _: user))
        client = MagicMock()
        client.genshin_uid = "777000001"
        client.genshin_server = "os_euro"
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.get_genshin_daily_note = AsyncMock(return_value={})
        reminder = {
            "id": 1,
            "genshin_uid": "777000001",
            "discord_user_id": 10,
            "reminder_type": "expedition",
            "reminder_mode": "automatic",
            "config": {},
        }
        with (
            patch(
                "utils.reminders.scheduler.get_reminder_recipients", AsyncMock(return_value=[10])
            ),
            patch("utils.reminders.scheduler.get_account_client", AsyncMock(return_value=client)),
            patch("utils.reminders.scheduler.get_accounts", AsyncMock(return_value=[])),
            patch(
                "utils.reminders.scheduler.get_expeditions",
                return_value=[
                    {"status": "Ongoing", "remained_time": 0},
                ],
            ),
            patch("utils.reminders.scheduler.update_reminder", AsyncMock()) as update,
        ):
            self.assertTrue(await scheduler.process_reminder(reminder))
            user.send.assert_awaited_once()
            self.assertEqual(user.send.await_args.kwargs["embed"].title, "Expeditions Complete")
            reminder["config"] = update.await_args.kwargs["config"]
            self.assertFalse(await scheduler.process_reminder(reminder))
            user.send.assert_awaited_once()
