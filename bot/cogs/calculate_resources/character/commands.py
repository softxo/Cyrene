import discord
from discord import app_commands
from discord.ext import commands

from bot.utils.characters.characters import character_autocomplete, get_character
from bot.utils.errors.error_handler import (
    send_interaction_error,
    send_invalid_input,
    send_not_found,
)
from bot.utils.icons import get_character_icon, get_character_splash
from bot.utils.materials.materials import (
    BOSSES,
    COMMON,
    GEMS,
    LOCAL_SPECIALTIES,
    MISC,
    exp_value,
    material_line,
    mora_breakdown,
    resource_embed,
    tier_lines,
)
from shared.constants.emojis import COLOURED_ELEMENT_EMOJIS
from shared.resource_calculator.character_resource_calculator import calculate_character_resources

GEM_TIERS = ("sliver", "fragment", "chunk", "gemstone")
COMMON_TIERS = ("tier1", "tier2", "tier3")
LEVEL_BOOKS = ("heros_wit", "adventurers_experience", "wanderers_advice")


def format_resource_embed(
    character: dict, resources: dict, emojis
) -> tuple[discord.Embed, discord.File, discord.File]:
    ascension = resources["ascension"]
    element_emoji = COLOURED_ELEMENT_EMOJIS.get(character["element"].lower())
    embed = resource_embed(
        f"Resource Calculator • {character['name']}",
        character["colour"],
        "Character",
        f"{element_emoji} **{character['name']}**",
        resources["levels"],
    )

    embed.add_field(
        name="EXP",
        value=exp_value(emojis, resources["exp"], "Character_EXP", "Wasted_Character_EXP"),
        inline=False,
    )

    level_lines = [
        material_line(emojis, MISC[book], amount)
        for book in LEVEL_BOOKS
        if (amount := resources["exp"]["books"].get(book, 0)) > 0
    ]

    embed.add_field(name="Level Materials", value="\n".join(level_lines) + "\n\u200b", inline=False)

    boss = ascension["boss"]
    local = ascension["local_specialty"]
    ascension_sections = [
        tier_lines(
            emojis, GEMS[ascension["gem"]["id"]], ascension["gem"], GEM_TIERS, skip_empty=True
        ),
        material_line(emojis, BOSSES[boss["id"]], boss["amount"]) if boss["amount"] > 0 else "",
        material_line(emojis, LOCAL_SPECIALTIES[local["id"]], local["amount"])
        if local["amount"] > 0
        else "",
        tier_lines(
            emojis,
            COMMON[ascension["common"]["id"]],
            ascension["common"],
            COMMON_TIERS,
            skip_empty=True,
        ),
    ]
    ascension_sections = [section for section in ascension_sections if section]

    if ascension_sections:
        embed.add_field(
            name="Ascension Materials",
            value="\n\n".join(ascension_sections) + "\n\u200b",
            inline=False,
        )

    embed.add_field(name="Mora", value=mora_breakdown(emojis, resources["mora"]), inline=False)

    character_icon = discord.File(get_character_icon(character["id"]), filename="character.png")
    character_splash = discord.File(get_character_splash(character["id"]), filename="splash.png")

    embed.set_thumbnail(url="attachment://character.png")
    embed.set_image(url="attachment://splash.png")

    return embed, character_icon, character_splash


class CharacterResourceCalculator(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(
        name="character-resources", description="Calculate resources needed to level a character."
    )
    @app_commands.autocomplete(name=character_autocomplete)
    async def character_resources(
        self,
        interaction: discord.Interaction,
        name: str,
        starting_level: app_commands.Range[int, 1, 90],
        end_level: app_commands.Range[int, 1, 90],
    ):
        if starting_level >= end_level:
            await send_interaction_error(
                interaction,
                "Invalid Levels",
                ("The **starting level** must be **lower** than the **target level**."),
                "invalid_input",
            )
            return

        character = get_character(name)

        if character is None:
            await send_interaction_error(
                interaction,
                "Character Not Found",
                f"The character `{name}` could not be found.",
                "not_found",
            )
            return

        resources = calculate_character_resources(character, starting_level, end_level)
        embed, character_icon, character_splash = format_resource_embed(
            character, resources, self.bot.application_emojis
        )

        await interaction.response.send_message(
            embed=embed, files=[character_icon, character_splash]
        )

    @commands.command(name="characterresources", aliases=["charresources", "cresources", "cr"])
    async def character_resources_prefix(
        self,
        ctx,
        name: str,
        starting_level: int,
        end_level: int,
    ):
        if not 1 <= starting_level <= 90 or not 1 <= end_level <= 90:
            await send_invalid_input(ctx, "Character levels must be between **1** and **90**.")
            return

        if starting_level >= end_level:
            await send_invalid_input(
                ctx, ("The **starting level** must be **lower** than the **target level**.")
            )
            return

        character = get_character(name)

        if character is None:
            await send_not_found(ctx, f"The character `{name}` could not be found.")
            return

        resources = calculate_character_resources(character, starting_level, end_level)
        embed, character_icon, character_splash = format_resource_embed(
            character, resources, self.bot.application_emojis
        )

        await ctx.send(embed=embed, files=[character_icon, character_splash])


async def setup(bot):
    await bot.add_cog(CharacterResourceCalculator(bot))
