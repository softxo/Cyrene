import discord
import asyncio
from discord.ext import commands
from discord import app_commands
from utils.ai.gemini import generate_response


class AI(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(
        name="ai",
        description="Talk to Cyrene."
    )
    @app_commands.describe(
        prompt="What you'd like to say."
    )
    @app_commands.allowed_installs(
        guilds=True,
        users=True
    )
    @app_commands.allowed_contexts(
        guilds=True,
        dms=True,
        private_channels=True
    )
    async def ai_slash(
            self,
            interaction: discord.Interaction,
            prompt: str
    ):
        await interaction.response.defer(thinking=True)

        response = await asyncio.to_thread(
            generate_response,
            interaction.channel_id,
            prompt
        )

        await interaction.followup.send(response[:2000])

    @commands.command(
        name="ai",
        aliases=["ask"]
    )
    async def ai(self, ctx, *, prompt: str):
        async with ctx.typing():
            response = await asyncio.to_thread(
                generate_response,
                ctx.channel.id,
                prompt,
            )

        await ctx.send(response[:2000])


async def setup(bot):
    await bot.add_cog(AI(bot))