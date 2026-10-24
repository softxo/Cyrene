import time
import discord
from discord import app_commands
from discord.ext import commands


class Ping(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_ping(self, send_message):
        start = time.perf_counter()

        message = await send_message("🏓 Pinging...")

        response = round((time.perf_counter() - start) * 1000)
        gateway = round(self.bot.latency * 1000)

        processing_start = time.perf_counter()

        embed = discord.Embed(
            title="🏓 Pong!",
            colour=discord.Colour.green()
        )

        embed.add_field(
            name="Gateway",
            value=f"`{gateway} ms`",
            inline=True
        )

        embed.add_field(
            name="API Response",
            value=f"`{response} ms`",
            inline=True
        )

        processing = (time.perf_counter() - processing_start) * 1000

        embed.add_field(
            name="Processing",
            value=f"`{processing:.3f} ms`",
            inline=True
        )

        await message.edit(content=None, embed=embed)

    @commands.command(name="ping")
    async def ping_prefix(self, ctx):
        await self._send_ping(ctx.send)

    @app_commands.command(
        name="ping",
        description="Shows the bot's latency."
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
    async def ping_slash(self, interaction: discord.Interaction):
        async def send(content):
            await interaction.response.send_message(content)
            return await interaction.original_response()

        await self._send_ping(send)


async def setup(bot):
    await bot.add_cog(Ping(bot))