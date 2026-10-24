import discord
from discord.ext import commands
from discord import app_commands

from utils.settings.prefix import get_prefix, set_prefix
from utils.errors.error_handler import (
    send_interaction_error,
    send_context_error,
)


class Prefix(commands.Cog):

    def __init__(self, bot):
        self.bot = bot

    async def _send_prefix(
            self,
            destination: discord.Interaction | commands.Context,
            new_prefix: str,
            *,
            interaction: discord.Interaction | None = None,
            ctx: commands.Context | None = None
    ):
        """Validates, updates, and sends the prefix response."""

        guild_id = (
            interaction.guild.id
            if interaction is not None
            else ctx.guild.id
        )

        old_prefix = get_prefix(guild_id)

        if not 1 <= len(new_prefix) <= 5:
            description = (
                "The prefix must be between **1** and **5** characters."
            )

            if interaction is not None:
                await send_interaction_error(
                    interaction,
                    "Invalid Prefix",
                    description,
                    "invalid_input",
                )
            else:
                await send_context_error(
                    ctx,
                    "Invalid Prefix",
                    description,
                    "invalid_input",
                )

            return

        if " " in new_prefix:
            description = (
                "The prefix cannot contain spaces."
            )

            if interaction is not None:
                await send_interaction_error(
                    interaction,
                    "Invalid Prefix",
                    description,
                    "invalid_input",
                )
            else:
                await send_context_error(
                    ctx,
                    "Invalid Prefix",
                    description,
                    "invalid_input",
                )

            return

        if new_prefix == old_prefix:
            description = (
                f"The prefix is already `{new_prefix}`."
            )

            if interaction is not None:
                await send_interaction_error(
                    interaction,
                    "Prefix Unchanged",
                    description,
                    "invalid_input",
                )
            else:
                await send_context_error(
                    ctx,
                    "Prefix Unchanged",
                    description,
                    "invalid_input",
                )

            return

        set_prefix(guild_id, new_prefix)

        embed = discord.Embed(
            title="<:Success:1534168168027783278> Prefix Updated",
            description=(
                f"**`{old_prefix}`** \u200b → \u200b **`{new_prefix}`**"
            ),
            colour=discord.Colour.from_str("0x34E100")
        )

        if interaction is not None:
            await interaction.response.send_message(
                embed=embed
            )
        else:
            await ctx.send(
                embed=embed
            )

    @app_commands.command(
        name="prefix",
        description="Changes the bot's prefix."
    )
    @app_commands.describe(
        new_prefix="The new prefix to use."
    )
    @app_commands.checks.has_permissions(
        administrator=True
    )
    @app_commands.allowed_installs(
        users=True,
        guilds=True
    )
    @app_commands.allowed_contexts(
        guilds=True
    )
    async def prefix_slash(
            self,
            interaction: discord.Interaction,
            new_prefix: str
    ):
        await self._send_prefix(
            interaction,
            new_prefix,
            interaction=interaction
        )

    @commands.command(
        name="prefix",
        aliases=["setprefix"]
    )
    @commands.guild_only()
    @commands.has_permissions(
        administrator=True
    )
    async def prefix(
            self,
            ctx: commands.Context,
            new_prefix: str
    ):
        await self._send_prefix(
            ctx,
            new_prefix,
            ctx=ctx
        )


async def setup(bot):
    await bot.add_cog(Prefix(bot))