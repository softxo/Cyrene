from discord import app_commands
from discord.ext import commands


class Love(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="love")
    async def love_prefix(self, ctx):
        await ctx.send("I love you, Alice (Everly loves you too! Very very much).")

    @app_commands.command(
        name="love",
        description="Sends a loving message."
    )
    @app_commands.allowed_installs(
        users=True,
        guilds=True
    )
    @app_commands.allowed_contexts(
        guilds=True,
        dms=True,
        private_channels=True
    )
    async def love_slash(self, interaction):
        await interaction.response.send_message(
            "I love you, Alice (Everly loves you too! Very very much)."
        )


async def setup(bot):
    await bot.add_cog(Love(bot))