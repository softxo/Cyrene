import discord
from discord.ext import commands
from discord import app_commands
from utils.character.characters import get_character
from utils.character.character_autocomplete import character_autocomplete
from utils.icons import get_character_icon, get_talent_emoji
from utils.talents.talents_format import format_description, format_sections
from utils.errors.error_handler import send_interaction_error, send_not_found

class Skills(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_skills(
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
            title=f"Talents • {data['name']}",
            colour=discord.Colour.from_str(data["colour"])
        )

        embed.set_thumbnail(url="attachment://character.png")

        talents = data["talents"]

        normal = talents["normal_attack"]

        embed.add_field(
            name=(
                f"{get_talent_emoji(emojis, data['id'], 'normal')} "
                f"Normal Attack • {normal['name']}"
            ),
            value=format_description(normal["description"]) + "\n\u200b",
            inline=False
        )

        skill = talents["elemental_skill"]

        skill_text = format_description(skill["description"])

        if "sections" in skill:
            skill_text += "\n\n" + format_sections(skill["sections"])

        embed.add_field(
            name=(
                f"{get_talent_emoji(emojis, data['id'], 'skill')} "
                f"Elemental Skill • {skill['name']}"
            ),
            value=skill_text + "\n\u200b",
            inline=False
        )

        burst = talents["elemental_burst"]

        burst_text = format_description(burst["description"])

        if "sections" in burst:
            burst_text += "\n\n" + format_sections(burst["sections"])

        embed.add_field(
            name=(
                f"{get_talent_emoji(emojis, data['id'], 'burst')} "
                f"Elemental Burst • {burst['name']}"
            ),
            value=burst_text,
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
        name="talents",
        description="Shows a character's Normal, Skill and Burst talents."
    )
    @app_commands.autocomplete(character=character_autocomplete)
    async def skills_slash(
        self,
        interaction: discord.Interaction,
        character: str
    ):
        await interaction.response.defer()

        await self._send_skills(
            interaction.followup,
            character,
            interaction=interaction
        )

    @commands.command(
        name="talents",
        aliases=["skill", "skills", "t", "talent"]
    )
    async def skills(
        self,
        ctx: commands.Context,
        *,
        character: str
    ):
        await self._send_skills(
            ctx,
            character,
            ctx=ctx
        )

async def setup(bot):
    await bot.add_cog(Skills(bot))

