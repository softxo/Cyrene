import re

import discord
from discord import app_commands
from discord.ext import commands

OWNER_IDS = frozenset({1557792995179495497, 1554226490462183505})
MESSAGE_TEXT_ID = 10
REPLY_HEADING = "**Reply to your Cyrene DM**\n\n"


def message_embed(text: str, sender: discord.User, show_sender: bool):
    embed = discord.Embed(description=f">>> {text}", colour=discord.Colour.from_str("#d98cb3"))
    if show_sender:
        embed.set_author(
            name=f"{sender.display_name} (@{sender.name})",
            icon_url=sender.display_avatar.url,
        )
    return embed


def original_message_text(message: discord.Message) -> str:
    if message.content:
        return message.content
    if message.embeds and message.embeds[0].description:
        description = message.embeds[0].description
        if description.startswith(REPLY_HEADING):
            description = description[len(REPLY_HEADING) :].removesuffix("\n\n\u200b")
        return description.removeprefix(">>> ")
    view = discord.ui.LayoutView.from_message(message)
    for item in view.walk_children():
        if isinstance(item, discord.ui.TextDisplay) and item.id == MESSAGE_TEXT_ID:
            return item.content
    return "(Original message unavailable)"


class ReplyModal(discord.ui.Modal, title="Reply to Cyrene's message"):
    reply = discord.ui.TextInput(
        label="Your reply", style=discord.TextStyle.paragraph, max_length=2000
    )

    def __init__(self, owner_id: int, recipient_id: int, original_message: str):
        super().__init__()
        self.owner_id = owner_id
        self.recipient_id = recipient_id
        self.original_message = original_message
        self.show_sender = discord.ui.Checkbox(default=True)
        self.add_item(
            discord.ui.Label(
                text="Show my profile information",
                description="Include your profile picture, display name and @username in the reply.",
                component=self.show_sender,
            )
        )

    async def on_submit(self, interaction: discord.Interaction):
        if interaction.user.id != self.recipient_id or not OWNER_IDS.intersection(
            (self.owner_id, self.recipient_id)
        ):
            await interaction.response.send_message(
                "This reply is not available to you.", ephemeral=True
            )
            return
        if not self.reply.value.strip():
            await interaction.response.send_message("Please enter a reply.", ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        embed = message_embed(self.reply.value, interaction.user, self.show_sender.value)
        embed.description = f"{REPLY_HEADING}{embed.description}"
        original = self.original_message or "(No text)"
        for offset in range(0, len(original), 1000):
            embed.add_field(
                name="Original Message" if offset == 0 else "Original Message (continued)",
                value=f">>> {original[offset : offset + 1000]}",
                inline=False,
            )
        view = discord.ui.View(timeout=None)
        view.add_item(ReplyButton(self.recipient_id, self.owner_id))
        try:
            recipient = await interaction.client.fetch_user(self.owner_id)
            await recipient.send(
                embed=embed, view=view, allowed_mentions=discord.AllowedMentions.none()
            )
        except discord.Forbidden:
            status = "I couldn't deliver your reply. The recipient's DMs may be closed."
        except discord.HTTPException:
            status = "Discord couldn't deliver your reply. Please try again later."
        else:
            status = "Your reply has been sent privately to the sender."
        await interaction.followup.send(status, ephemeral=True)


class ReplyButton(
    discord.ui.DynamicItem[discord.ui.Button],
    template=r"cyrene:dm:reply:(?P<owner_id>\d+):(?P<recipient_id>\d+)",
):
    def __init__(self, owner_id: int, recipient_id: int):
        self.owner_id = owner_id
        self.recipient_id = recipient_id
        super().__init__(
            discord.ui.Button(
                label="Reply",
                style=discord.ButtonStyle.secondary,
                custom_id=f"cyrene:dm:reply:{owner_id}:{recipient_id}",
            )
        )

    @classmethod
    async def from_custom_id(
        cls, interaction: discord.Interaction, item: discord.ui.Item, match: re.Match[str]
    ):
        return cls(int(match["owner_id"]), int(match["recipient_id"]))

    async def callback(self, interaction: discord.Interaction):
        if interaction.user.id != self.recipient_id or not OWNER_IDS.intersection(
            (self.owner_id, self.recipient_id)
        ):
            await interaction.response.send_message(
                "This reply is not available to you.", ephemeral=True
            )
            return
        await interaction.response.send_modal(
            ReplyModal(self.owner_id, self.recipient_id, original_message_text(interaction.message))
        )


class DirectMessage(commands.Cog):
    def __init__(self, bot: commands.Bot):
        self.bot = bot

    async def cog_load(self):
        self.bot.add_dynamic_items(ReplyButton)

    async def cog_unload(self):
        self.bot.remove_dynamic_items(ReplyButton)

    @app_commands.command(name="dm", description="Send a private message as Cyrene (owners only).")
    @app_commands.describe(
        user="Who to message",
        message="The message to send",
        allow_reply="Include a button for a private reply to you",
        show_sender="Show your profile picture, display name and @username",
    )
    async def dm(
        self,
        interaction: discord.Interaction,
        user: discord.User,
        message: app_commands.Range[str, 1, 2000],
        allow_reply: bool = True,
        show_sender: bool = True,
    ):
        if interaction.user.id not in OWNER_IDS:
            await interaction.response.send_message(
                "Only Cyrene's owners can use this command.", ephemeral=True
            )
            return
        if user.bot or not message.strip():
            await interaction.response.send_message(
                "Choose a person and enter a non-empty message.", ephemeral=True
            )
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        embed = message_embed(message, interaction.user, show_sender)
        view = None
        if allow_reply:
            view = discord.ui.View(timeout=None)
            view.add_item(ReplyButton(interaction.user.id, user.id))
        try:
            await user.send(embed=embed, view=view, allowed_mentions=discord.AllowedMentions.none())
        except discord.Forbidden:
            status = "I couldn't send that DM. The user may have closed DMs or blocked Cyrene."
        except discord.HTTPException:
            status = "Discord couldn't deliver the message. Please try again later."
        else:
            status = f"Message sent to {user} ({user.id})."
        await interaction.followup.send(status, ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(DirectMessage(bot))
