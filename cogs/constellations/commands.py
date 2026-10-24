import discord
from discord.ext import commands
from discord import app_commands
from utils.icons import get_character_icon, get_constellation_emoji
from utils.character.characters import get_character
from utils.character.character_autocomplete import character_autocomplete
from utils.errors.error_handler import send_interaction_error, send_not_found

class Constellations(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_constellations(
            self,
            destination,
            character: str,
            *,
            interaction: discord.Interaction | None = None,
            ctx: commands.Context | None = None
    ):
        original_character = character

        character = character.lower().replace(" ", "_")

        data = get_character(character)

        if data is None:
            if interaction is not None:
                await send_interaction_error(
                    interaction,
                    "Character Not Found.",
                    f"The character `{original_character}` could not be found.",
                    "not_found",
                )
            else:
                assert ctx is not None

                await send_not_found(
                    ctx,
                    f"The character `{original_character}` could not be found.",
                )

            return

        emojis = self.bot.emojis

        embed = discord.Embed(
            title=f"Constellations • {data['name']}",
            colour=discord.Colour.from_str(data["colour"])
        )

        for i, constellation in enumerate(data["constellations"], start=1):
            emoji = get_constellation_emoji(
                emojis,
                data["id"],
                i
            )

            emoji_text = str(emoji) if emoji else "⭐"

            description = constellation["description"]

            if isinstance(description, list):
                description = "\n".join(description)

            embed.add_field(
                name=f"{emoji_text} C{i} • **{constellation['name']}**",
                value=description + "\n\u200b",
                inline=False
            )

        icon_path = get_character_icon(data["id"])

        if icon_path.exists():
            file = discord.File(
                icon_path,
                filename="character.png"
            )

            embed.set_thumbnail(
                url="attachment://character.png"
            )

            await destination.send(
                embed=embed,
                file=file
            )
        else:
            await destination.send(
                embed=embed
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
    @app_commands.command(
        name="constellations",
        description="Shows a character's constellations."
    )
    @app_commands.autocomplete(character=character_autocomplete)
    async def constellations(
            self,
            interaction: discord.Interaction,
            character: str
    ):
        await interaction.response.defer()

        await self._send_constellations(
            interaction.followup,
            character,
            interaction=interaction
        )

    @commands.command(
        name="constellations",
        aliases=["cons", "const", "con"]
    )
    async def constellations_prefix(
            self,
            ctx: commands.Context,
            *,
            character: str
    ):
        await self._send_constellations(
            ctx,
            character,
            ctx=ctx
        )

async def setup(bot):
    await bot.add_cog(Constellations(bot))
