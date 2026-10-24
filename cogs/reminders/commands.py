import discord
from discord import app_commands
from discord.ext import commands
from utils.constants.emojis import (
    HOYOLAB_EMOJIS,
    ERROR_EMOJIS,
)
from utils.errors.error_handler import (
    create_error_embed,
    send_context_error,
    send_not_your_command
)
from utils.hoyolab.database import (
    get_accounts,
    get_reminders
)



REMINDER_NAMES = {
    "resin": "Resin",
    "expedition": "Expeditions",
    "teapot": "Serenitea Pot",
    "transformer": "Parametric Transformer",
    "custom": "Custom",
}


REMINDER_EMOJIS = {
    "resin": HOYOLAB_EMOJIS["original_resin"],
    "expedition": HOYOLAB_EMOJIS["expeditions"],
    "teapot": HOYOLAB_EMOJIS["serenitea_pot"],
    "transformer": HOYOLAB_EMOJIS["parametric_transformer"],
    "custom": HOYOLAB_EMOJIS["custom"],
}


def get_account_name(account: dict) -> str:
    return (
        account.get("cyrene_nickname")
        or account.get("nickname")
        or f"UID {account['genshin_uid']}"
    )


def format_account_info(account: dict) -> str:
    name = get_account_name(account)

    return (
        f"- **Name**: {name}\n"
        f"- **UID**: {account['genshin_uid']}\n"
        f"- **AR**: {account.get('level') or 'Unknown'}"
    )


def get_reminder_emoji(reminder_type: str) -> str:
    return REMINDER_EMOJIS.get(
        reminder_type,
        HOYOLAB_EMOJIS["notification"]
    )


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


def get_reminder_display(
    reminder: dict | None
) -> tuple[str, str]:

    if reminder is None or not reminder["enabled"]:
        return (
            f"{ERROR_EMOJIS['error']} Disabled",
            "\u200b"
        )

    config = reminder.get("config") or {}

    status = (
        f"{ERROR_EMOJIS['success']} Enabled"
    )

    if reminder["reminder_type"] == "resin":
        amount = config.get("amount")

        if amount is not None:
            return (
                status,
                f"{HOYOLAB_EMOJIS['original_resin']} "
                f"**{amount} Resin**"
            )

    elif reminder["reminder_type"] == "custom":
        message = config.get("message")

        if message:
            return status, f'"{message}"'

    return status, "\u200b"


def build_reminders_embed(
    account: dict,
    reminders: list[dict]
) -> discord.Embed:

    embed = discord.Embed(
        title="Reminders",
        description=(
            "Manage your reminders for the selected account."
        ) + "\n\u200b",
        colour=discord.Colour.gold()
    )

    embed.add_field(
        name=f"{HOYOLAB_EMOJIS['account']} Account",
        value=format_account_info(account) + "\n\u200b",
        inline=False
    )

    sections = [
        ("resin", "Resin"),
        ("expedition", "Expeditions"),
        ("teapot", "Serenitea Pot"),
        ("transformer", "Parametric Transformer"),
        ("custom", "Custom"),
    ]

    for reminder_type, name in sections:

        manual = next(
            (
                reminder
                for reminder in reminders
                if reminder["reminder_type"] == reminder_type
                and reminder["reminder_mode"] == "manual"
            ),
            None
        )

        automatic = next(
            (
                reminder
                for reminder in reminders
                if reminder["reminder_type"] == reminder_type
                and reminder["reminder_mode"] == "automatic"
            ),
            None
        )

        manual_status, manual_details = get_reminder_display(
            manual
        )

        automatic_status, automatic_details = get_reminder_display(
            automatic
        )

        emoji = get_reminder_emoji(
            reminder_type
        )

        embed.add_field(
            name=f"{emoji} {name}",
            value=(
                "⦁\u2002**Manual Reminder**\n"
                "⦁\u2002**Automatic Reminder**"
            ) + "\n\u200b",
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
                f"{manual_details}\n"
                f"{automatic_details}"
            ),
            inline=True
        )

    return embed


class ReminderCategoryButton(
    discord.ui.Button
):

    def __init__(
        self,
        discord_user_id: int,
        accounts: list[dict],
        selected_account: dict,
        reminder_type: str
    ):
        self.discord_user_id = discord_user_id
        self.accounts = accounts
        self.selected_account = selected_account
        self.reminder_type = reminder_type

        super().__init__(
            label=REMINDER_NAMES[reminder_type],
            emoji=REMINDER_EMOJIS[reminder_type],
            style=discord.ButtonStyle.secondary
        )

    async def callback(
            self,
            interaction: discord.Interaction
    ):
        if self.reminder_type != "resin":
            await interaction.response.send_message(
                embed=create_error_embed(
                    "Not Implemented",
                    (
                        f"The **{REMINDER_NAMES[self.reminder_type]}** "
                        "reminder controls haven't been added yet."
                    ),
                    "error"
                ),
                ephemeral=interaction.guild is not None
            )
            return

        from cogs.daily.resin.commands import (
            _get_resin_message,
            ResinAccountView,
        )

        await interaction.response.defer()

        try:
            reminders = await get_reminders(
                self.discord_user_id
            )

            view = ResinAccountView(
                self.discord_user_id,
                self.accounts,
                self.selected_account["genshin_uid"],
                reminders,
                selected_account=self.selected_account,
                show_back=True
            )

            embed, file = await _get_resin_message(
                self.discord_user_id,
                self.selected_account
            )

            await interaction.edit_original_response(
                embed=embed,
                attachments=[
                    file
                ] if file is not None else [],
                view=view
            )

        except Exception:
            import traceback
            traceback.print_exc()

            await interaction.edit_original_response(
                embed=create_error_embed(
                    "Failed to Open Resin",
                    "Cyrene couldn't open the Resin panel.",
                    "error"
                ),
                attachments=[],
                view=None
            )


class RemindersAccountSelect(discord.ui.Select):

    def __init__(
        self,
        discord_user_id: int,
        accounts: list[dict],
        view: "RemindersView"
    ):
        super().__init__(
            placeholder="Select a Genshin Account...",
            options=[
                discord.SelectOption(
                    label=(
                        account.get("cyrene_nickname")
                        or account.get("nickname")
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
                for account in accounts
            ]
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
            await interaction.edit_original_response(
                embed=create_error_embed(
                    "Account Not Found",
                    "The selected Genshin account could not be found.",
                    "not_found"
                ),
                view=self.account_view
            )
            return

        reminders = await get_reminders(
            self.discord_user_id
        )

        account_reminders = [
            reminder
            for reminder in reminders
            if reminder["genshin_uid"]
            == genshin_uid
        ]

        embed = build_reminders_embed(
            account,
            account_reminders
        )

        self.account_view.selected_account = account

        new_view = RemindersView(
            self.discord_user_id,
            accounts,
            account
        )

        await interaction.edit_original_response(
            embed=embed,
            attachments=[],
            view=new_view
        )


class RemindersView(discord.ui.View):

    def __init__(
        self,
        discord_user_id: int,
        accounts: list[dict],
        selected_account: dict
    ):
        super().__init__(
            timeout=300
        )

        self.discord_user_id = discord_user_id
        self.accounts = accounts
        self.selected_account = selected_account

        if len(accounts) > 1:
            self.add_item(
                RemindersAccountSelect(
                    discord_user_id,
                    accounts,
                    self
                )
            )

        for reminder_type in (
            "resin",
            "expedition",
            "teapot",
            "transformer",
            "custom",
        ):
            self.add_item(
                ReminderCategoryButton(
                    discord_user_id,
                    accounts,
                    selected_account,
                    reminder_type
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


class Reminders(commands.Cog):

    def __init__(
        self,
        bot: commands.Bot
    ):
        self.bot = bot

    @app_commands.command(
        name="reminders",
        description="Manage your reminders."
    )
    @app_commands.allowed_contexts(
        guilds=True,
        dms=True
    )
    async def reminders(
        self,
        interaction: discord.Interaction
    ):
        accounts = await get_accounts(
            interaction.user.id
        )

        if not accounts:
            await interaction.response.send_message(
                embed=create_error_embed(
                    "No Accounts Linked",
                    "You don't have any HoYoLAB accounts linked.",
                    "not_found"
                ),
                ephemeral=interaction.guild is not None
            )
            return

        selected_account = accounts[0]

        reminders = await get_reminders(
            interaction.user.id
        )

        account_reminders = [
            reminder
            for reminder in reminders
            if reminder["genshin_uid"]
            == selected_account["genshin_uid"]
        ]

        embed = build_reminders_embed(
            selected_account,
            account_reminders
        )

        view = RemindersView(
            interaction.user.id,
            accounts,
            selected_account
        )

        await interaction.response.send_message(
            embed=embed,
            view=view,
            ephemeral=interaction.guild is not None
        )

    @commands.command(
        name="reminders"
    )
    async def reminders_prefix(
        self,
        ctx: commands.Context
    ):
        accounts = await get_accounts(
            ctx.author.id
        )

        if not accounts:
            await send_context_error(
                ctx,
                "No Accounts Linked",
                "You don't have any HoYoLAB accounts linked.",
                "not_found"
            )
            return

        selected_account = accounts[0]

        reminders = await get_reminders(
            ctx.author.id
        )

        account_reminders = [
            reminder
            for reminder in reminders
            if reminder["genshin_uid"]
            == selected_account["genshin_uid"]
        ]

        embed = build_reminders_embed(
            selected_account,
            account_reminders
        )

        view = RemindersView(
            ctx.author.id,
            accounts,
            selected_account
        )

        await ctx.send(
            embed=embed,
            view=view
        )


async def setup(
    bot: commands.Bot
):
    await bot.add_cog(
        Reminders(bot)
    )