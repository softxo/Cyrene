import discord
from discord import app_commands
from discord.ext import commands
from utils.errors.error_handler import (
    send_interaction_error,
    send_context_error,
)


class Utility(commands.Cog):

    def __init__(self, bot):
        self.bot = bot

    @commands.hybrid_command(
        name="purge",
        description="Deletes a number of messages."
    )
    @commands.has_permissions(
        manage_messages=True
    )
    @app_commands.checks.has_permissions(
        manage_messages=True
    )
    @commands.bot_has_permissions(
        manage_messages=True
    )
    async def purge(
            self,
            ctx: commands.Context,
            amount: int
    ):
        if not 1 <= amount <= 100:
            description = (
                "The amount must be between **1** and **100**."
            )

            if ctx.interaction is not None:
                await send_interaction_error(
                    ctx.interaction,
                    "Invalid Amount",
                    description,
                    "invalid_input",
                )
            else:
                await send_context_error(
                    ctx,
                    "Invalid Amount",
                    description,
                    "invalid_input",
                )

            return

        embed = discord.Embed(
            description=f"Deleting **{amount}** message(s)...",
            colour=discord.Colour.orange()
        )

        status = await ctx.send(embed=embed)

        if ctx.interaction is None:
            await ctx.message.delete()

        deleted = await ctx.channel.purge(
            limit=amount,
            before=status
        )

        embed = discord.Embed(
            title="<:Success:1534168168027783278> Success",
            description=f"Deleted **{len(deleted)}** message(s).",
            colour=discord.Colour.from_str("0x34e100")
        )

        await status.edit(embed=embed)
        await status.delete(delay=5)


async def setup(bot):
    await bot.add_cog(Utility(bot))