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

    async def test_character_icons_precede_names_after_a_blank_line(self):
        emojis = [
            SimpleNamespace(name=name, id=index, animated=False)
            for index, name in enumerate(("Keqing", "Fischl", "Bennett", "Chongyun"), 1)
        ]
        scheduler = ReminderScheduler(SimpleNamespace(application_emojis=emojis))
        scheduler.send_reminder = AsyncMock(return_value=True)
        with patch(
            "utils.reminders.scheduler.get_accounts",
            AsyncMock(return_value=[{"genshin_uid": "777000001", "nickname": "Evernight"}]),
        ):
            await scheduler.send_expedition_reminder(
                {"genshin_uid": "777000001", "discord_user_id": 10},
                {str(index): emoji.name for index, emoji in enumerate(emojis)},
                "Automatic",
            )
        message = scheduler.send_reminder.await_args.kwargs["message"]
        self.assertIn("Expeditions:\n\n<:Keqing:1> **Keqing**", message)
        for emoji in emojis:
            self.assertIn(f"<:{emoji.name}:{emoji.id}> **{emoji.name}**", message)

    async def test_missing_character_emoji_is_registered_and_reused(self):
        bot = SimpleNamespace(
            application_emojis=[],
            emojis=[],
            create_application_emoji=AsyncMock(return_value="<:Keqing:123>"),
        )
        scheduler = ReminderScheduler(bot)
        self.assertEqual(await scheduler.expedition_character_emoji("Keqing"), "<:Keqing:123>")
        self.assertEqual(await scheduler.expedition_character_emoji("Keqing"), "<:Keqing:123>")
        bot.create_application_emoji.assert_awaited_once()
        self.assertEqual(bot.create_application_emoji.await_args.kwargs["name"], "Keqing")

    async def test_character_without_local_art_uses_hoyolab_icon(self):
        bot = SimpleNamespace(
            application_emojis=[],
            emojis=[],
            create_application_emoji=AsyncMock(return_value="<:Navia:456>"),
        )
        scheduler = ReminderScheduler(bot)
        response = MagicMock(status=200)
        response.read = AsyncMock(return_value=b"portrait")
        request = MagicMock()
        request.__aenter__ = AsyncMock(return_value=response)
        session = MagicMock()
        session.get.return_value = request
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=session)
        url = "https://upload-os-bbs.hoyolab.com/game_record/navia.png"
        with patch("utils.reminders.scheduler.aiohttp.ClientSession", return_value=context):
            self.assertEqual(
                await scheduler.expedition_character_emoji("Navia", url), "<:Navia:456>"
            )
        session.get.assert_called_once_with(url, allow_redirects=False)
        bot.create_application_emoji.assert_awaited_once_with(name="Navia", image=b"portrait")

    async def test_untrusted_icon_host_is_not_downloaded(self):
        bot = SimpleNamespace(
            application_emojis=[], emojis=[], create_application_emoji=AsyncMock()
        )
        scheduler = ReminderScheduler(bot)
        with patch("utils.reminders.scheduler.aiohttp.ClientSession") as session:
            self.assertEqual(
                await scheduler.expedition_character_emoji(
                    "Navia", "https://example.com/navia.png"
                ),
                "",
            )
        session.assert_not_called()
        bot.create_application_emoji.assert_not_awaited()
