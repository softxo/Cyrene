import discord
from discord import app_commands
from discord.ext import commands
from utils.weapon.weapons import get_weapon
from utils.weapon.weapon_autocomplete import weapon_autocomplete
from utils.resource_calculator.weapon_resource_calculator import calculate_weapon_resources
from utils.icons import get_material_emoji, get_weapon_icon
from utils.weapon.weapon_materials import get_weapon_material, get_common_material, get_elite_material
from utils.materials.materials import MISC
from utils.errors.error_handler import send_missing_argument, send_invalid_input, send_not_found, send_interaction_error


def format_weapon_resource_embed(
        weapon: dict,
        resources: dict,
        emojis,
) -> tuple[discord.Embed, discord.File]:

    levels = resources["levels"]
    exp = resources["exp"]
    ascension = resources["ascension"]
    mora = resources["mora"]

    embed = discord.Embed(
        title=f"Resource Calculator • {weapon['name']}",
        colour=discord.Colour.from_str(weapon["colour"]),
    )

    embed.add_field(
        name="Weapon",
        value=f"**{weapon['name']}**",
        inline=True,
    )

    embed.add_field(
        name="Starting Level",
        value=str(levels["starting"]),
        inline=True,
    )

    embed.add_field(
        name="Target Level",
        value=str(levels["ending"]),
        inline=True,
    )

    embed.add_field(
        name=" ",
        value=" ",
        inline=False,
    )

    weapon_exp_emoji = get_material_emoji(
        emojis,
        "Weapon_EXP",
    )

    wasted_weapon_exp_emoji = get_material_emoji(
        emojis,
        "Wasted_Weapon_EXP",
    )

    embed.add_field(
        name="EXP",
        value=(
            f"{weapon_exp_emoji} **Required:** {exp['required']:,}\n"
            f"{wasted_weapon_exp_emoji} **Wasted:** {exp['wasted']:,}"
        ) + "\n\u200b",
        inline=False,
    )

    ore_lines = []

    ore_names = {
        "tier1": "Enhancement Ore",
        "tier2": "Fine Enhancement Ore",
        "tier3": "Mystic Enhancement Ore",
    }

    ore_emojis = {
        "tier1": "Enhancement_Ore",
        "tier2": "Fine_Enhancement_Ore",
        "tier3": "Mystic_Enhancement_Ore",
    }

    for tier in ("tier1", "tier2", "tier3"):

        amount = exp["ores"].get(tier, 0)

        if amount <= 0:
            continue

        emoji = get_material_emoji(
            emojis,
            ore_emojis[tier],
        )

        ore_lines.append(
            f"{emoji} **{ore_names[tier]}** ×{amount}"
        )

    embed.add_field(
        name="Level Materials",
        value="\n".join(ore_lines) + "\n\u200b",
        inline=False,
    )

    ascension_sections = []

    weapon_lines = []

    weapon_material_id = ascension["weapon_material"]["id"]
    weapon_material = get_weapon_material(weapon_material_id)

    if weapon_material:
        for tier in (
            "tier2",
            "tier3",
            "tier4",
            "tier5",
        ):
            amount = ascension["weapon_material"].get(tier, 0)

            if amount <= 0:
                continue

            tier_data = weapon_material["tiers"][tier]

            emoji = get_material_emoji(
                emojis,
                tier_data["emoji"],
            )

            weapon_lines.append(
                f"{emoji} **{tier_data['name']}** ×{amount}"
            )

    if weapon_lines:
        ascension_sections.append(
            "\n".join(weapon_lines)
        )

    common_lines = []

    common_id = ascension["common"]["id"]
    common_material = get_common_material(common_id)

    if common_material:
        for tier in (
            "tier1",
            "tier2",
            "tier3",
        ):
            amount = ascension["common"].get(tier, 0)

            if amount <= 0:
                continue

            tier_data = common_material["tiers"][tier]

            emoji = get_material_emoji(
                emojis,
                tier_data["emoji"],
            )

            common_lines.append(
                f"{emoji} **{tier_data['name']}** ×{amount}"
            )

    if common_lines:
        ascension_sections.append(
            "\n".join(common_lines)
        )

    elite_lines = []

    elite_id = ascension["elite"]["id"]
    elite_material = get_elite_material(elite_id)

    if elite_material:
        for tier in (
            "tier2",
            "tier3",
            "tier4",
        ):
            amount = ascension["elite"].get(tier, 0)

            if amount <= 0:
                continue

            tier_data = elite_material["tiers"][tier]

            emoji = get_material_emoji(
                emojis,
                tier_data["emoji"],
            )

            elite_lines.append(
                f"{emoji} **{tier_data['name']}** ×{amount}"
            )

    if elite_lines:
        ascension_sections.append(
            "\n".join(elite_lines)
        )

    if ascension_sections:
        embed.add_field(
            name="Ascension Materials",
            value="\n\n".join(ascension_sections) + "\n\u200b",
            inline=False,
        )

    mora_data = MISC["mora"]

    mora_emoji = get_material_emoji(
        emojis,
        mora_data["emoji"],
    )

    embed.add_field(
        name="Mora",
        value=(
            f"{mora_emoji} **{mora_data['name']}** "
            f"×{mora['levelling']:,} → **Level**\n\u200b"
            f"{mora_emoji} **{mora_data['name']}** "
            f"×{mora['ascension']:,} → **Ascension**\n\u200b"
            f"{mora_emoji} **{mora_data['name']}** "
            f"×{mora['total']:,} → **Total**"
        ),
        inline=False,
    )

    weapon_icon = discord.File(
        get_weapon_icon(weapon),
        filename="weapon.webp",
    )

    embed.set_thumbnail(
        url="attachment://weapon.webp"
    )

    return embed, weapon_icon

class WeaponResourceCalculator(commands.Cog):

    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(
        name="weapon-resources",
        description="Calculate resources needed to level a weapon."
    )
    @app_commands.autocomplete(name=weapon_autocomplete)
    async def weapon_resources(
        self,
        interaction: discord.Interaction,
        name: str,
        starting_level: app_commands.Range[int, 1, 90],
        end_level: app_commands.Range[int, 1, 90],
    ):

        if starting_level >= end_level:
            await send_interaction_error(
                interaction,
                "Invalid Input",
                "The **starting level** must be **lower** than the **target level**.",
                "invalid_input"
            )
            return

        weapon = get_weapon(name)

        if weapon is None:
            await send_interaction_error(
                interaction,
                "Not Found",
                f"The weapon `{name}` could not be found.",
                "not_found"
            )
            return

        resources = calculate_weapon_resources(
            weapon,
            starting_level,
            end_level,
        )

        embed, weapon_icon = format_weapon_resource_embed(
            weapon,
            resources,
            self.bot.application_emojis,
        )

        await interaction.response.send_message(
            embed=embed,
            file=weapon_icon,
        )

    @commands.command(
        name="weaponresources",
        aliases=["weapresources", "wresources", "wr"],
    )
    async def weapon_resources_prefix(
        self,
        ctx,
        *,
        arguments: str
    ):
        parts = arguments.rsplit(maxsplit=2)

        if len(parts) != 3:
            await send_missing_argument(
                ctx,
                f"{ctx.prefix}wr <weapon> <starting level> <target level>"
            )
            return

        name, starting_level, end_level = parts

        try:
            starting_level = int(starting_level)
            end_level = int(end_level)

        except ValueError:
            await send_invalid_input(
                ctx,
                (
                    "Starting and target levels must be **whole numbers**.\n\n"
                    f"**Usage:** `{ctx.prefix}wr <weapon> <starting level> <target level>`"
                )
            )
            return

        if not 1 <= starting_level <= 90 or not 1 <= end_level <= 90:
            await send_invalid_input(
                ctx,
                "Weapon levels must be between **1** and **90**.",
            )
            return

        if starting_level >= end_level:
            await send_invalid_input(
                ctx,
                "The **starting level** must be **lower** than the **target level**.",
            )
            return

        weapon = get_weapon(name)

        if weapon is None:
            await send_not_found(
                ctx,
                f"The weapon `{name}` could not be found.",
            )
            return

        resources = calculate_weapon_resources(
            weapon,
            starting_level,
            end_level,
        )

        embed, weapon_icon = format_weapon_resource_embed(
            weapon,
            resources,
            self.bot.application_emojis,
        )

        await ctx.send(
            embed=embed,
            file=weapon_icon,
        )


async def setup(bot):
    await bot.add_cog(
        WeaponResourceCalculator(bot)
    )