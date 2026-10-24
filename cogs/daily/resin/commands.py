import discord
import time
from pathlib import Path
from datetime import datetime, timezone
from discord import app_commands
from discord.ext import commands
from utils.hoyolab.account_client import get_account_client
from utils.hoyolab.database import (
    get_accounts,
    get_reminders,
    delete_reminder,
    create_reminder
)
from utils.hoyolab.daily_note import get_resin
from utils.errors.error_handler import create_error_embed
from utils.constants.emojis import (
    HOYOLAB_EMOJIS,
    ERROR_EMOJIS,
    MISC_EMOJIS
)
from utils.errors.error_handler import send_not_your_command


async def _get_resin_message(
    user_id: int,
    account: dict
):
    try:
        client = await get_account_client(
            user_id,
            account["genshin_uid"]
        )
        

        if client is None:
            embed = create_error_embed(
                "Account Not Found",
                "The linked Genshin account could not be found.",
                "not_found"
            )

            return embed, None

        async with client:
            response = await client.get_genshin_daily_note(
                client.genshin_uid,
                client.genshin_server
            )

        current_resin, max_resin, recovery = get_resin(
            response
        )

        if current_resin >= max_resin:
            replenished_in = "Full"
            fully_replenished = "Full"

        else:
            remaining_resin = max_resin - current_resin

            next_resin_seconds = recovery

            fully_replenished_seconds = (
                    next_resin_seconds
                    + ((remaining_resin - 1) * 480)
            )

            next_resin_timestamp = (
                    int(time.time()) + next_resin_seconds
            )

            replenished_in = (
                f"<t:{next_resin_timestamp}:R>"
            )

            fully_replenished_timestamp = (
                    int(time.time())
                    + fully_replenished_seconds
            )

            fully_replenished = (
                f"<t:{fully_replenished_timestamp}:R>"
            )

    except Exception:
        import traceback
        traceback.print_exc()

        embed = create_error_embed(
            "Failed to Retrieve Resin",
            "Cyrene couldn't retrieve your Genshin Resin data from HoYoLAB.",
            "error"
        )

        return embed, None

    resin_image = Path(
        "assets/hoyolab/daily/Original_Resin.webp"
    )

    reminders = await get_reminders(
        user_id
    )

    manual_reminder, automatic_reminder = get_resin_reminders(
        reminders,
        account["genshin_uid"]
    )

    manual_status, manual_amount = get_resin_reminder_display(
        manual_reminder
    )

    automatic_status, automatic_amount = get_resin_reminder_display(
        automatic_reminder
    )

    file = discord.File(
        resin_image,
        filename="Original_Resin.webp"
    )

    embed = discord.Embed(
        title="Resin",
        colour=discord.Colour.blurple()
    )

    embed.set_thumbnail(
        url="attachment://Original_Resin.webp"
    )

    embed.add_field(
        name=f"{HOYOLAB_EMOJIS['account']} Account",
        value=(
            f"- **Name**: {account.get('nickname', 'Unknown')}\n"
            f"- **UID**: {account['genshin_uid']}\n"
            f"- **AR**: {account.get('level', 'Unknown')}"
        ) + "\n\u200b",
        inline=False
    )

    embed.add_field(
        name=f"{HOYOLAB_EMOJIS['original_resin']} Resin",
        value=(
            f"- **Current**: {current_resin}/{max_resin}\n"
            f"- **Replenished**: {replenished_in}\n"
            f"- **Fully Replenished**: {fully_replenished}"
        ) + "\n\u200b",
        inline=False
    )

    embed.add_field(
        name=f"{HOYOLAB_EMOJIS['reminder']} Reminders",
        value=(
            "⦁\u2002**Manual Reminder**\n"
            "⦁\u2002**Automatic Reminder**"
        ),
        inline=True
    )

    embed.add_field(
        name="\u200b",
        value=(
            f"{manual_status}\n"
            f"{automatic_status}"
        ),
        inline=True
    )

    embed.add_field(
        name="\u200b",
        value=(
            f"{f'{manual_amount}' if manual_amount else '\u200b'}\n"
            f"{f'{automatic_amount}' if automatic_amount else '\u200b'}"
        ),
        inline=True
    )

    return embed, file


def create_account_options(
    accounts: list[dict]
) -> list[discord.SelectOption]:
    options = []

    for account in accounts:
        options.append(
            discord.SelectOption(
                label=(
                    account.get("nickname")
                    or account["genshin_uid"]
                ),
                description=(
                    f"UID: {account['genshin_uid']}"
                    + (
                        f" • AR: {account['level']}"
                        if account.get("level") is not None
                        else ""
                    )
                ),
                value=account["genshin_uid"]
            )
        )

    return options


def get_resin_reminders(
    reminders: list[dict],
    genshin_uid: str
) -> tuple[dict | None, dict | None]:

    manual = next(
        (
            reminder
            for reminder in reminders
            if reminder["genshin_uid"] == genshin_uid
            and reminder["reminder_type"] == "resin"
            and reminder["reminder_mode"] == "manual"
        ),
        None
    )

    automatic = next(
        (
            reminder
            for reminder in reminders
            if reminder["genshin_uid"] == genshin_uid
            and reminder["reminder_type"] == "resin"
            and reminder["reminder_mode"] == "automatic"
        ),
        None
    )

    return manual, automatic


def get_resin_reminder_display(
    reminder: dict | None
) -> tuple[str, str]:

    if reminder is None or not reminder["enabled"]:
        return (
            f"{ERROR_EMOJIS['error']} Disabled",
            "\u200b"
        )

    config = reminder.get("config") or {}

    amount = config.get("amount")

    status = (
        f"{ERROR_EMOJIS['success']} Enabled"
    )

    if amount is None:
        return status, "\u200b"

    amount_text = (
        f"{HOYOLAB_EMOJIS['original_resin']} "
        f"**{amount} Resin**"
    )

    return status, amount_text


class ResinAccountSelect(discord.ui.Select):
    def __init__(
        self,
        discord_user_id: int,
        options: list[discord.SelectOption],
        view: "ResinAccountView"
    ):
        super().__init__(
            placeholder="Select a Genshin Account...",
            options=options
        )

        self.discord_user_id = discord_user_id
        self.account_view = view

    async def callback(
        self,
        interaction: discord.Interaction
    ):
        await interaction.response.defer()

        genshin_uid = self.values[0]

        accounts = await get_accounts(
            self.discord_user_id
        )

        account = next(
            (
                account
                for account in accounts
                if account["genshin_uid"] == genshin_uid
            ),
            None
        )

        if account is None:
            embed = create_error_embed(
                "Account Not Found",
                "The selected Genshin account could not be found.",
                "not_found"
            )

            await interaction.edit_original_response(
                embed=embed,
                attachments=[],
                view=self.account_view
            )

            return

        embed, file = await _get_resin_message(
            self.discord_user_id,
            account
        )

        reminders = await get_reminders(
            self.discord_user_id
        )

        self.account_view = ResinAccountView(
            self.discord_user_id,
            accounts,
            genshin_uid,
            reminders,
            account,
            show_back=self.account_view.show_back
        )

        if file is not None:
            await interaction.edit_original_response(
                embed=embed,
                attachments=[file],
                view=self.account_view
            )
        else:
            await interaction.edit_original_response(
                embed=embed,
                attachments=[],
                view=self.account_view
            )


class ResinReminderButton(discord.ui.Button):
    def __init__(
        self,
        discord_user_id: int,
        view: "ResinAccountView",
        mode: str,
        reminder: dict | None
    ):
        self.discord_user_id = discord_user_id
        self.account_view = view
        self.mode = mode

        self.enabled = (
            reminder is not None
            and reminder["enabled"]
        )

        if mode == "manual":
            label = (
                "Remove Manual Reminder"
                if self.enabled
                else "Add Manual Reminder"
            )
        else:
            label = (
                "Remove Automatic Reminder"
                if self.enabled
                else "Add Automatic Reminder"
            )

        emoji = (
            MISC_EMOJIS["remove"]
            if self.enabled
            else MISC_EMOJIS["add"]
        )

        super().__init__(
            label=label,
            emoji=emoji,
            style=discord.ButtonStyle.secondary
        )

    async def callback(
        self,
        interaction: discord.Interaction
    ):
        if not self.enabled:
            await interaction.response.send_modal(
                ResinReminderModal(
                    self.discord_user_id,
                    self.account_view.genshin_uid,
                    self.mode,
                    self.account_view,
                    interaction.message
                )
            )
            return

        await interaction.response.defer()

        reminders = await get_reminders(
            self.discord_user_id
        )

        reminder = next(
            (
                reminder
                for reminder in reminders
                if reminder["genshin_uid"]
                == self.account_view.genshin_uid
                and reminder["reminder_type"] == "resin"
                and reminder["reminder_mode"] == self.mode
            ),
            None
        )

        if reminder is not None and reminder["enabled"]:
            await delete_reminder(
                self.discord_user_id,
                reminder["id"]
            )

        accounts = await get_accounts(
            self.discord_user_id
        )

        account = next(
            (
                account
                for account in accounts
                if account["genshin_uid"]
                == self.account_view.genshin_uid
            ),
            None
        )

        if account is None:
            await interaction.edit_original_response(
                embed=create_error_embed(
                    "Account Not Found",
                    "The selected Genshin account could not be found.",
                    "not_found"
                ),
                attachments=[],
                view=None
            )
            return

        reminders = await get_reminders(
            self.discord_user_id
        )

        embed, file = await _get_resin_message(
            self.discord_user_id,
            account
        )

        new_view = ResinAccountView(
            self.discord_user_id,
            accounts,
            self.account_view.genshin_uid,
            reminders,
            selected_account=account if self.account_view.show_back else None,
            show_back=self.account_view.show_back
        )

        await interaction.edit_original_response(
            embed=embed,
            attachments=[
                file
            ] if file is not None else [],
            view=new_view
        )


class ResinBackButton(discord.ui.Button):
    def __init__(
        self,
        discord_user_id: int,
        accounts: list[dict],
        selected_account: dict
    ):
        self.discord_user_id = discord_user_id
        self.accounts = accounts
        self.selected_account = selected_account

        super().__init__(
            label="Back",
            emoji=MISC_EMOJIS["back"],
            style=discord.ButtonStyle.secondary
        )

    async def callback(
        self,
        interaction: discord.Interaction
    ):
        from cogs.reminders.commands import (
            RemindersView,
            build_reminders_embed
        )

        reminders = await get_reminders(
            self.discord_user_id
        )

        account_reminders = [
            reminder
            for reminder in reminders
            if reminder["genshin_uid"]
            == self.selected_account["genshin_uid"]
        ]

        embed = build_reminders_embed(
            self.selected_account,
            account_reminders
        )

        view = RemindersView(
            self.discord_user_id,
            self.accounts,
            self.selected_account
        )

        await interaction.response.edit_message(
            embed=embed,
            attachments=[],
            view=view
        )


class ResinAccountView(discord.ui.View):
    def __init__(
        self,
        discord_user_id: int,
        accounts: list[dict],
        genshin_uid: str,
        reminders: list[dict],
        selected_account: dict | None = None,
        show_back: bool = False
    ):
        super().__init__(
            timeout=600
        )

        self.discord_user_id = discord_user_id
        self.genshin_uid = genshin_uid
        self.show_back = show_back

        if len(accounts) > 1:
            self.add_item(
                ResinAccountSelect(
                    discord_user_id,
                    create_account_options(accounts),
                    self
                )
            )

        if self.show_back and selected_account is not None:
            self.add_item(
                ResinBackButton(
                    discord_user_id,
                    accounts,
                    selected_account
                )
            )

        manual_reminder, automatic_reminder = get_resin_reminders(
            reminders,
            genshin_uid
        )

        self.add_item(
            ResinReminderButton(
                discord_user_id,
                self,
                "manual",
                manual_reminder
            )
        )

        self.add_item(
            ResinReminderButton(
                discord_user_id,
                self,
                "automatic",
                automatic_reminder
            )
        )

    async def interaction_check(
        self,
        interaction: discord.Interaction
    ) -> bool:

        if interaction.user.id != self.discord_user_id:
            await send_not_your_command(interaction)
            return False

        return True


class ResinReminderModal(discord.ui.Modal):

    def __init__(
        self,
        discord_user_id: int,
        genshin_uid: str,
        mode: str,
        resin_view: "ResinAccountView",
        parent_message: discord.Message
    ):
        super().__init__(
            title=(
                "Set Manual Resin Reminder"
                if mode == "manual"
                else "Set Automatic Resin Reminder"
            )
        )

        self.discord_user_id = discord_user_id
        self.genshin_uid = genshin_uid
        self.mode = mode
        self.resin_view = resin_view
        self.parent_message = parent_message

        self.amount = discord.ui.TextInput(
            label="Resin Amount",
            placeholder="Enter an amount from 1 to 200",
            min_length=1,
            max_length=3,
            required=True
        )

        self.add_item(self.amount)

    async def on_submit(
        self,
        interaction: discord.Interaction
    ):
        try:
            amount = int(self.amount.value)

        except ValueError:
            await interaction.response.send_message(
                embed=create_error_embed(
                    "Invalid Resin Amount",
                    "Please enter a valid Resin amount.",
                    "invalid_input"
                ),
                ephemeral=interaction.guild is not None
            )
            return

        if not 1 <= amount <= 200:
            await interaction.response.send_message(
                embed=create_error_embed(
                    "Invalid Resin Amount",
                    "Resin must be between **1 and 200**.",
                    "invalid_input"
                ),
                ephemeral=interaction.guild is not None
            )
            return

        await create_reminder(
            discord_user_id=self.discord_user_id,
            reminder_type="resin",
            genshin_uid=self.genshin_uid,
            config={
                "amount": amount
            },
            delivery_type="dm",
            reminder_mode=self.mode,
            next_trigger_at=datetime.now(timezone.utc)
        )

        accounts = await get_accounts(
            self.discord_user_id
        )

        account = next(
            (
                account
                for account in accounts
                if account["genshin_uid"] == self.genshin_uid
            ),
            None
        )

        if account is not None:
            reminders = await get_reminders(
                self.discord_user_id
            )

            view = ResinAccountView(
                self.discord_user_id,
                accounts,
                self.genshin_uid,
                reminders,
                selected_account=account if self.resin_view.show_back else None,
                show_back=self.resin_view.show_back
            )

            embed, file = await _get_resin_message(
                self.discord_user_id,
                account
            )

            try:
                await self.parent_message.edit(
                    embed=embed,
                    attachments=[
                        file
                    ] if file is not None else [],
                    view=view
                )

            except discord.NotFound:
                pass

        confirmation = create_error_embed(
            "Resin Reminder Set",
            (
                f"Your **{self.mode.title()} Resin Reminder** has been set to {HOYOLAB_EMOJIS['original_resin']}**{amount} Resin**."
            ),
            "success"
        )

        await interaction.response.send_message(
            embed=confirmation,
            ephemeral=interaction.guild is not None
        )


class Resin(commands.Cog):
    def __init__(
        self,
        bot: commands.Bot
    ):
        self.bot = bot

    async def _show_resin(
        self,
        user_id: int,
        accounts: list[dict],
        *,
        interaction: discord.Interaction | None = None,
        ctx: commands.Context | None = None,
        ephemeral: bool = True
    ):
        account = accounts[0]

        reminders = await get_reminders(
            user_id
        )

        view = ResinAccountView(
            user_id,
            accounts,
            account["genshin_uid"],
            reminders
        )

        embed, file = await _get_resin_message(
            user_id,
            account
        )

        if interaction:
            await interaction.followup.send(
                embed=embed,
                file=file,
                view=view,
                ephemeral=ephemeral
            )

        else:
            await ctx.send(
                embed=embed,
                file=file,
                view=view
            )

    @app_commands.command(
        name="resin",
        description="Check your Resin."
    )
    @app_commands.allowed_contexts(
        guilds=True,
        dms=True
    )
    async def resin(
        self,
        interaction: discord.Interaction
    ):
        accounts = await get_accounts(
            interaction.user.id
        )

        if not accounts:
            embed = create_error_embed(
                "No HoYoLAB Account Linked",
                (
                    "You don't currently have a Genshin account linked to Cyrene.\n\n"
                    "Use `/accounts` to link one."
                ),
                "not_found"
            )

            await interaction.response.send_message(
                embed=embed,
                ephemeral=interaction.guild is not None
            )

            return

        account = accounts[0]

        reminders = await get_reminders(
            interaction.user.id
        )

        view = ResinAccountView(
            interaction.user.id,
            accounts,
            account["genshin_uid"],
            reminders
        )

        embed, file = await _get_resin_message(
            interaction.user.id,
            account
        )

        await interaction.response.send_message(
            embed=embed,
            file=file,
            view=view,
            ephemeral=interaction.guild is not None
        )

    @commands.command(
        name="resin"
    )
    async def resin_prefix(
        self,
        ctx: commands.Context
    ):
        accounts = await get_accounts(
            ctx.author.id
        )

        if not accounts:
            embed = create_error_embed(
                "No HoYoLAB Account Linked",
                (
                    "You don't currently have a Genshin account linked to Cyrene.\n\n"
                    "Use `/accounts` to link one."
                ),
                "not_found"
            )

            await ctx.send(
                embed=embed
            )

            return

        await self._show_resin(
            ctx.author.id,
            accounts,
            ctx=ctx,
            ephemeral=False
        )


async def setup(bot: commands.Bot):
    await bot.add_cog(Resin(bot))