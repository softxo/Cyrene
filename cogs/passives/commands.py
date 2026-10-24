import discord
from discord.ext import commands
from discord import app_commands
from utils.character.characters import get_character
from utils.character.character_autocomplete import character_autocomplete
from utils.icons import get_character_icon, get_talent_emoji
from utils.talents.talents_format import format_description
from utils.errors.error_handler import send_interaction_error, send_not_found

class Passives(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_passives(
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

        thumbnail = discord.File(
            get_character_icon(data["id"]),
            filename="character.png"
        )

        emojis = self.bot.emojis

        embed = discord.Embed(
            title=f"Passives • {data['name']}",
            colour=discord.Colour.from_str(data["colour"])
        )

        embed.set_thumbnail(url="attachment://character.png")

        for passive in data["passives"]:
            unlock = passive["unlock"].lower()

            embed.add_field(
                name=(
                    f"{get_talent_emoji(emojis, data['id'], unlock)} "
                    f"{passive['unlock']} • {passive['name']}"
                ),
                value=format_description(passive["description"]) + "\n\u200b",
                inline=False
            )

        await destination.send(
            embed=embed,
            file=thumbnail
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
        name="passives",
        description="Shows a character's passive talents."
    )
    @app_commands.autocomplete(character=character_autocomplete)
    async def passives_slash(
        self,
        interaction: discord.Interaction,
        character: str
    ):
        await interaction.response.defer()

        await self._send_passives(
            interaction.followup,
            character,
            interaction=interaction
        )

    @commands.command(
        name="passives",
        aliases=["passive", "p"]
    )
    async def passives(
        self,
        ctx: commands.Context,
        *,
        character: str
    ):
        await self._send_passives(
            ctx,
            character,
            ctx=ctx
        )

async def setup(bot):
    await bot.add_cog(Passives(bot))