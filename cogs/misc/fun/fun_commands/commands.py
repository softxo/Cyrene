from discord import app_commands
from discord.ext import commands


class Fun(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(
        name="wilted",
        aliases=["fun_commands"]
    )
    async def wilted(self, ctx):
        await ctx.send("🥀")

    @app_commands.command(
        name="wilted",
        description="Wilted Rose."
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
    async def wilted_slash(self, interaction):
        await interaction.response.send_message("🥀")



    @commands.command(
        name="primoge"
    )
    async def primoge(self, ctx):
        await ctx.send("<:Primoge:1534122853576736820>")

    @app_commands.command(
        name="primoge",
        description="Primoge."
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
    async def primoge_slash(self, interaction):
        await interaction.response.send_message("<:Primoge:1534122853576736820>")



async def setup(bot):
    await bot.add_cog(Fun(bot))