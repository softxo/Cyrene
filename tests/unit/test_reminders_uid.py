import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import discord

from utils.reminders.scheduler import ReminderScheduler


class UidReminderSchedulerTests(unittest.IsolatedAsyncioTestCase):
    async def test_every_currently_linked_user_gets_a_personalized_dm_and_fresh_attachment(self):
        users = {i: SimpleNamespace(send=AsyncMock()) for i in (10, 20)}
        bot = SimpleNamespace(get_user=MagicMock(side_effect=users.get))
        scheduler = ReminderScheduler(bot)
        with tempfile.TemporaryDirectory() as folder:
            icon = Path(folder) / "resin.png"
            icon.write_bytes(b"test attachment")
            with patch(
                "utils.reminders.scheduler.get_reminder_recipients",
                AsyncMock(return_value=[10, 20, 20]),
            ):
                self.assertTrue(
                    await scheduler.send_reminder(
                        {"id": 1, "genshin_uid": "777000001", "discord_user_id": 99},
                        title="Resin",
                        message="Hey {recipient_mention}!",
                        thumbnail=icon,
                    )
                )
            attachments = []
            for identifier, user in users.items():
                user.send.assert_awaited_once()
                kwargs = user.send.await_args.kwargs
                self.assertEqual(kwargs["embed"].description, f"Hey <@{identifier}>!")
                attachments.append(kwargs["file"])
            self.assertIsNot(attachments[0], attachments[1])
            for file in attachments:
                file.close()

    async def test_blocked_dm_does_not_prevent_other_linked_users_receiving_notification(self):
        blocked = SimpleNamespace(
            send=AsyncMock(
                side_effect=discord.Forbidden(
                    SimpleNamespace(status=403, reason="Forbidden"), "blocked"
                )
            )
        )
        allowed = SimpleNamespace(send=AsyncMock())
        scheduler = ReminderScheduler(
            SimpleNamespace(get_user=MagicMock(side_effect={10: blocked, 20: allowed}.get))
        )
        with patch(
            "utils.reminders.scheduler.get_reminder_recipients", AsyncMock(return_value=[10, 20])
        ):
            self.assertTrue(
                await scheduler.send_reminder(
                    {"id": 1, "genshin_uid": "777000001", "discord_user_id": 10},
                    title="Resin",
                    message="Ready",
                )
            )
        blocked.send.assert_awaited_once()
        allowed.send.assert_awaited_once()

    async def test_unlinked_uid_is_not_processed_or_sent(self):
        scheduler = ReminderScheduler(SimpleNamespace())
        scheduler.handle_resin = AsyncMock()
        with patch("utils.reminders.scheduler.get_reminder_recipients", AsyncMock(return_value=[])):
            self.assertFalse(
                await scheduler.process_reminder(
                    {
                        "id": 1,
                        "genshin_uid": "777000001",
                        "discord_user_id": 10,
                        "reminder_type": "resin",
                    }
                )
            )
        scheduler.handle_resin.assert_not_awaited()

    async def test_resin_uses_another_linked_accounts_credentials_if_original_credentials_are_unavailable(
        self,
    ):
        client = MagicMock()
        client.genshin_uid = "777000001"
        client.genshin_server = "os_euro"
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=None)
        client.get_genshin_daily_note = AsyncMock(return_value={"data": {}})
        scheduler = ReminderScheduler(SimpleNamespace())
        scheduler.send_reminder = AsyncMock(return_value=True)
        reminder = {
            "id": 1,
            "genshin_uid": "777000001",
            "discord_user_id": 99,
            "reminder_type": "resin",
            "reminder_mode": "manual",
            "config": {"amount": 180},
        }
        with (
            patch(
                "utils.reminders.scheduler.get_reminder_recipients",
                AsyncMock(return_value=[10, 20]),
            ),
            patch(
                "utils.reminders.scheduler.get_account_client",
                AsyncMock(side_effect=[client, client]),
            ) as clients,
            patch(
                "utils.reminders.scheduler.get_accounts",
                AsyncMock(return_value=[{"genshin_uid": "777000001", "nickname": "Shared"}]),
            ),
            patch(
                "utils.reminders.scheduler.get_resin",
                side_effect=[ValueError("Invalid upstream response"), (180, 200, 30)],
            ),
            patch("utils.reminders.scheduler.update_reminder", AsyncMock()) as update,
        ):
            self.assertTrue(await scheduler.process_reminder(reminder))
        self.assertEqual(clients.await_count, 2)
        scheduler.send_reminder.assert_awaited_once()
        self.assertEqual(update.await_args.args, (20, 1))
        self.assertFalse(update.await_args.kwargs["enabled"])


class PlannerReminderUidApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_planner_lists_shared_reminder_with_the_viewers_account_name(self):
        from utils.web import app as web

        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=20)),
            patch.object(
                web,
                "get_accounts",
                AsyncMock(
                    return_value=[{"genshin_uid": "777000001", "nickname": "Shared account"}]
                ),
            ),
            patch.object(
                web,
                "get_reminders",
                AsyncMock(
                    return_value=[
                        {
                            "id": 1,
                            "discord_user_id": 10,
                            "enabled": True,
                            "genshin_uid": "777000001",
                            "reminder_type": "resin",
                            "reminder_mode": "automatic",
                            "config": {"amount": 180},
                        }
                    ]
                ),
            ),
            patch.object(web, "get_account_client", AsyncMock(return_value=None)),
        ):
            result = await web.planner_data("session")
        self.assertEqual(result["reminders"][0]["account_nickname"], "Shared account")
        self.assertEqual(result["reminders"][0]["config"]["amount"], 180)

    async def test_shared_reminder_can_be_updated_by_linked_viewer(self):
        from utils.web import app as web

        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=20)),
            patch.object(
                web,
                "get_reminder",
                AsyncMock(
                    return_value={
                        "id": 1,
                        "discord_user_id": 10,
                        "genshin_uid": "777000001",
                        "reminder_type": "resin",
                    }
                ),
            ),
            patch.object(web, "update_reminder", AsyncMock(return_value=True)) as update,
        ):
            result = await web.update_planner_reminder(1, {"config": {"amount": 170}}, "session")
        self.assertTrue(result["success"])
        update.assert_awaited_once_with(
            discord_user_id=20, reminder_id=1, enabled=None, config={"amount": 170}
        )

    async def test_creation_for_unlinked_uid_is_rejected(self):
        from fastapi import HTTPException

        from utils.web import app as web

        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=20)),
            patch.object(
                web, "get_accounts", AsyncMock(return_value=[{"genshin_uid": "777000001"}])
            ),
            patch.object(web, "create_reminder", AsyncMock()) as create,
        ):
            with self.assertRaises(HTTPException) as error:
                await web.create_planner_reminder(
                    {
                        "type": "resin",
                        "mode": "automatic",
                        "genshin_uid": "777000003",
                        "config": {"amount": 180},
                    },
                    "session",
                )
        self.assertEqual(error.exception.status_code, 400)
        create.assert_not_awaited()
