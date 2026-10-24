import discord
import time
from discord import app_commands
from discord.ext import commands
from utils.hoyolab.account_client import get_account_client
from utils.hoyolab.database import get_accounts
from utils.hoyolab.daily_note import get_expeditions
from utils.errors.error_handler import create_error_embed
from utils.hoyolab.expedition_icons import EXPEDITION_ICONS


async def _get_expeditions_message(
        bot,
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

            return embed

        async with client:
            response = await client.get_genshin_daily_note(
                client.genshin_uid,
                client.genshin_server
            )

        expeditions = get_expeditions(
            response
        )

    except Exception as e:

        embed = create_error_embed(
            "Failed to Retrieve Expeditions",
            f"Cyrene couldn't retrieve your Expedition data from HoYoLAB.\n\n"
            f"Error: `{type(e).__name__}: {e}`",
            "error"
        )

        return embed

    finished = sum(
        expedition.get("status") == "Finished"
        for expedition in expeditions
    )

    ongoing = sum(
        expedition.get("status") == "Ongoing"
        for expedition in expeditions
    )

    expedition_lines = []

    for expedition in expeditions:
        status = expedition.get(
            "status",
            "Unknown"
        )

        icon_url = expedition.get(
            "avatar_side_icon",
            ""
        )

        icon_hash = (
            icon_url
            .rstrip("/")
            .split("/")[-1]
            .removesuffix(".png")
        )

        character_name = EXPEDITION_ICONS.get(
            icon_hash
        )

        emoji = None

        if character_name:
            normalized_name = (
                character_name
                .lower()
                .replace(" ", "_")
            )

            for server_emoji in bot.emojis:
                emoji_name = (
                    server_emoji.name
                    .lower()
                    .replace(" ", "_")
                )

                if emoji_name == normalized_name:
                    emoji = server_emoji
                    break

        character_display = (
            str(emoji)
            if emoji
            else character_name or "Unknown"
        )

        if status == "Finished":
            expedition_lines.append(
                f"{character_display} Finished"
            )

        elif status == "Ongoing":
            expedition_timestamp = (
                int(time.time())
                + int(expedition.get("remained_time", 0))
            )

            remaining_time = (
                f"<t:{expedition_timestamp}:R>"
            )

            expedition_lines.append(
                f"{character_display} Finishes {remaining_time}"
            )

        else:
            expedition_lines.append(
                f"{character_display} {status}"
            )

    if not expedition_lines:
        expedition_lines.append(
            "No expedition data available."
        )

    embed = discord.Embed(
        title="Expeditions",
        colour=discord.Colour.blurple()
    )

    embed.add_field(
        name="Account",
        value=(
            f"- **Name:** {account.get('nickname', 'Unknown')}\n"
            f"- **UID:** {account['genshin_uid']}\n"
            f"- **AR:** {account.get('level', 'Unknown')}"
        ) + "\n\u200b",
        inline=False
    )

    embed.add_field(
        name="Expeditions",
        value=(
            f"- **Finished:** {finished}/{len(expeditions)}\n"
            f"- **Ongoing:** {ongoing}/{len(expeditions)}\n\n"
            + "\n".join(expedition_lines)
        ),
        inline=False
    )

    return embed


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


class ExpeditionsAccountSelect(discord.ui.Select):
    def __init__(
            self,
            bot,
            discord_user_id: int,
            options: list[discord.SelectOption],
            view: "ExpeditionsAccountView"
    ):
        super().__init__(
            placeholder="Select a Genshin Account...",
            options=options
        )

        self.bot = bot
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
                view=self.account_view
            )

            return

        embed = await _get_expeditions_message(
            self.bot,
            self.discord_user_id,
            account
        )

        await interaction.edit_original_response(
            embed=embed,
            view=self.account_view
        )


class ExpeditionsAccountView(discord.ui.View):
    def __init__(
            self,
            bot,
            discord_user_id: int,
            options: list[discord.SelectOption]
    ):
        super().__init__(
            timeout=600
        )

        self.add_item(
            ExpeditionsAccountSelect(
                bot,
                discord_user_id,
                options,
                self
            )
        )


class Expeditions(commands.Cog):
    def __init__(
            self,
            bot
    ):
        self.bot = bot

    async def _show_expeditions(
            self,
            user_id: int,
            accounts: list[dict],
            *,
            interaction: discord.Interaction | None = None,
            ctx: commands.Context | None = None,
            ephemeral: bool = True
    ):
        view = None

        if len(accounts) > 1:
            view = ExpeditionsAccountView(
                self.bot,
                user_id,
                create_account_options(accounts)
            )

        account = accounts[0]

        embed = await _get_expeditions_message(
            self.bot,
            user_id,
            account
        )

        if interaction:
            await interaction.followup.send(
                embed=embed,
                view=view,
                ephemeral=ephemeral
            )
        else:
            await ctx.send(
                embed=embed,
                view=view
            )

    @app_commands.command(
        name="expeditions",
        description="Check your Genshin Expeditions."
    )
    async def expeditions(
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
                ephemeral=True
            )

            return

        account = accounts[0]

        view = None

        if len(accounts) > 1:
            view = ExpeditionsAccountView(
                self.bot,
                interaction.user.id,
                create_account_options(accounts)
            )

        embed = await _get_expeditions_message(
            self.bot,
            interaction.user.id,
            account
        )

        await interaction.response.send_message(
            embed=embed,
            view=view,
            ephemeral=True
        )

    @commands.command(
        name="expeditions"
    )
    async def expeditions_prefix(
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

        await self._show_expeditions(
            ctx.author.id,
            accounts,
            ctx=ctx,
            ephemeral=False
        )


async def setup(bot):
    await bot.add_cog(Expeditions(bot))