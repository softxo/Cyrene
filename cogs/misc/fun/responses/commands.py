import random
from pathlib import Path

import discord
from discord.ext import commands


class Mention(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

        self.cyrene_gif = (
                Path(__file__).resolve().parents[4]
                / "assets"
                / "fun"
                / "Cyrene.gif"
        )

    @commands.Cog.listener()
    async def on_message(
        self,
        message: discord.Message
    ):
        if message.author.bot:
            return

        if message.guild is None:
            return

        if self.bot.user is None:
            return

        if self.bot.user in message.mentions:

            roll = random.random()

            if roll < 0.001:
                await message.reply(
                    file=discord.File(
                        self.cyrene_mood_gif,
                        filename="Cyrene_mood.gif"
                    )
                )

            elif roll < 0.051:
                await message.reply(
                    file=discord.File(
                        self.cyrene_gif,
                        filename="Cyrene.gif"
                    )
                )

            else:
                await message.reply(
                    "Hello! 👋"
                )


async def setup(bot):
    await bot.add_cog(Mention(bot))