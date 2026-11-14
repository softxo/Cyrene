"""Mirrors website support tickets into staff threads and relays staff replies back."""

import asyncio
import io
import logging
import os
import re
import time
from datetime import timedelta

import discord
from discord import app_commands
from discord.ext import commands, tasks

from shared import support_bridge
from shared.storage import support_store
from shared.storage.account_limits import SPECIAL_USER_IDS, is_staff
from shared.storage.database import get_pool

logger = logging.getLogger(__name__)
SUPPORT_ROLE_NAME = "Cyrene Support"
INACTIVE_HOURS = 24
COLOUR = discord.Colour.from_str("#d98cb3")
STAFF_COLOUR = discord.Colour.from_str("#ff4d5e")
SUPPORT_CHANNEL_ID = int(os.getenv("SUPPORT_CHANNEL_ID") or 1570781018820972656)
SITE_URL = (os.getenv("SITE_URL") or "https://cyrene-teyvat.xyz").rstrip("/")
LOG_CHANNEL_NAME = "support-logs"
LOG_CHANNEL_ID = int(os.getenv("SUPPORT_LOG_CHANNEL_ID") or 0)
OUTCOMES = {"solved": ("✅ Solved", "#4fc283"), "closed": ("🔒 Closed", "#7d8590")}
ROLE_TOKEN = "<@&support>"
MENTION_PATTERN = re.compile(r"<@!?(\d{15,20})>")


def discord_body(message: discord.Message):
    body = message.clean_content.strip()
    for embed in message.embeds:
        media = embed.video.url if embed.type == "gifv" else None
        media = media or (embed.thumbnail.url if embed.type in {"image", "gifv"} else None)
        if not media:
            continue
        if embed.url and embed.url in body:
            body = body.replace(embed.url, media)
        elif media not in body:
            body = f"{body}\n{media}"
    for attachment in message.attachments:
        if not storable(attachment):
            body = f"{body}\n{attachment.url}"
    return body.strip()[:4000]


def storable(attachment: discord.Attachment):
    return (attachment.content_type or "").startswith("image/") and (
        attachment.size <= support_store.MAX_IMAGE_BYTES
    )


async def download_images(message: discord.Message):
    files = []
    for attachment in message.attachments:
        if not storable(attachment) or len(files) >= support_store.MAX_IMAGES:
            continue
        try:
            data = await attachment.read()
        except discord.HTTPException:
            logger.exception("Couldn't download a support image from Discord.")
            continue
        kind = support_store.sniff_image(data)
        if kind is None:
            continue
        extension, content_type = kind
        files.append(
            {
                "filename": f"image-{len(files) + 1}.{extension}",
                "content_type": content_type,
                "data": data,
            }
        )
    return files


def message_embed(message):
    embed = discord.Embed(
        description=message["body"] or None,
        colour=STAFF_COLOUR if message["from_staff"] else COLOUR,
    )
    avatar = message.get("author_avatar") or ""
    name = message["author_name"]
    embed.set_author(
        name=f"{name} · 🛡️ Cyrene Staff" if message["from_staff"] else name,
        icon_url=avatar if avatar.startswith("https://cdn.discordapp.com/") else None,
    )
    files = message.get("files") or []
    if files:
        embed.set_image(url=f"attachment://{files[0]['filename']}")
    return embed


def discord_files(message):
    return [
        discord.File(io.BytesIO(file["data"]), filename=file["filename"])
        for file in message.get("files") or []
    ]


def duration_text(delta: timedelta):
    minutes = int(delta.total_seconds() // 60)
    days, minutes = divmod(minutes, 1440)
    hours, minutes = divmod(minutes, 60)
    parts = [
        f"{days}d" if days else "",
        f"{hours}h" if hours else "",
        f"{minutes}m" if minutes else "",
    ]
    return " ".join(part for part in parts if part) or "0m"


def ticket_card(ticket, message=None):
    topic = support_store.TOPICS.get(ticket["topic"], ticket["topic"])
    card = discord.Embed(
        title=f"🎫 {topic}",
        colour=COLOUR,
        timestamp=ticket["created_at"],
    )
    avatar = (message or {}).get("author_avatar") or ""
    card.set_author(
        name=ticket["author_name"],
        icon_url=avatar if avatar.startswith("https://cdn.discordapp.com/") else None,
    )
    if message:
        body = (message["body"] or "📷 Image").replace(ROLE_TOKEN, f"@{SUPPORT_ROLE_NAME}")
        preview = body if len(body) <= 300 else f"{body[:299]}…"
        card.description = "\n".join(f"> {line}" for line in preview.splitlines() or [""])
    account = f"<@{ticket['discord_user_id']}>" if ticket["discord_user_id"] else "Not signed in"
    card.add_field(name="Ticket", value=f"#{ticket['id']}")
    card.add_field(name="Discord", value=account)
    card.add_field(name="Opened", value=discord.utils.format_dt(ticket["created_at"], "R"))
    card.set_footer(text="Reply in the thread · Mark as solved or archive it when you're done")
    return card


THREAD_STATUS = {"open": "🟢 Open", "solved": "✅ Solved", "closed": "🔒 Closed"}


def thread_name(ticket, status):
    topic = support_store.TOPICS.get(ticket["topic"], ticket["topic"])
    label = "🔐 Locked" if status == "open" and ticket.get("locked") else THREAD_STATUS[status]
    return f"{label} · {topic} · {ticket['author_name']} · #{ticket['id']}"[:100]


STATUS_EMBEDS = {
    "solved": ("✅ Marked as solved", "#4fc283"),
    "closed": ("🔒 Conversation closed", "#7d8590"),
    "open": ("🔓 Conversation reopened", "#d98cb3"),
    "locked": ("🔐 Conversation locked", "#e0a458"),
    "unlocked": ("🔑 Conversation unlocked", "#d98cb3"),
}
STATUS_DESCRIPTIONS = {
    "locked": "Only staff can reply until it's unlocked.",
    "unlocked": "The member can reply again.",
}

# Each ticket command: the field it changes, the new value, and the reply when nothing changes.
TICKET_COMMANDS = {
    "tclose": ("status", "closed", "It's already closed."),
    "tsolved": ("status", "solved", "It's already solved."),
    "topen": ("status", "open", "It's already open."),
    "tlock": ("locked", True, "It's already locked."),
    "tunlock": ("locked", False, "It isn't locked."),
}


def status_embed(ticket_id, status, actor, where, description=None):
    title, colour = STATUS_EMBEDS[status]
    extra = STATUS_DESCRIPTIONS.get(status)
    embed = discord.Embed(
        title=title,
        description=description or f"By {actor} {where}." + (f"\n{extra}" if extra else ""),
        colour=discord.Colour.from_str(colour),
        timestamp=discord.utils.utcnow(),
    )
    embed.set_footer(text=f"Ticket #{ticket_id}")
    return embed


STATUS_ACTIONS = {
    "solve": ("solved", "Mark as solved", discord.ButtonStyle.success, "It's already solved."),
    "close": ("closed", "Close", discord.ButtonStyle.secondary, "It's already closed."),
}


class StatusButton(
    discord.ui.DynamicItem[discord.ui.Button],
    template=r"cyrene:support:(?P<action>solve|close):(?P<ticket_id>\d+)",
):
    def __init__(self, action: str, ticket_id: int):
        self.action = action
        self.ticket_id = ticket_id
        _, label, style, _ = STATUS_ACTIONS[action]
        super().__init__(
            discord.ui.Button(
                label=label, style=style, custom_id=f"cyrene:support:{action}:{ticket_id}"
            )
        )

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: discord.ui.Item, match: re.Match[str]
    ):
        return cls(match["action"], int(match["ticket_id"]))

    async def callback(self, interaction: discord.Interaction):
        status, _, _, already = STATUS_ACTIONS[self.action]
        if not is_staff(interaction.user.id):
            await interaction.response.send_message(
                "Only Cyrene staff can change a ticket's status.", ephemeral=True
            )
            return
        pool = get_pool()
        ticket = await support_store.get_ticket(pool, self.ticket_id)
        if ticket is None:
            await interaction.response.send_message("That ticket no longer exists.", ephemeral=True)
            return
        if ticket["status"] == status:
            await interaction.response.send_message(already, ephemeral=True)
            return
        await support_store.set_status(pool, self.ticket_id, status)
        await interaction.response.send_message(
            f"Ticket #{self.ticket_id} is now {status}.", ephemeral=True
        )
        cog = interaction.client.get_cog("Support")
        if not isinstance(cog, Support):
            return
        cog.run_later(cog.log_ticket(self.ticket_id, f"{interaction.user.mention} in Discord"))
        if not ticket["discord_thread_id"]:
            return
        thread = await cog.resolve(ticket["discord_thread_id"])
        if not isinstance(thread, discord.Thread):
            return
        await thread.send(
            embed=status_embed(self.ticket_id, status, interaction.user.mention, "in Discord"),
            allowed_mentions=discord.AllowedMentions.none(),
        )
        cog.run_later(cog.apply_status(thread, ticket, status))


def ticket_actions(ticket_id):
    view = discord.ui.View(timeout=None)
    view.add_item(StatusButton("solve", ticket_id))
    view.add_item(StatusButton("close", ticket_id))
    return view


class Support(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.channel_id = SUPPORT_CHANNEL_ID
        self.backfilled = False
        self.ignore_updates: dict[int, float] = {}
        self.tasks: set[asyncio.Task] = set()

    def run_later(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.tasks.add(task)
        task.add_done_callback(self.finished)

    def finished(self, task: asyncio.Task):
        self.tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            logger.error("Couldn't update a support thread.", exc_info=task.exception())

    async def apply_status(self, thread: discord.Thread, ticket, status):
        name = thread_name(ticket, status)
        archived = status != "open"
        if thread.name == name and thread.archived == archived:
            return
        self.ignore_updates[thread.id] = time.monotonic() + 15
        if thread.archived:
            thread = await thread.edit(name=name, archived=False)
            if archived:
                self.ignore_updates[thread.id] = time.monotonic() + 15
                await thread.edit(archived=True)
        else:
            await thread.edit(name=name, archived=archived)

    async def cog_load(self):
        support_bridge.register(self.relay)
        self.bot.add_dynamic_items(StatusButton)

    async def cog_unload(self):
        support_bridge.unregister(self.relay)
        self.bot.remove_dynamic_items(StatusButton)
        self.close_inactive.cancel()

    @tasks.loop(minutes=10)
    async def close_inactive(self):
        try:
            closed = await support_store.close_inactive(get_pool(), INACTIVE_HOURS)
        except Exception:
            logger.exception("Couldn't close inactive support tickets.")
            return
        for ticket in closed:
            self.run_later(
                self.log_ticket(
                    ticket["id"], f"Cyrene, after {INACTIVE_HOURS} hours without activity"
                )
            )
            if not ticket["discord_thread_id"]:
                continue
            thread = await self.resolve(ticket["discord_thread_id"])
            if not isinstance(thread, discord.Thread):
                continue
            try:
                await thread.send(
                    embed=status_embed(
                        ticket["id"],
                        "closed",
                        None,
                        None,
                        description=f"Closed automatically after {INACTIVE_HOURS} hours without activity.",
                    ),
                    allowed_mentions=discord.AllowedMentions.none(),
                )
            except discord.HTTPException:
                logger.exception("Couldn't post the auto-close notice for ticket %s.", ticket["id"])
            self.run_later(self.apply_status(thread, ticket, "closed"))

    async def resolve(self, channel_id):
        channel = self.bot.get_channel(channel_id)
        if channel is not None:
            return channel
        try:
            return await self.bot.fetch_channel(channel_id)
        except discord.NotFound:
            return None

    async def log_channel(self):
        if LOG_CHANNEL_ID:
            channel = await self.resolve(LOG_CHANNEL_ID)
            return channel if isinstance(channel, discord.TextChannel) else None
        support = await self.resolve(self.channel_id)
        if not isinstance(support, discord.TextChannel):
            return None
        channel = discord.utils.get(support.guild.text_channels, name=LOG_CHANNEL_NAME)
        if channel is None:
            channel = await support.guild.create_text_channel(
                LOG_CHANNEL_NAME,
                category=support.category,
                overwrites=support.overwrites,
                topic="Transcripts of finished Cyrene support tickets.",
                reason="Cyrene support ticket logs",
            )
        return channel

    async def log_ticket(self, ticket_id, actor):
        pool = get_pool()
        ticket = await support_store.get_ticket(pool, ticket_id)
        if ticket is None or ticket["status"] not in OUTCOMES:
            return
        channel = await self.log_channel()
        if channel is None:
            return
        messages = await support_store.get_messages(pool, ticket_id)
        topic = support_store.TOPICS.get(ticket["topic"], ticket["topic"])
        outcome, colour = OUTCOMES[ticket["status"]]
        staff = sorted({message["author_name"] for message in messages if message["from_staff"]})
        account = (
            f"<@{ticket['discord_user_id']}>" if ticket["discord_user_id"] else "Not signed in"
        )
        embed = discord.Embed(
            title=f"📁 Ticket #{ticket['id']} · {topic}",
            colour=discord.Colour.from_str(colour),
            timestamp=discord.utils.utcnow(),
        )
        embed.add_field(name="From", value=f"{ticket['author_name']}\n{account}")
        embed.add_field(name="Outcome", value=f"{outcome}\nBy {actor}")
        embed.add_field(
            name="Opened",
            value=f"{discord.utils.format_dt(ticket['created_at'], 'f')}\n"
            f"Open for {duration_text(discord.utils.utcnow() - ticket['created_at'])}",
        )
        embed.add_field(name="Messages", value=str(len(messages)))
        embed.add_field(name="Staff", value=", ".join(staff) if staff else "No staff replies")
        if messages:
            first = (messages[0]["body"] or "📷 Image").replace(ROLE_TOKEN, f"@{SUPPORT_ROLE_NAME}")
            embed.description = "> " + (first if len(first) <= 200 else f"{first[:199]}…")
        view = discord.ui.View()
        view.add_item(
            discord.ui.Button(
                label="View transcript", emoji="📄", url=f"{SITE_URL}/support/logs/{ticket['id']}"
            )
        )
        if ticket["discord_thread_id"]:
            view.add_item(
                discord.ui.Button(
                    label="Open thread",
                    url=f"https://discord.com/channels/{channel.guild.id}/{ticket['discord_thread_id']}",
                )
            )
        await channel.send(embed=embed, view=view, allowed_mentions=discord.AllowedMentions.none())

    async def support_guild(self):
        channel = await self.resolve(self.channel_id)
        return channel.guild if isinstance(channel, discord.TextChannel) else None

    async def support_role(self, guild: discord.Guild):
        role = discord.utils.get(guild.roles, name=SUPPORT_ROLE_NAME)
        if role is None:
            role = await guild.create_role(
                name=SUPPORT_ROLE_NAME,
                colour=discord.Colour.from_str("#ff4d5e"),
                mentionable=True,
                reason="Cyrene support team role",
            )
        return role

    async def update_role(self, user_id: int, add: bool):
        guild = await self.support_guild()
        if guild is None:
            return "I couldn't find the support server, so the role wasn't changed."
        try:
            member = guild.get_member(user_id) or await guild.fetch_member(user_id)
        except discord.NotFound:
            return "They're not in the support server, so the role wasn't changed."
        try:
            role = await self.support_role(guild)
            if add:
                await member.add_roles(role, reason="Assigned to Cyrene support")
            else:
                await member.remove_roles(role, reason="Removed from Cyrene support")
        except discord.Forbidden:
            return f"I don't have permission to manage the {SUPPORT_ROLE_NAME} role."
        return f"{'Gave them' if add else 'Removed'} the {role.mention} role."

    @app_commands.command(
        name="assign-support", description="Add someone to the Cyrene support team (owners only)."
    )
    @app_commands.describe(user="Who should help answer support messages")
    @app_commands.default_permissions(administrator=True)
    async def assign_support(self, interaction: discord.Interaction, user: discord.User):
        if interaction.user.id not in SPECIAL_USER_IDS:
            await interaction.response.send_message(
                "Only Cyrene's owners can manage the support team.", ephemeral=True
            )
            return
        if user.bot:
            await interaction.response.send_message(
                "Bots can't join the support team.", ephemeral=True
            )
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        added = await support_store.assign_staff(get_pool(), user.id, interaction.user.id)
        role_note = await self.update_role(user.id, add=True)
        state = "is now on" if added else "was already on"
        await interaction.followup.send(
            f"{user.mention} {state} the support team. {role_note}",
            ephemeral=True,
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @app_commands.command(
        name="unassign-support",
        description="Remove someone from the Cyrene support team (owners only).",
    )
    @app_commands.describe(user="Who should stop answering support messages")
    @app_commands.default_permissions(administrator=True)
    async def unassign_support(self, interaction: discord.Interaction, user: discord.User):
        if interaction.user.id not in SPECIAL_USER_IDS:
            await interaction.response.send_message(
                "Only Cyrene's owners can manage the support team.", ephemeral=True
            )
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        removed = await support_store.unassign_staff(get_pool(), user.id)
        role_note = await self.update_role(user.id, add=False)
        state = "is no longer on" if removed else "wasn't on"
        note = " They're still staff through the list in the code." if is_staff(user.id) else ""
        await interaction.followup.send(
            f"{user.mention} {state} the support team. {role_note}{note}",
            ephemeral=True,
            allowed_mentions=discord.AllowedMentions.none(),
        )

    async def ticket_command(self, ctx: commands.Context, name: str, ticket_id: int | None):
        field, value, unchanged = TICKET_COMMANDS[name]
        if not is_staff(ctx.author.id):
            await ctx.send("Only Cyrene staff can change a ticket.", ephemeral=True)
            return
        pool = get_pool()
        ticket = None
        if ticket_id is not None:
            ticket = await support_store.get_ticket(pool, ticket_id)
        elif isinstance(ctx.channel, discord.Thread):
            ticket = await support_store.ticket_by_thread(pool, ctx.channel.id)
        if ticket is None:
            await ctx.send(
                "That ticket doesn't exist."
                if ticket_id is not None
                else "Use this in a ticket's thread, or give the ticket number.",
                ephemeral=True,
            )
            return
        if ticket[field] == value:
            await ctx.send(unchanged, ephemeral=True)
            return
        if field == "status":
            await support_store.set_status(pool, ticket["id"], value)
            event = value
        else:
            await support_store.set_locked(pool, ticket["id"], value)
            event = "locked" if value else "unlocked"
        ticket = await support_store.get_ticket(pool, ticket["id"])
        embed = status_embed(ticket["id"], event, ctx.author.mention, "in Discord")
        thread = None
        if ticket["discord_thread_id"]:
            thread = await self.resolve(ticket["discord_thread_id"])
            thread = thread if isinstance(thread, discord.Thread) else None
        none = discord.AllowedMentions.none()
        if thread is not None and ctx.channel.id == thread.id:
            await ctx.send(embed=embed, allowed_mentions=none)
        else:
            await ctx.send(f"Ticket #{ticket['id']}: {STATUS_EMBEDS[event][0]}.", ephemeral=True)
            if thread is not None:
                await thread.send(embed=embed, allowed_mentions=none)
        if field == "status" and value in OUTCOMES:
            self.run_later(self.log_ticket(ticket["id"], f"{ctx.author.mention} in Discord"))
        if thread is not None:
            self.run_later(self.apply_status(thread, ticket, ticket["status"]))

    @commands.hybrid_command(name="tclose", description="Close a support ticket (staff only).")
    @app_commands.describe(ticket="Ticket number, if you're not in its thread")
    async def tclose(self, ctx: commands.Context, ticket: int | None = None):
        await self.ticket_command(ctx, "tclose", ticket)

    @commands.hybrid_command(
        name="tsolved", description="Mark a support ticket as solved (staff only)."
    )
    @app_commands.describe(ticket="Ticket number, if you're not in its thread")
    async def tsolved(self, ctx: commands.Context, ticket: int | None = None):
        await self.ticket_command(ctx, "tsolved", ticket)

    @commands.hybrid_command(
        name="topen", description="Reopen a solved or closed support ticket (staff only)."
    )
    @app_commands.describe(ticket="Ticket number, if you're not in its thread")
    async def topen(self, ctx: commands.Context, ticket: int | None = None):
        await self.ticket_command(ctx, "topen", ticket)

    @commands.hybrid_command(
        name="tlock", description="Lock a support ticket so only staff can reply (staff only)."
    )
    @app_commands.describe(ticket="Ticket number, if you're not in its thread")
    async def tlock(self, ctx: commands.Context, ticket: int | None = None):
        await self.ticket_command(ctx, "tlock", ticket)

    @commands.hybrid_command(
        name="tunlock", description="Let the member reply to a locked ticket again (staff only)."
    )
    @app_commands.describe(ticket="Ticket number, if you're not in its thread")
    async def tunlock(self, ctx: commands.Context, ticket: int | None = None):
        await self.ticket_command(ctx, "tunlock", ticket)

    async def rearchive_later(self, thread_id):
        await asyncio.sleep(10)
        ticket = await support_store.ticket_by_thread(get_pool(), thread_id)
        if ticket is None or ticket["status"] == "open":
            return
        thread = await self.resolve(thread_id)
        if isinstance(thread, discord.Thread):
            await self.apply_status(thread, ticket, ticket["status"])

    async def refuse_finished(self, message: discord.Message, ticket):
        await message.reply(
            f"Ticket #{ticket['id']} is {ticket['status']}, so this wasn't sent to the member. "
            "Reopen it with `/topen` first.",
            delete_after=20,
            mention_author=False,
        )
        self.run_later(self.rearchive_later(message.channel.id))

    async def thread_for(self, ticket, message=None):
        if ticket["discord_thread_id"]:
            thread = await self.resolve(ticket["discord_thread_id"])
            if isinstance(thread, discord.Thread):
                return thread
        if not self.channel_id:
            return None
        channel = await self.resolve(self.channel_id)
        if not isinstance(channel, discord.TextChannel):
            raise RuntimeError(f"SUPPORT_CHANNEL_ID {self.channel_id} is not a text channel.")
        starter = await channel.send(
            embed=ticket_card(ticket, message),
            view=ticket_actions(ticket["id"]),
            allowed_mentions=discord.AllowedMentions.none(),
        )
        thread = await starter.create_thread(
            name=thread_name(ticket, "open"), auto_archive_duration=10080
        )
        await support_store.set_thread(get_pool(), ticket["id"], thread.id)
        return thread

    async def relay(self, event, ticket, message):
        thread = await self.thread_for(ticket, message if event == "ticket" else None)
        if thread is None:
            return
        if event in {"ticket", "message"}:
            body = message["body"] or ""
            pinged_role = event == "ticket" or ROLE_TOKEN in body
            role = None
            if pinged_role:
                try:
                    role = await self.support_role(thread.guild)
                except discord.HTTPException:
                    logger.exception("Couldn't find or create the %s role.", SUPPORT_ROLE_NAME)
            body = body.replace(ROLE_TOKEN, role.mention if role else f"@{SUPPORT_ROLE_NAME}")
            users = list(dict.fromkeys(int(user_id) for user_id in MENTION_PATTERN.findall(body)))
            pings = ([role.mention] if role else []) + [f"<@{user_id}>" for user_id in users]
            await thread.send(
                content=" ".join(pings) or None,
                embed=message_embed(dict(message, body=body)),
                files=discord_files(message),
                allowed_mentions=discord.AllowedMentions(
                    users=[discord.Object(user_id) for user_id in users],
                    roles=[role] if role else [],
                ),
            )
        elif event == "status":
            actor = discord.utils.escape_markdown((message or {}).get("actor", "someone"))
            await thread.send(
                embed=status_embed(
                    ticket["id"], ticket["status"], f"**{actor}**", "on the website"
                ),
                allowed_mentions=discord.AllowedMentions.none(),
            )
            if ticket["status"] in OUTCOMES:
                self.run_later(self.log_ticket(ticket["id"], f"**{actor}** on the website"))
        self.run_later(self.apply_status(thread, ticket, ticket["status"]))

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if (
            message.author.bot
            or not isinstance(message.channel, discord.Thread)
            or message.channel.parent_id != self.channel_id
            or not is_staff(message.author.id)
        ):
            return
        if (await self.bot.get_context(message)).valid:
            return
        body = discord_body(message)
        pool = get_pool()
        ticket = await support_store.ticket_by_thread(pool, message.channel.id)
        if ticket is None:
            return
        if ticket["status"] != "open":
            await self.refuse_finished(message, ticket)
            return
        files = await download_images(message)
        if not body and not files:
            return
        try:
            saved = await support_store.add_message(
                pool,
                ticket["id"],
                True,
                message.author.display_name,
                body,
                "discord",
                message.id,
                author_id=message.author.id,
                author_avatar=message.author.display_avatar.url,
                files=files,
            )
        except support_store.TicketFinished:
            await self.refuse_finished(message, await support_store.get_ticket(pool, ticket["id"]))
            return
        if saved is not None:
            await message.add_reaction("✅")

    @commands.Cog.listener()
    async def on_message_edit(self, before: discord.Message, after: discord.Message):
        if (
            after.author.bot
            or not isinstance(after.channel, discord.Thread)
            or after.channel.parent_id != self.channel_id
            or not is_staff(after.author.id)
        ):
            return
        body = discord_body(after)
        if body and body != discord_body(before):
            await support_store.update_discord_message(get_pool(), after.id, body)

    @commands.Cog.listener()
    async def on_ready(self):
        if not self.close_inactive.is_running():
            self.close_inactive.start()
        if self.backfilled:
            return
        self.backfilled = True
        pool = get_pool()
        for row in await support_store.discord_messages_missing_author(pool):
            thread = await self.resolve(row["discord_thread_id"])
            if not isinstance(thread, discord.Thread):
                continue
            try:
                message = await thread.fetch_message(row["discord_message_id"])
            except discord.NotFound, discord.Forbidden:
                continue
            await support_store.update_discord_message(
                pool,
                message.id,
                discord_body(message) or message.content,
                message.author.id,
                message.author.display_avatar.url,
            )
        for ticket in await support_store.tickets_with_threads(pool):
            thread = await self.resolve(ticket["discord_thread_id"])
            if isinstance(thread, discord.Thread):
                self.run_later(self.apply_status(thread, ticket, ticket["status"]))

    @commands.Cog.listener()
    async def on_thread_update(self, before: discord.Thread, after: discord.Thread):
        if after.parent_id != self.channel_id or before.archived == after.archived:
            return
        if self.ignore_updates.get(after.id, 0) > time.monotonic():
            return
        pool = get_pool()
        ticket = await support_store.ticket_by_thread(pool, after.id)
        if ticket is None:
            return
        if after.archived:
            idle = discord.utils.utcnow() - ticket["updated_at"]
            if idle >= timedelta(minutes=after.auto_archive_duration - 5):
                return
            if await support_store.close_if_open(pool, ticket["id"]):
                self.run_later(self.log_ticket(ticket["id"], "archiving the thread in Discord"))
        elif ticket["status"] != "open":
            # Un-archiving never reopens a finished ticket; only /topen does.
            self.run_later(self.rearchive_later(after.id))
            return
        ticket = await support_store.get_ticket(pool, ticket["id"])
        self.run_later(self.apply_status(after, ticket, ticket["status"]))


async def setup(bot: commands.Bot):
    await bot.add_cog(Support(bot))
