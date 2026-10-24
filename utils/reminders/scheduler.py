import asyncio
import logging
import discord
from pathlib import Path
from datetime import datetime, timezone, timedelta
from utils.hoyolab.account_client import get_account_client
from utils.hoyolab.database import (
    get_due_reminders,
    update_reminder,
    get_accounts
)
from utils.hoyolab.daily_note import get_resin
from utils.constants.emojis import HOYOLAB_EMOJIS


logger = logging.getLogger(__name__)


CHECK_INTERVAL = 10
RESIN_REGEN_SECONDS = 480
RESIN_TRIGGERED_CHECK_SECONDS = 300

RESIN_IMAGE = Path(
        "assets/hoyolab/daily/Original_Resin.webp"
    )


class ReminderScheduler:
    def __init__(self, bot: discord.Client):
        self.bot = bot
        self.task: asyncio.Task | None = None
        self.running = False

    def is_running(self) -> bool:
        return (
            self.running
            and self.task is not None
            and not self.task.done()
        )

    def start(self):
        if self.task is not None and not self.task.done():
            return

        self.running = True

        self.task = asyncio.create_task(
            self._run(),
            name="reminder_scheduler"
        )

        logger.info("Reminder scheduler started.")

    async def stop(self):
        self.running = False

        if self.task is not None:
            self.task.cancel()

            try:
                await self.task
            except asyncio.CancelledError:
                pass

            self.task = None

        logger.info("Reminder scheduler stopped.")

    async def _run(self):
        while self.running:
            try:
                await self.process_due_reminders()

            except asyncio.CancelledError:
                raise

            except Exception as error:
                logger.exception(
                    "[ReminderScheduler] ERROR: %r",
                    error
                )

            await asyncio.sleep(CHECK_INTERVAL)

    async def process_due_reminders(self):
        reminders = await get_due_reminders()

        if not reminders:
            return

        for reminder in reminders:
            try:
                await self.process_reminder(
                    reminder
                )

            except Exception as error:
                logger.exception(
                    "[ReminderScheduler] REMINDER ERROR: %s: %r",
                    reminder["id"],
                    error
                )

    async def process_reminder(
            self,
            reminder: dict
    ) -> bool:

        reminder_type = reminder["reminder_type"]
        reminder_mode = reminder.get("reminder_mode")

        if (
                reminder_mode == "manual"
                and reminder_type == "custom"
        ):
            return await self.handle_manual(reminder)

        handler = {
            "resin": self.handle_resin,
            "expedition": self.handle_expedition,
            "teapot": self.handle_teapot,
            "transformer": self.handle_transformer,
            "custom": self.handle_custom,
        }.get(reminder_type)

        if handler is None:
            logger.warning(
                "Unknown reminder type '%s' for reminder %s.",
                reminder_type,
                reminder["id"]
            )
            return False

        return await handler(reminder)


    async def handle_manual(
        self,
        reminder: dict
    ):
        config = reminder.get("config") or {}

        message = config.get(
            "message",
            "Your reminder is due."
        )

        sent = await self.send_reminder(
            reminder,
            title="Reminder",
            message=message
        )

        if not sent:
            return False

        await update_reminder(
            reminder["discord_user_id"],
            reminder["id"],
            enabled=False,
            last_triggered_at=datetime.now(timezone.utc),
            next_trigger_at=None
        )

        return True

    async def handle_resin(
            self,
            reminder: dict
    ):
        reminder_id = reminder["id"]
        user_id = reminder["discord_user_id"]
        genshin_uid = reminder.get("genshin_uid")
        reminder_mode = reminder.get("reminder_mode")

        config = reminder.get("config") or {}

        amount = config.get("amount")

        if amount is None:
            await self.retry_reminder(
                reminder,
                seconds=60
            )

            return False

        try:
            amount = int(amount)

        except (TypeError, ValueError):
            await self.retry_reminder(
                reminder,
                seconds=60
            )

            return False

        if not genshin_uid:
            await self.retry_reminder(
                reminder,
                seconds=60
            )

            return False

        try:
            client = await get_account_client(
                user_id,
                genshin_uid
            )

        except Exception:
            logger.exception(
                "Failed to get account client for Resin reminder %s.",
                reminder_id
            )

            await self.retry_reminder(
                reminder,
                seconds=60
            )

            return False

        if client is None:
            await self.retry_reminder(
                reminder,
                seconds=60
            )

            return False

        try:
            async with client:
                response = await client.get_genshin_daily_note(
                    client.genshin_uid,
                    client.genshin_server
                )

        except Exception:
            logger.exception(
                "Failed to fetch Resin for reminder %s.",
                reminder_id
            )

            await self.retry_reminder(
                reminder,
                seconds=60
            )

            return False

        try:
            current_resin, max_resin, recovery = get_resin(
                response
            )

        except Exception:
            logger.exception(
                "Failed to parse Resin response for reminder %s.",
                reminder_id
            )

            await self.retry_reminder(
                reminder,
                seconds=60
            )

            return False

        triggered = bool(
            config.get("triggered", False)
        )

        if current_resin >= amount:
            if triggered:
                await self.retry_reminder(
                    reminder,
                    seconds=60
                )

                return False

            accounts = await get_accounts(
                user_id
            )

            account = next(
                (
                    account
                    for account in accounts
                    if account["genshin_uid"] == genshin_uid
                ),
                None
            )

            account_name = (
                account.get("nickname", "Unknown")
                if account is not None
                else "Unknown"
            )

            if reminder_mode == "manual":
                title = "Resin Replenished"
                footer = f"UID: {genshin_uid} — Manual Reminder"

            else:
                title = "Automatic Resin Reminder"
                footer = f"UID: {genshin_uid} — Automatic Reminder"

            sent = await self.send_reminder(
                reminder,
                title=title,
                message=(
                    f"Hey <@{user_id}>!\n\n"
                    f"Your account **{account_name}** has reached {HOYOLAB_EMOJIS['original_resin']}**{current_resin}** Resin.\n\u200b"
                ),
                footer=footer,
                thumbnail=RESIN_IMAGE
            )


            if not sent:
                await self.retry_reminder(
                    reminder,
                    seconds=60
                )

                return False

            now = datetime.now(timezone.utc)

            if reminder_mode == "manual":
                await update_reminder(
                    user_id,
                    reminder_id,
                    enabled=False,
                    last_triggered_at=now,
                    next_trigger_at=None
                )

                return True

            config["triggered"] = True

            await update_reminder(
                user_id,
                reminder_id,
                enabled=True,
                config=config,
                last_triggered_at=now,
                next_trigger_at=now + timedelta(
                    seconds=RESIN_TRIGGERED_CHECK_SECONDS
                )
            )

            return False

        if triggered:
            config["triggered"] = False

            await update_reminder(
                user_id,
                reminder_id,
                enabled=True,
                config=config
            )

        await self.schedule_resin_reminder(
            reminder,
            current_resin,
            amount,
            recovery
        )

        return False

    async def schedule_resin_reminder(
            self,
            reminder: dict,
            current_resin: int,
            target_resin: int,
            recovery: int
    ):
        resin_needed = target_resin - current_resin

        if resin_needed <= 0:
            await self.retry_reminder(
                reminder,
                seconds=60
            )

            return

        seconds_until_target = (
                recovery
                + ((resin_needed - 1) * RESIN_REGEN_SECONDS)
        )

        next_trigger_at = (
                datetime.now(timezone.utc)
                + timedelta(seconds=seconds_until_target)
        )

        logger.info(
            "Resin reminder %s scheduled for %s "
            "(current=%s target=%s).",
            reminder["id"],
            next_trigger_at,
            current_resin,
            target_resin
        )

        await update_reminder(
            reminder["discord_user_id"],
            reminder["id"],
            enabled=True,
            next_trigger_at=next_trigger_at
        )

    async def retry_reminder(
        self,
        reminder: dict,
        seconds: int
    ):
        next_trigger_at = (
            datetime.now(timezone.utc)
            + timedelta(seconds=seconds)
        )

        await update_reminder(
            reminder["discord_user_id"],
            reminder["id"],
            next_trigger_at=next_trigger_at
        )

    async def handle_expedition(
            self,
            reminder: dict
    ):
        logger.debug(
            "Expedition reminder %s is not implemented yet.",
            reminder["id"]
        )

        await self.retry_reminder(
            reminder,
            seconds=60
        )

        return False

    async def handle_teapot(
            self,
            reminder: dict
    ):
        logger.debug(
            "Teapot reminder %s is not implemented yet.",
            reminder["id"]
        )

        await self.retry_reminder(
            reminder,
            seconds=60
        )

        return False

    async def handle_transformer(
            self,
            reminder: dict
    ):
        logger.debug(
            "Transformer reminder %s is not implemented yet.",
            reminder["id"]
        )

        await self.retry_reminder(
            reminder,
            seconds=60
        )

        return False

    async def handle_custom(
            self,
            reminder: dict
    ) -> bool:
        config = reminder.get("config") or {}

        message = config.get("message")

        if not message:
            logger.warning(
                "Custom reminder %s has no message.",
                reminder["id"]
            )

            await update_reminder(
                reminder["discord_user_id"],
                reminder["id"],
                enabled=False,
                next_trigger_at=None
            )

            return True

        sent = await self.send_reminder(
            reminder,
            title="Reminder",
            message=message
        )

        if not sent:
            return False

        await update_reminder(
            reminder["discord_user_id"],
            reminder["id"],
            enabled=False,
            last_triggered_at=datetime.now(timezone.utc),
            next_trigger_at=None
        )

        return True


    async def send_reminder(
            self,
            reminder: dict,
            *,
            title: str,
            message: str,
            footer: str | None = None,
            thumbnail: Path | None = None
    ) -> bool:
        user_id = reminder["discord_user_id"]

        user = self.bot.get_user(user_id)

        if user is None:
            try:
                user = await self.bot.fetch_user(user_id)

            except discord.NotFound:
                return False

            except discord.HTTPException:
                logger.exception(
                    "Failed to fetch Discord user %s.",
                    user_id
                )
                return False

        embed = discord.Embed(
            title=title,
            description=message,
            colour=discord.Colour.blurple()
        )

        if footer is not None:
            embed.set_footer(
                text=footer
            )

        file = None

        if thumbnail is not None:
            file = discord.File(
                thumbnail,
                filename=thumbnail.name
            )

            embed.set_thumbnail(
                url=f"attachment://{thumbnail.name}"
            )

        delivery_type = reminder.get(
            "delivery_type",
            "dm"
        )

        if delivery_type != "dm":
            logger.warning(
                "Unsupported delivery type %r for reminder %s.",
                delivery_type,
                reminder["id"]
            )
            return False

        try:
            await user.send(
                embed=embed,
                file=file
            )

        except discord.Forbidden:
            logger.warning(
                "Discord user %s has DMs disabled or blocked the bot.",
                user_id
            )
            return False

        except discord.HTTPException:
            logger.exception(
                "Discord HTTP error while sending DM to %s.",
                user_id
            )
            return False

        logger.info(
            "Reminder %s sent to Discord user %s.",
            reminder["id"],
            user_id
        )

        return True