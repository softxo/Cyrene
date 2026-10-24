import discord
from discord import app_commands
from discord.ext import commands

from utils.web.auth import claim_verification


class Verify(commands.Cog):

    def __init__(
        self,
        bot: commands.Bot
    ):
        self.bot = bot


    @app_commands.command(
        name="verify",
        description="Connect your Discord account to Cyrene."
    )
    @app_commands.describe(
        code="The verification code shown on the Cyrene website."
    )
    async def verify(
        self,
        interaction: discord.Interaction,
        code: str,
    ):

        success = claim_verification(
            code=code,
            user_id=interaction.user.id,
        )

        if not success:
            await interaction.response.send_message(
                "That verification code is invalid, expired, "
                "or has already been used.",
                ephemeral=True,
            )
            return

        await interaction.response.send_message(
            "Your Discord account has been successfully connected "
            "to Cyrene.",
            ephemeral=True,
        )


async def setup(
    bot: commands.Bot
):
    await bot.add_cog(
        Verify(bot)
    )