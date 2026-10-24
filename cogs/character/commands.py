import discord
from discord.ext import commands
from discord import app_commands
from utils.icons import get_character_icon, get_character_splash
from utils.character.characters import get_character
from utils.character.character_autocomplete import character_autocomplete
from utils.constants.emojis import ELEMENT_EMOJIS, WEAPON_EMOJIS
from utils.errors.error_handler import send_interaction_error, send_not_found


class Character(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_character(
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
                    "Character Not Found",
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

        embed = discord.Embed(
            title=data["name"],
            description=data["description"] + "\n\u200b",
            colour=discord.Colour.from_str(data["colour"])
        )

        embed.add_field(
            name="Title",
            value=data["title"] + "\n\u200b"
        )

        embed.add_field(
            name="Affiliation",
            value=data["affiliation"]
        )

        embed.add_field(
            name="Constellation",
            value=data["constellation"]
        )

        embed.add_field(
            name="Rarity",
            value="★" * data["rarity"] + "\n\u200b"
        )

        embed.add_field(
            name="Element",
            value=f"{ELEMENT_EMOJIS[data['element']]} {data['element'].title()}"
        )

        embed.add_field(
            name="Weapon",
            value=f"{WEAPON_EMOJIS[data['weapon']]} {data['weapon'].title()}"
        )

        embed.add_field(
            name="Version",
            value=data["version"]
        )

        embed.add_field(
            name="Release",
            value=data["release"]
        )

        embed.add_field(
            name="Birthday",
            value=data["birthday"]
        )

        icon_path = get_character_icon(data["id"])
        splash_path = get_character_splash(data["id"])

        files = []

        if icon_path.exists():
            files.append(discord.File(icon_path, filename="icon.webp"))
            embed.set_thumbnail(url="attachment://icon.webp")

        if splash_path.exists():
            files.append(discord.File(splash_path, filename="splash.png"))
            embed.set_image(url="attachment://splash.png")

        await destination.send(
            embed=embed,
            files=files
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
        name="character",
        description="Shows character information."
    )
    @app_commands.autocomplete(character=character_autocomplete)
    async def character(
        self,
        interaction: discord.Interaction,
        character: str
    ):
        await interaction.response.defer()

        await self._send_character(
            interaction.followup,
            character,
            interaction=interaction
        )

    @commands.command(
        name="character",
        aliases=["char", "c"]
    )
    async def character_prefix(
            self,
            ctx: commands.Context,
            *,
            character: str
    ):
        await self._send_character(
            ctx,
            character,
            ctx=ctx
        )

async def setup(bot):
    await bot.add_cog(Character(bot))