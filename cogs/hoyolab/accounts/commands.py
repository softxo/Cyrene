import discord
from discord import app_commands
from discord.ext import commands
from utils.hoyolab.database import (
    get_accounts,
    delete_account,
    update_account_nickname
)
from cogs.hoyolab.link_account.commands import HoYoLABAccountsView
from utils.constants.emojis import MISC_EMOJIS
from utils.errors.error_handler import send_not_your_command


def get_account_name(account: dict) -> str:
    return (
            account["cyrene_nickname"]
            or account["nickname"]
            or f"UID {account['genshin_uid']}"
    )


def get_active_account_name(account: dict) -> str:
    cyrene_nickname = account["cyrene_nickname"]
    account_nickname = account["nickname"]

    if cyrene_nickname and account_nickname:
        return f"{cyrene_nickname} [{account_nickname}]"

    return (
            cyrene_nickname
            or account_nickname
            or f"UID {account['genshin_uid']}"
    )


def create_accounts_embed(
        accounts: list[dict],
        selected_index: int = 0
) -> discord.Embed:

    embed = discord.Embed(
        title="Accounts Management",
        description=(
                        "Welcome to the Account(s) Management page!\n"
                        "Link a HoYoLAB account to Cyrene.\n"
                        'If you haven\'t done so, or want to add multiple accounts, press "**Add Account**".'
                    ) + "\n\u200b",
        colour=discord.Colour.blurple()
    )

    if accounts:
        account = accounts[selected_index]

        account_name = get_active_account_name(account)
        uid = account["genshin_uid"]
        level = account["level"] or "Unknown"

        active_account = (
            f"**Active Account**: {account_name}\n"
            f"**UID**: {uid}\n"
            f"**AR**: {level}"
        )

    else:
        active_account = (
            "**Active Account**: No Linked Account\n"
            "**UID**: No Linked Account\n"
            "**AR**: No Linked Account"
        )

    embed.add_field(
        name=" ",
        value=active_account + "\n\u200b",
        inline=False
    )

    embed.add_field(
        name="UID",
        value="No Linked Account" if not accounts else "idk for now",
        inline=True
    )

    embed.add_field(
        name="HoYoLAB Account",
        value="No Linked Account" if not accounts else "idk for now",
        inline=True
    )

    embed.add_field(
        name="Wish History",
        value="No Linked Account" if not accounts else "idk for now",
        inline=True
    )

    return embed


class AccountSelect(discord.ui.Select):
    def __init__(
            self,
            view: "AccountsView",
            accounts: list[dict]
    ):
        self.accounts_view = view

        options = []

        for index, account in enumerate(accounts):
            name = get_active_account_name(account)

            options.append(
                discord.SelectOption(
                    label=name[:100],
                    description=(
                        f"UID: {account['genshin_uid']}"
                    )[:100],
                    value=str(index),
                    default=index == view.selected_index
                )
            )

        super().__init__(
            placeholder="Select an account...",
            min_values=1,
            max_values=1,
            options=options
        )

    async def callback(
            self,
            interaction: discord.Interaction
    ):
        selected_index = int(self.values[0])

        self.accounts_view.selected_index = selected_index

        embed = create_accounts_embed(
            self.accounts_view.accounts,
            self.accounts_view.selected_index
        )

        self.accounts_view.rebuild_components()

        await interaction.response.edit_message(
            embed=embed,
            view=self.accounts_view
        )


class AccountsView(discord.ui.View):
    def __init__(
            self,
            user_id: int,
            accounts: list[dict],
            selected_index: int = 0
    ):
        super().__init__(timeout=300)

        self.user_id = user_id
        self.accounts = accounts
        self.selected_index = selected_index

        self.rebuild_components()

    def rebuild_components(self):
        self.clear_items()

        if self.accounts:
            self.select = AccountSelect(
                self,
                self.accounts
            )

            self.add_item(self.select)

        self.add_item(self.add_account)

        self.remove_account.disabled = not self.accounts
        self.edit_nickname.disabled = not self.accounts

        self.add_item(self.remove_account)
        self.add_item(self.edit_nickname)

    async def interaction_check(
            self,
            interaction: discord.Interaction
    ) -> bool:
        if interaction.user.id != self.user_id:
            await send_not_your_command(interaction)
            return False

        return True

    async def refresh(
            self,
            interaction: discord.Interaction
    ):
        self.accounts = await get_accounts(
            self.user_id
        )

        if self.accounts and self.selected_index >= len(self.accounts):
            self.selected_index = 0

        self.rebuild_components()

        embed = create_accounts_embed(
            self.accounts,
            self.selected_index
        )

        await interaction.response.edit_message(
            embed=embed,
            view=self
        )

    @discord.ui.button(
        label="Add Account",
        emoji=f"{MISC_EMOJIS['add']}",
        style=discord.ButtonStyle.secondary
    )
    async def add_account(
            self,
            interaction: discord.Interaction,
            button: discord.ui.Button
    ):
        embed = discord.Embed(
            title="<:Link:1535081027108741201> Link HoYoLAB Account(s)",
            description=(
                "Welcome to the **HoYoLAB Account Linking** page!\n"
                "Linking your HoYoLAB account to Cyrene will enable you to view certain information about your Genshin account.\n\n"
                "**__Features__**\n"
                "- **Check your in-game Resin count in real-time** (Current Resin, Replenished in ..., Fully replenished in ..., Automatic Notifier)\n"
                "- **Check your in-game Expedition progress in real-time** (Characters on Expeditions, Time left for each character, Resources)\n"
                '- **Claim your "Daily Check-in" rewards** (Manually or Automatically)\n'
                '- **View information about your "Spiral Abyss" progression**\n'
                "*And more*\n\n"
                "To start linking, click on one of the options below."
            ),
            colour=discord.Colour.blurple()
        )

        embed.set_footer(
            text="Your HoYoLAB password is never stored by Cyrene."
        )

        await interaction.response.send_message(
            embed=embed,
            view=HoYoLABAccountsView(),
            ephemeral=True
        )

    @discord.ui.button(
        label="Remove Account",
        emoji=f"{MISC_EMOJIS['remove']}",
        style=discord.ButtonStyle.secondary
    )
    async def remove_account(
            self,
            interaction: discord.Interaction,
            button: discord.ui.Button
    ):
        if not self.accounts:
            await interaction.response.send_message(
                "There are no linked accounts to remove.",
                ephemeral=True
            )
            return

        account = self.accounts[self.selected_index]

        deleted = await delete_account(
            interaction.user.id,
            account["genshin_uid"]
        )

        if not deleted:
            await interaction.response.send_message(
                "I couldn't remove that account.",
                ephemeral=True
            )
            return

        self.accounts = await get_accounts(
            interaction.user.id
        )

        if self.accounts:
            self.selected_index = min(
                self.selected_index,
                len(self.accounts) - 1
            )

        self.rebuild_components()

        embed = create_accounts_embed(
            self.accounts,
            self.selected_index
        )

        await interaction.response.edit_message(
            embed=embed,
            view=self
        )

    @discord.ui.button(
        label="Edit Nickname",
        emoji=f"{MISC_EMOJIS['rename']}",
        style=discord.ButtonStyle.secondary
    )
    async def edit_nickname(
            self,
            interaction: discord.Interaction,
            button: discord.ui.Button
    ):
        if not self.accounts:
            await interaction.response.send_message(
                "There are no linked accounts to edit.",
                ephemeral=True
            )
            return

        account = self.accounts[self.selected_index]

        await interaction.response.send_modal(
            EditNicknameModal(
                self,
                account
            )
        )


class EditNicknameModal(discord.ui.Modal):
    def __init__(
            self,
            accounts_view: AccountsView,
            account: dict
    ):
        super().__init__(
            title="Edit Account Nickname"
        )

        self.accounts_view = accounts_view
        self.account = account

        self.nickname = discord.ui.TextInput(
            label="Cyrene Nickname",
            placeholder=(
                "Enter a nickname for this account..."
            ),
            default=account["cyrene_nickname"] or "",
            required=False,
            max_length=32
        )

        self.add_item(self.nickname)

    async def on_submit(
            self,
            interaction: discord.Interaction
    ):
        nickname = self.nickname.value.strip()

        updated = await update_account_nickname(
            interaction.user.id,
            self.account["genshin_uid"],
            nickname or None
        )

        if not updated:
            await interaction.response.send_message(
                "I couldn't update the account nickname.",
                ephemeral=True
            )
            return

        self.accounts_view.accounts = await get_accounts(
            interaction.user.id
        )

        for index, account in enumerate(
                self.accounts_view.accounts
        ):
            if account["genshin_uid"] == self.account["genshin_uid"]:
                self.accounts_view.selected_index = index
                break

        self.accounts_view.rebuild_components()

        embed = create_accounts_embed(
            self.accounts_view.accounts,
            self.accounts_view.selected_index
        )

        await interaction.response.edit_message(
            embed=embed,
            view=self.accounts_view
        )


class Accounts(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(
        name="accounts",
        description="Manage your linked Genshin accounts."
    )
    async def accounts_slash(
            self,
            interaction: discord.Interaction
    ):
        accounts = await get_accounts(
            interaction.user.id
        )

        view = AccountsView(
            interaction.user.id,
            accounts,
            selected_index=0
        )

        embed = create_accounts_embed(
            accounts,
            selected_index=0
        )

        await interaction.response.send_message(
            embed=embed,
            view=view,
            ephemeral=True
        )


async def setup(bot):
    await bot.add_cog(Accounts(bot))