import discord
from discord import app_commands
from discord.ext import commands

from bot.utils.characters.characters import character_autocomplete, get_character
from bot.utils.errors.error_handler import lookup_entity
from bot.utils.icons import get_character_icon, get_talent_emoji
from bot.utils.talents.talents_format import format_description, format_sections


class Skills(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_skills(
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

        thumbnail = discord.File(get_character_icon(data["id"]), filename="character.png")
        emojis = self.bot.emojis
        embed = discord.Embed(
            title=f"Talents • {data['name']}", colour=discord.Colour.from_str(data["colour"])
        )

        embed.set_thumbnail(url="attachment://character.png")

        talents = data["talents"]
        normal = talents["normal_attack"]

        embed.add_field(
            name=(
                f"{get_talent_emoji(emojis, data['id'], 'normal')} Normal Attack • {normal['name']}"
            ),
            value=format_description(normal["description"]) + "\n\u200b",
            inline=False,
        )

        skill = talents["elemental_skill"]
        skill_text = format_description(skill["description"])

        if "sections" in skill:
            skill_text += "\n\n" + format_sections(skill["sections"])

        embed.add_field(
            name=(
                f"{get_talent_emoji(emojis, data['id'], 'skill')} Elemental Skill • {skill['name']}"
            ),
            value=skill_text + "\n\u200b",
            inline=False,
        )

        burst = talents["elemental_burst"]
        burst_text = format_description(burst["description"])

        if "sections" in burst:
            burst_text += "\n\n" + format_sections(burst["sections"])

        embed.add_field(
            name=(
                f"{get_talent_emoji(emojis, data['id'], 'burst')} Elemental Burst • {burst['name']}"
            ),
            value=burst_text,
            inline=False,
        )

        await destination.send(embed=embed, file=thumbnail)

    @app_commands.allowed_installs(users=True, guilds=True)
    @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
    @app_commands.command(
        name="talents", description="Shows a character's Normal, Skill and Burst talents."
    )
    @app_commands.autocomplete(character=character_autocomplete)
    async def skills_slash(self, interaction: discord.Interaction, character: str):
        await interaction.response.defer()

        await self._send_skills(interaction.followup, character, interaction=interaction)

    @commands.command(name="talents", aliases=["skill", "skills", "t", "talent"])
    async def skills(self, ctx: commands.Context, *, character: str):
        await self._send_skills(ctx, character, ctx=ctx)


async def setup(bot):
    await bot.add_cog(Skills(bot))
