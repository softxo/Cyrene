import discord
from discord.ext import commands
from discord import app_commands
from utils.character.characters import get_character
from utils.resource_calculator.character_resource_calculator import calculate_character_resources
from utils.character.character_autocomplete import character_autocomplete
from utils.icons import get_material_emoji, get_character_icon, get_character_splash
from utils.materials.materials import GEMS, BOSSES, LOCAL_SPECIALTIES, COMMON, MISC
from utils.constants.emojis import COLOURED_ELEMENT_EMOJIS
from utils.errors.error_handler import send_interaction_error, send_invalid_input, send_not_found


def format_resource_embed(
        character: dict,
        resources: dict,
        emojis
) -> tuple[discord.Embed, discord.File, discord.File]:

    levels = resources["levels"]
    exp = resources["exp"]
    books = exp["books"]
    ascension = resources["ascension"]
    mora = resources["mora"]

    mora_data = MISC["mora"]

    exp_emoji = get_material_emoji(
        emojis,
        "Character_EXP"
    )

    wasted_exp_emoji = get_material_emoji(
        emojis,
        "Wasted_Character_EXP"
    )

    element_emoji = COLOURED_ELEMENT_EMOJIS.get(
        character["element"].lower()
    )

    embed = discord.Embed(
        title=f"Resource Calculator • {character['name']}",
        colour=discord.Colour.from_str(character["colour"])
    )

    embed.add_field(
        name="Character",
        value=f"{element_emoji} **{character['name']}**",
        inline=True
    )

    embed.add_field(
        name="Starting Level",
        value=str(levels["starting"]),
        inline=True
    )

    embed.add_field(
        name="Target Level",
        value=str(levels["ending"]),
        inline=True
    )

    embed.add_field(
        name=" ",
        value=" ",
        inline=False
    )
    embed.add_field(
        name="EXP",
        value=(
            f"{exp_emoji} **Required:** {exp['required']:,}\n"
            f"{wasted_exp_emoji} **Wasted:** {exp['wasted']:,}"
        ) + "\n\u200b",
        inline=False
    )

    level_lines = []

    for book_id in (
            "heros_wit",
            "adventurers_experience",
            "wanderers_advice"
    ):
        amount = books.get(book_id, 0)

        if amount <= 0:
            continue

        book = MISC[book_id]

        emoji = get_material_emoji(
            emojis,
            book["emoji"]
        )

        level_lines.append(
            f"{emoji} **{book['name']}** ×{amount}"
        )

    embed.add_field(
        name="Level Materials",
        value="\n".join(level_lines)+ "\n\u200b",
        inline=False
    )

    ascension_sections = []

    gem_lines = []
    gem_id = ascension["gem"]["id"]
    gem = GEMS[gem_id]

    for tier in (
        "sliver",
        "fragment",
        "chunk",
        "gemstone"
    ):
        amount = ascension["gem"].get(tier, 0)

        if amount <= 0:
            continue

        emoji = get_material_emoji(
            emojis,
            gem["tiers"][tier]["emoji"]
        )

        gem_lines.append(
            f"{emoji} **{gem['tiers'][tier]['name']}** ×{amount}"
        )

    if gem_lines:
        ascension_sections.append(
            "\n".join(gem_lines)
        )


    boss_id = ascension["boss"]["id"]
    boss = BOSSES[boss_id]

    boss_amount = ascension["boss"]["amount"]

    if boss_amount > 0:
        boss_emoji = get_material_emoji(
            emojis,
            boss["emoji"]
        )

        ascension_sections.append(
            f"{boss_emoji} **{boss['name']}** ×{boss_amount}"
        )


    local_id = ascension["local_specialty"]["id"]
    local = LOCAL_SPECIALTIES[local_id]

    local_amount = ascension["local_specialty"]["amount"]

    if local_amount > 0:
        local_emoji = get_material_emoji(
            emojis,
            local["emoji"]
        )

        ascension_sections.append(
            f"{local_emoji} **{local['name']}** ×{local_amount}"
        )

    common_lines = []

    common_id = ascension["common"]["id"]
    common = COMMON[common_id]

    for tier in (
        "tier1",
        "tier2",
        "tier3"
    ):
        amount = ascension["common"].get(tier, 0)

        if amount <= 0:
            continue

        emoji = get_material_emoji(
            emojis,
            common["tiers"][tier]["emoji"]
        )

        common_lines.append(
            f"{emoji} **{common['tiers'][tier]['name']}** ×{amount}"
        )

    if common_lines:
        ascension_sections.append(
            "\n".join(common_lines)
        )

    if ascension_sections:
        embed.add_field(
            name="Ascension Materials",
            value="\n\n".join(ascension_sections) + "\n\u200b",
            inline=False
        )

    mora_emoji = get_material_emoji(
        emojis,
        mora_data["emoji"]
    )

    embed.add_field(
        name="Mora",
        value=(
            f"{mora_emoji} **{mora_data['name']}** ×{mora['levelling']:,} → **Level**\n\u200b"
            f"{mora_emoji} **{mora_data['name']}** ×{mora['ascension']:,} → **Ascension**\n\u200b"
            f"{mora_emoji} **{mora_data['name']}** ×{mora['total']:,} → **Total**"
        ),
        inline=False
    )

    character_icon = discord.File(
        get_character_icon(character["id"]),
        filename="character.png"
    )

    character_splash = discord.File(
        get_character_splash(character["id"]),
        filename="splash.png"
    )

    embed.set_thumbnail(url="attachment://character.png")
    embed.set_image(url="attachment://splash.png")

    return embed, character_icon, character_splash


class CharacterResourceCalculator(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(
        name="character-resources",
        description="Calculate resources needed to level a character."
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
                (
                    "The **starting level** must be **lower** than the **target level**."
                ),
                "invalid_input"
            )
            return

        character = get_character(name)

        if character is None:
            await send_interaction_error(
                interaction,
                "Character Not Found",
                f"The character `{name}` could not be found.",
                "not_found"
            )
            return

        resources = calculate_character_resources(
            character,
            starting_level,
            end_level
        )

        embed, character_icon, character_splash = format_resource_embed(
            character,
            resources,
            self.bot.application_emojis
        )

        await interaction.response.send_message(
            embed=embed,
            files=[character_icon, character_splash]
        )

    @commands.command(
        name="characterresources",
        aliases=["charresources", "cresources", "cr"]
    )
    async def character_resources_prefix(
            self,
            ctx,
            name: str,
            starting_level: int,
            end_level: int,
    ):
        if not 1 <= starting_level <= 90 or not 1 <= end_level <= 90:
            await send_invalid_input(
                ctx,
                "Character levels must be between **1** and **90**."
            )
            return

        if starting_level >= end_level:
            await send_invalid_input(
                ctx,
                (
                    "The **starting level** must be **lower** than the **target level**."
                )
            )
            return

        character = get_character(name)

        if character is None:
            await send_not_found(
                ctx,
                f"The character `{name}` could not be found."
            )
            return

        resources = calculate_character_resources(
            character,
            starting_level,
            end_level
        )

        embed, character_icon, character_splash = format_resource_embed(
            character,
            resources,
            self.bot.application_emojis
        )

        await ctx.send(
            embed=embed,
            files=[character_icon, character_splash]
        )

async def setup(bot):
    await bot.add_cog(CharacterResourceCalculator(bot))