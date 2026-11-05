import asyncio
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

import discord

from utils.constants.emojis import HOYOLAB_EMOJIS
from utils.hoyolab.account_client import get_account_client
from utils.hoyolab.daily_note import (
    get_expeditions,
    get_home_coin,
    get_resin,
    get_transformer_status,
)
from utils.hoyolab.database import (
    get_accounts,
    get_due_reminders,
    get_reminder_recipients,
    update_reminder,
)
from utils.hoyolab.expedition_icons import EXPEDITION_ICONS

logger = logging.getLogger(__name__)


CHECK_INTERVAL = 10
RESIN_REGEN_SECONDS = 480
RESIN_TRIGGERED_CHECK_SECONDS = 300

RESIN_IMAGE = Path("assets/hoyolab/daily/Original_Resin.webp")
REALM_CURRENCY_IMAGE = Path("website/static/images/misc/Realm_Currency.png")


class ReminderScheduler:
    def __init__(self, bot: discord.Client):
        self.bot = bot
        self.task: asyncio.Task | None = None
        self.running = False

    def is_running(self) -> bool:
        return self.running and self.task is not None and not self.task.done()

    def start(self):
        if self.task is not None and not self.task.done():
            return

        self.running = True

        self.task = asyncio.create_task(self._run(), name="reminder_scheduler")

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
                logger.exception("[ReminderScheduler] ERROR: %r", error)

            await asyncio.sleep(CHECK_INTERVAL)

    async def process_due_reminders(self):
        reminders = await get_due_reminders()

        if not reminders:
            return

        for reminder in reminders:
            try:
                await self.process_reminder(reminder)

            except Exception as error:
                logger.exception(
                    "[ReminderScheduler] REMINDER ERROR: %s: %r", reminder["id"], error
                )

    async def process_reminder(self, reminder: dict) -> bool:

        if reminder.get("genshin_uid"):
            linked_users = await get_reminder_recipients(reminder["genshin_uid"])
            if not linked_users:
                return False
            # Use a currently linked identity for authenticated scheduler updates.
            reminder = {**reminder, "discord_user_id": linked_users[0]}

        reminder_type = reminder["reminder_type"]
        reminder_mode = reminder.get("reminder_mode")

        if reminder_mode == "manual" and reminder_type == "custom":
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
                "Unknown reminder type '%s' for reminder %s.", reminder_type, reminder["id"]
            )
            return False

        return await handler(reminder)

    async def handle_manual(self, reminder: dict):
        config = reminder.get("config") or {}

        message = config.get("message", "Your reminder is due.")

        sent = await self.send_reminder(reminder, title="Reminder", message=message)

        if not sent:
            return False

        await update_reminder(
            reminder["discord_user_id"],
            reminder["id"],
            enabled=False,
            last_triggered_at=datetime.now(timezone.utc),
            next_trigger_at=None,
        )

        return True

    async def handle_resin(self, reminder: dict):
        reminder_id = reminder["id"]
        user_id = reminder["discord_user_id"]
        genshin_uid = reminder.get("genshin_uid")
        reminder_mode = reminder.get("reminder_mode")

        config = reminder.get("config") or {}

        amount = config.get("amount")

        if amount is None:
            await self.retry_reminder(reminder, seconds=60)

            return False

        try:
            amount = int(amount)

        except TypeError, ValueError:
            await self.retry_reminder(reminder, seconds=60)

            return False

        if not genshin_uid:
            await self.retry_reminder(reminder, seconds=60)

            return False

        response = None
        for candidate in await get_reminder_recipients(genshin_uid):
            try:
                client = await get_account_client(candidate, genshin_uid)
                if client is None:
                    continue
                async with client:
                    response = await client.get_genshin_daily_note(
                        client.genshin_uid, client.genshin_server
                    )
                current_resin, max_resin, recovery = get_resin(response)
                user_id = candidate
                reminder = {**reminder, "discord_user_id": candidate}
                break
            except Exception:
                response = None
                logger.exception(
                    "Failed to fetch Resin for reminder %s using linked user %s.",
                    reminder_id,
                    candidate,
                )
        if response is None:
            await self.retry_reminder(reminder, seconds=60)
            return False

        triggered = bool(config.get("triggered", False))

        if current_resin >= amount:
            if triggered:
                await self.retry_reminder(reminder, seconds=60)

                return False

            accounts = await get_accounts(user_id)

            account = next(
                (account for account in accounts if account["genshin_uid"] == genshin_uid), None
            )

            account_name = account.get("nickname", "Unknown") if account is not None else "Unknown"

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
                    "Hey {recipient_mention}!\n\n"
                    f"Your account **{account_name}** has reached {HOYOLAB_EMOJIS['original_resin']}**{current_resin}** Resin.\n\u200b"
                ),
                footer=footer,
                thumbnail=RESIN_IMAGE,
            )

            if not sent:
                await self.retry_reminder(reminder, seconds=60)

                return False

            now = datetime.now(timezone.utc)

            if reminder_mode == "manual":
                await update_reminder(
                    user_id, reminder_id, enabled=False, last_triggered_at=now, next_trigger_at=None
                )

                return True

            config["triggered"] = True

            await update_reminder(
                user_id,
                reminder_id,
                enabled=True,
                config=config,
                last_triggered_at=now,
                next_trigger_at=now + timedelta(seconds=RESIN_TRIGGERED_CHECK_SECONDS),
            )

            return False

        if triggered:
            config["triggered"] = False

            await update_reminder(user_id, reminder_id, enabled=True, config=config)

        await self.schedule_resin_reminder(reminder, current_resin, amount, recovery)

        return False

    async def schedule_resin_reminder(
        self, reminder: dict, current_resin: int, target_resin: int, recovery: int
    ):
        resin_needed = target_resin - current_resin

        if resin_needed <= 0:
            await self.retry_reminder(reminder, seconds=60)

            return

        seconds_until_target = recovery + ((resin_needed - 1) * RESIN_REGEN_SECONDS)

        next_trigger_at = datetime.now(timezone.utc) + timedelta(seconds=seconds_until_target)

        logger.info(
            "Resin reminder %s scheduled for %s (current=%s target=%s).",
            reminder["id"],
            next_trigger_at,
            current_resin,
            target_resin,
        )

        await update_reminder(
            reminder["discord_user_id"],
            reminder["id"],
            enabled=True,
            next_trigger_at=next_trigger_at,
        )

    async def retry_reminder(self, reminder: dict, seconds: int):
        next_trigger_at = datetime.now(timezone.utc) + timedelta(seconds=seconds)

        await update_reminder(
            reminder["discord_user_id"], reminder["id"], next_trigger_at=next_trigger_at
        )

    async def handle_expedition(self, reminder: dict):
        reminder_id = reminder["id"]
        genshin_uid = reminder.get("genshin_uid")
        reminder_mode = reminder.get("reminder_mode", "automatic")
        config = dict(reminder.get("config") or {})

        if not genshin_uid:
            await self.retry_reminder(reminder, seconds=60)
            return False

        response = None
        expeditions = []
        for candidate in await get_reminder_recipients(genshin_uid):
            try:
                client = await get_account_client(candidate, genshin_uid)
                if client is None:
                    continue
                async with client:
                    response = await client.get_genshin_daily_note(
                        client.genshin_uid, client.genshin_server
                    )
                expeditions = get_expeditions(response)
                reminder = {**reminder, "discord_user_id": candidate}
                break
            except Exception:
                response = None
                logger.exception(
                    "Failed to fetch Expeditions for reminder %s using linked user %s.",
                    reminder_id,
                    candidate,
                )

        if response is None:
            await self.retry_reminder(reminder, seconds=60)
            return False

        valid_expeditions = []
        for slot, expedition in enumerate(expeditions if isinstance(expeditions, list) else []):
            if not isinstance(expedition, dict):
                continue
            try:
                remaining_seconds = max(0, int(expedition.get("remained_time", 0) or 0))
            except TypeError, ValueError:
                remaining_seconds = 0
            status = str(expedition.get("status") or "Unknown")
            if status == "Ongoing" and remaining_seconds == 0:
                status = "Finished"

            icon_url = str(expedition.get("avatar_side_icon") or "")
            icon_filename = urlsplit(icon_url).path.rstrip("/").rsplit("/", 1)[-1]
            icon_hash = icon_filename.removesuffix(".png")
            character_name = EXPEDITION_ICONS.get(icon_hash, "Unknown")
            valid_expeditions.append(
                {
                    "slot": str(slot),
                    "name": character_name.replace("_", " "),
                    "status": status,
                    "remaining_seconds": remaining_seconds,
                }
            )

        finished = {
            expedition["slot"]: expedition["name"]
            for expedition in valid_expeditions
            if expedition["status"] == "Finished"
        }

        if reminder_mode == "manual":
            if not finished:
                await self.schedule_expedition_check(
                    reminder, valid_expeditions, fallback_seconds=60
                )
                return False

            sent = await self.send_expedition_reminder(reminder, finished, "Manual")
            if not sent:
                await self.retry_reminder(reminder, seconds=60)
                return False

            await update_reminder(
                reminder["discord_user_id"],
                reminder_id,
                enabled=False,
                last_triggered_at=datetime.now(timezone.utc),
                next_trigger_at=None,
            )
            return True

        seen_finished = config.get("finished_slots", [])
        if not isinstance(seen_finished, list):
            seen_finished = []
        seen_finished = {str(slot) for slot in seen_finished}
        new_finished = {slot: name for slot, name in finished.items() if slot not in seen_finished}
        updated_config = {**config, "finished_slots": sorted(finished)}

        if new_finished:
            sent = await self.send_expedition_reminder(reminder, new_finished, "Automatic")
            if not sent:
                await self.retry_reminder(reminder, seconds=60)
                return False

        next_check = self.next_expedition_check(
            valid_expeditions, fallback_seconds=300 if finished else 60
        )
        update_values = {
            "enabled": True,
            "next_trigger_at": next_check,
        }
        if updated_config != config:
            update_values["config"] = updated_config
        if new_finished:
            update_values["last_triggered_at"] = datetime.now(timezone.utc)

        await update_reminder(reminder["discord_user_id"], reminder_id, **update_values)
        return bool(new_finished)

    def next_expedition_check(self, expeditions: list[dict], *, fallback_seconds: int):
        now = datetime.now(timezone.utc)
        remaining = [
            expedition["remaining_seconds"]
            for expedition in expeditions
            if expedition["status"] == "Ongoing" and expedition["remaining_seconds"] > 0
        ]
        delay = min(remaining) if remaining else fallback_seconds
        return now + timedelta(seconds=delay)

    async def schedule_expedition_check(
        self, reminder: dict, expeditions: list[dict], *, fallback_seconds: int
    ):
        await update_reminder(
            reminder["discord_user_id"],
            reminder["id"],
            enabled=True,
            next_trigger_at=self.next_expedition_check(
                expeditions, fallback_seconds=fallback_seconds
            ),
        )

    async def send_expedition_reminder(self, reminder: dict, finished: dict, mode: str) -> bool:
        genshin_uid = reminder.get("genshin_uid")
        user_id = reminder["discord_user_id"]
        accounts = await get_accounts(user_id)
        account = next((item for item in accounts if item.get("genshin_uid") == genshin_uid), None)
        account_name = (
            account.get("cyrene_nickname") or account.get("nickname") or "Unknown"
            if account
            else "Unknown"
        )
        names = "\n".join(f"• **{name}**" for name in finished.values())
        return await self.send_reminder(
            reminder,
            title="Expeditions Complete",
            message=(
                "Hey {recipient_mention}!\n\n"
                f"Your account **{account_name}** has finished these Expeditions:\n{names}"
            ),
            footer=f"UID: {genshin_uid} — {mode} Expedition Reminder",
        )

    async def handle_teapot(self, reminder: dict):
        uid = reminder.get("genshin_uid")
        if not uid:
            await self.retry_reminder(reminder, seconds=60)
            return False

        currency = None
        for candidate in await get_reminder_recipients(uid):
            try:
                client = await get_account_client(candidate, uid)
                if client is None:
                    continue
                async with client:
                    response = await client.get_genshin_daily_note(
                        client.genshin_uid, client.genshin_server
                    )
                currency = get_home_coin(response)
                reminder = {**reminder, "discord_user_id": candidate}
                break
            except Exception:
                logger.exception("Failed to fetch Realm Currency for reminder %s.", reminder["id"])
        if currency is None:
            await self.retry_reminder(reminder, seconds=60)
            return False

        current, maximum, recovery = currency
        config = dict(reminder.get("config") or {})
        amount = config.get("amount", maximum)
        if isinstance(amount, bool) or not isinstance(amount, int) or amount < 1:
            await self.retry_reminder(reminder, seconds=60)
            return False
        amount = min(amount, maximum)
        config["amount"] = amount
        now = datetime.now(timezone.utc)
        manual = reminder.get("reminder_mode") == "manual"
        if current < amount:
            config["triggered"] = False
            await update_reminder(
                reminder["discord_user_id"],
                reminder["id"],
                enabled=True,
                config=config,
                next_trigger_at=now
                + timedelta(seconds=max(60, recovery) if amount == maximum else 60),
            )
            return False
        if not manual and config.get("triggered"):
            await self.retry_reminder(reminder, seconds=300)
            return False

        accounts = await get_accounts(reminder["discord_user_id"])
        account = next((item for item in accounts if item.get("genshin_uid") == uid), {})
        name = account.get("cyrene_nickname") or account.get("nickname") or uid
        sent = await self.send_reminder(
            reminder,
            title="Realm Currency Full" if amount == maximum else "Realm Currency Reminder",
            message=(
                "Hey {recipient_mention}!\n\n"
                f"Your account **{name}** has {HOYOLAB_EMOJIS['realm_currency']}**{current}/{maximum}** Realm Currency."
            ),
            footer=f"UID: {uid} \u2014 {'Manual' if manual else 'Automatic'} Reminder",
            thumbnail=REALM_CURRENCY_IMAGE,
        )
        if not sent:
            await self.retry_reminder(reminder, seconds=60)
            return False
        config["triggered"] = True
        await update_reminder(
            reminder["discord_user_id"],
            reminder["id"],
            enabled=not manual,
            config=config,
            last_triggered_at=now,
            next_trigger_at=None if manual else now + timedelta(seconds=300),
        )
        return True

    async def handle_transformer(self, reminder: dict):
        uid = reminder.get("genshin_uid")
        if not uid:
            await self.retry_reminder(reminder, seconds=60)
            return False
        state = None
        for candidate in await get_reminder_recipients(uid):
            try:
                client = await get_account_client(candidate, uid)
                if client is None:
                    continue
                async with client:
                    response = await client.get_genshin_daily_note(
                        client.genshin_uid, client.genshin_server
                    )
                state = get_transformer_status(response)
                reminder = {**reminder, "discord_user_id": candidate}
                break
            except Exception:
                logger.exception(
                    "Failed to fetch Parametric Transformer for reminder %s.", reminder["id"]
                )
        if state is None:
            await self.retry_reminder(reminder, seconds=60)
            return False
        config = dict(reminder.get("config") or {})
        now = datetime.now(timezone.utc)
        if not state["obtained"] or state["remaining_seconds"] > 0:
            config["triggered"] = False
            await update_reminder(
                reminder["discord_user_id"],
                reminder["id"],
                config=config,
                next_trigger_at=now
                + timedelta(
                    seconds=max(60, state["remaining_seconds"]) if state["obtained"] else 3600
                ),
            )
            return False
        manual = reminder.get("reminder_mode") == "manual"
        if not manual and config.get("triggered"):
            await self.retry_reminder(reminder, seconds=300)
            return False
        accounts = await get_accounts(reminder["discord_user_id"])
        account = next((item for item in accounts if item.get("genshin_uid") == uid), {})
        name = account.get("cyrene_nickname") or account.get("nickname") or uid
        sent = await self.send_reminder(
            reminder,
            title="Parametric Transformer Ready",
            message=(
                "Hey {recipient_mention}!\n\n"
                f"Your account **{name}** has a {HOYOLAB_EMOJIS['parametric_transformer']} Parametric Transformer ready to use."
            ),
            footer=f"UID: {uid} \u2014 {'Manual' if manual else 'Automatic'} Reminder",
            thumbnail=Path("assets/hoyolab/daily/Parametric_Transformer.webp"),
        )
        if not sent:
            await self.retry_reminder(reminder, seconds=60)
            return False
        config["triggered"] = True
        await update_reminder(
            reminder["discord_user_id"],
            reminder["id"],
            enabled=not manual,
            config=config,
            last_triggered_at=now,
            next_trigger_at=None if manual else now + timedelta(seconds=300),
        )
        return True

    async def handle_custom(self, reminder: dict) -> bool:
        config = reminder.get("config") or {}

        message = config.get("message")

        if not message:
            logger.warning("Custom reminder %s has no message.", reminder["id"])

            await update_reminder(
                reminder["discord_user_id"], reminder["id"], enabled=False, next_trigger_at=None
            )

            return True

        sent = await self.send_reminder(reminder, title="Reminder", message=message)

        if not sent:
            return False

        await update_reminder(
            reminder["discord_user_id"],
            reminder["id"],
            enabled=False,
            last_triggered_at=datetime.now(timezone.utc),
            next_trigger_at=None,
        )

        return True

    async def send_reminder(self, reminder, *, title, message, footer=None, thumbnail=None) -> bool:
        if reminder.get("genshin_uid"):
            recipients = await get_reminder_recipients(reminder["genshin_uid"])
        else:
            recipients = [reminder["discord_user_id"]]
        sent = False
        for recipient in dict.fromkeys(recipients):
            # Each DM receives a fresh Embed/File, so attachments are not reused
            # after discord.py closes them. A blocked DM never blocks other users.
            delivered = await self._send_reminder_to_user(
                reminder,
                user_id=recipient,
                title=title,
                message=message,
                footer=footer,
                thumbnail=thumbnail,
            )
            sent = delivered or sent
        return sent

    async def _send_reminder_to_user(
        self,
        reminder: dict,
        *,
        user_id: int,
        title: str,
        message: str,
        footer: str | None = None,
        thumbnail: Path | None = None,
    ) -> bool:

        user = self.bot.get_user(user_id)

        if user is None:
            try:
                user = await self.bot.fetch_user(user_id)

            except discord.NotFound:
                return False

            except discord.HTTPException:
                logger.exception("Failed to fetch Discord user %s.", user_id)
                return False

        embed = discord.Embed(
            title=title,
            description=str(message).replace("{recipient_mention}", f"<@{user_id}>"),
            colour=discord.Colour.blurple(),
        )

        if footer is not None:
            embed.set_footer(text=footer)

        file = None

        if thumbnail is not None:
            file = discord.File(thumbnail, filename=thumbnail.name)

            embed.set_thumbnail(url=f"attachment://{thumbnail.name}")

        delivery_type = reminder.get("delivery_type", "dm")

        if delivery_type != "dm":
            logger.warning(
                "Unsupported delivery type %r for reminder %s.", delivery_type, reminder["id"]
            )
            return False

        try:
            await user.send(embed=embed, file=file)

        except discord.Forbidden:
            logger.warning("Discord user %s has DMs disabled or blocked the bot.", user_id)
            return False

        except discord.HTTPException:
            logger.exception("Discord HTTP error while sending DM to %s.", user_id)
            return False

        logger.info("Reminder %s sent to Discord user %s.", reminder["id"], user_id)

        return True
