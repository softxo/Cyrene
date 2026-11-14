import discord
from discord import app_commands
from discord.ext import commands

from bot.utils.characters.characters import character_autocomplete, get_character
from bot.utils.errors.error_handler import lookup_entity
from bot.utils.icons import get_character_icon, get_constellation_emoji


class Constellations(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_constellations(
        self,
        destination,
        character: str,
        *,
        interaction: discord.Interaction | None = None,
        ctx: commands.Context | None = None,
    ):
        data = await lookup_entity(
            get_character, character, "Character", interaction=interaction, ctx=ctx
        )

        if data is None:
            return

        emojis = self.bot.emojis
        embed = discord.Embed(
            title=f"Constellations • {data['name']}", colour=discord.Colour.from_str(data["colour"])
        )

        for i, constellation in enumerate(data["constellations"], start=1):
            emoji = get_constellation_emoji(emojis, data["id"], i)
            emoji_text = str(emoji) if emoji else "⭐"
            description = constellation["description"]

            if isinstance(description, list):
                description = "\n".join(description)

            embed.add_field(
                name=f"{emoji_text} C{i} • **{constellation['name']}**",
                value=description + "\n\u200b",
                inline=False,
            )

        icon_path = get_character_icon(data["id"])

        if icon_path.exists():
            file = discord.File(icon_path, filename="character.png")

            embed.set_thumbnail(url="attachment://character.png")

            await destination.send(embed=embed, file=file)
        else:
            await destination.send(embed=embed)

    @app_commands.allowed_installs(users=True, guilds=True)
    @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
    @app_commands.command(name="constellations", description="Shows a character's constellations.")
    @app_commands.autocomplete(character=character_autocomplete)
    async def constellations(self, interaction: discord.Interaction, character: str):
        await interaction.response.defer()

        await self._send_constellations(interaction.followup, character, interaction=interaction)

    @commands.command(name="constellations", aliases=["cons", "const", "con"])
    async def constellations_prefix(self, ctx: commands.Context, *, character: str):
        await self._send_constellations(ctx, character, ctx=ctx)


async def setup(bot):
    await bot.add_cog(Constellations(bot))
