import discord
from discord import app_commands
from discord.ext import commands

from bot.utils.errors.error_handler import (
    send_interaction_error,
    send_invalid_input,
    send_missing_argument,
    send_not_found,
)
from bot.utils.icons import get_weapon_icon
from bot.utils.materials.materials import exp_value, mora_breakdown, resource_embed, tier_lines
from bot.utils.weapons.weapon_materials import (
    get_common_material,
    get_elite_material,
    get_weapon_material,
)
from bot.utils.weapons.weapons import get_weapon, weapon_autocomplete
from shared.resource_calculator.weapon_resource_calculator import calculate_weapon_resources

WEAPON_TIERS = ("tier2", "tier3", "tier4", "tier5")
COMMON_TIERS = ("tier1", "tier2", "tier3")
ELITE_TIERS = ("tier2", "tier3", "tier4")

ORES = {
    "tier1": {"name": "Enhancement Ore", "emoji": "Enhancement_Ore"},
    "tier2": {"name": "Fine Enhancement Ore", "emoji": "Fine_Enhancement_Ore"},
    "tier3": {"name": "Mystic Enhancement Ore", "emoji": "Mystic_Enhancement_Ore"},
}
ORE_MATERIAL = {"tiers": ORES}


def format_weapon_resource_embed(
    weapon: dict,
    resources: dict,
    emojis,
) -> tuple[discord.Embed, discord.File]:
    exp = resources["exp"]
    ascension = resources["ascension"]
    embed = resource_embed(
        f"Resource Calculator • {weapon['name']}",
        weapon["colour"],
        "Weapon",
        f"**{weapon['name']}**",
        resources["levels"],
    )

    embed.add_field(
        name="EXP",
        value=exp_value(emojis, exp, "Weapon_EXP", "Wasted_Weapon_EXP"),
        inline=False,
    )

    embed.add_field(
        name="Level Materials",
        value=tier_lines(emojis, ORE_MATERIAL, exp["ores"], ORES, skip_empty=True) + "\n\u200b",
        inline=False,
    )

    ascension_sections = []

    for material, amounts, tiers in (
        (
            get_weapon_material(ascension["weapon_material"]["id"]),
            ascension["weapon_material"],
            WEAPON_TIERS,
        ),
        (get_common_material(ascension["common"]["id"]), ascension["common"], COMMON_TIERS),
        (get_elite_material(ascension["elite"]["id"]), ascension["elite"], ELITE_TIERS),
    ):
        lines = material and tier_lines(emojis, material, amounts, tiers, skip_empty=True)

        if lines:
            ascension_sections.append(lines)

    if ascension_sections:
        embed.add_field(
            name="Ascension Materials",
            value="\n\n".join(ascension_sections) + "\n\u200b",
            inline=False,
        )

    embed.add_field(name="Mora", value=mora_breakdown(emojis, resources["mora"]), inline=False)

    weapon_icon = discord.File(
        get_weapon_icon(weapon),
        filename="weapon.webp",
    )

    embed.set_thumbnail(url="attachment://weapon.webp")

    return embed, weapon_icon


class WeaponResourceCalculator(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(
        name="weapon-resources", description="Calculate resources needed to level a weapon."
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
                "invalid_input",
            )
            return

        weapon = get_weapon(name)

        if weapon is None:
            await send_interaction_error(
                interaction, "Not Found", f"The weapon `{name}` could not be found.", "not_found"
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
    async def weapon_resources_prefix(self, ctx, *, arguments: str):
        parts = arguments.rsplit(maxsplit=2)

        if len(parts) != 3:
            await send_missing_argument(
                ctx, f"{ctx.prefix}wr <weapon> <starting level> <target level>"
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
                ),
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
    await bot.add_cog(WeaponResourceCalculator(bot))
