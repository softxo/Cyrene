from discord import app_commands
from discord.ext import commands

LOVE_MESSAGES = {
    1554226490462183505: "I love you, Everly (Shiori loves you too! Very very much).",
    1557792995179495497: "I love you, Shiori (Everly loves you too! Very very much).",
}


class Love(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="love")
    async def love_prefix(self, ctx):
        message = LOVE_MESSAGES.get(ctx.author.id)
        if message is not None:
            await ctx.send(message)

    @app_commands.command(name="love", description="Sends a loving message.")
    @app_commands.allowed_installs(users=True, guilds=True)
    @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
    async def love_slash(self, interaction):
        message = LOVE_MESSAGES.get(interaction.user.id)
        if message is None:
            await interaction.response.send_message(
                "This command is not available to you.", ephemeral=True
            )
            return
        await interaction.response.send_message(message)


async def setup(bot):
    await bot.add_cog(Love(bot))
