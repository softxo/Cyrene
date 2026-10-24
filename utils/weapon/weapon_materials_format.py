import discord
from utils.materials.materials import MISC
from utils.icons import get_material_emoji
from utils.materials.materials_format import format_materials
from utils.weapon.weapon_materials import (get_weapon_material, get_common_material, get_elite_material)
from utils.constants.colours import WEAPON_RARITY_COLOURS

def get_weapon_material_text(data, emojis):
    materials = data["materials"]["ascension"]

    weapon = materials["weapon_material"]

    weapon_data = get_weapon_material(weapon["id"])

    return format_materials(
        weapon_data,
        weapon,
        emojis
    )


def get_common_material_text(data, emojis):
    materials = data["materials"]["ascension"]

    common = materials["common"]
    common_data = get_common_material(common["id"])

    return format_materials(
        common_data,
        common,
        emojis
    )


def get_elite_material_text(data, emojis):
    materials = data["materials"]["ascension"]

    elite = materials["elite"]
    elite_data = get_elite_material(elite["id"])

    return format_materials(
        elite_data,
        elite,
        emojis
    )


def get_mora_ascension_text(data, emojis):
    mora = data["materials"]["ascension"]["mora"]

    mora_data = MISC["mora"]

    mora_emoji = get_material_emoji(
        emojis,
        mora_data["emoji"]
    )

    return (
        f"{mora_emoji} **{mora_data['name']}** ×{mora['amount']:,}"
    )

def get_level_material_text(data, emojis):
    ores = data["materials"]["level"]["ores"]
    mora = data["materials"]["level"]["mora"]

    mora_data = MISC[mora["id"]]

    text = []

    tier_names = {
        "tier1": "Enhancement Ore",
        "tier2": "Fine Enhancement Ore",
        "tier3": "Mystic Enhancement Ore",
    }

    ore_ids = {
        "tier1": "enhancement_ore",
        "tier2": "fine_enhancement_ore",
        "tier3": "mystic_enhancement_ore"
    }

    for tier, amount in ores.items():
        if tier == "id":
            continue

        ore_data = MISC[ore_ids[tier]]

        text.append(
            f"{get_material_emoji(emojis, ore_data['emoji'])} "
            f"**{tier_names[tier]}** ×{amount:,}"
        )

    text.append("")

    text.append(
        f"{get_material_emoji(emojis, mora_data['emoji'])} "
        f"**{mora_data['name']}** ×{mora['amount']:,}"
    )

    return "\n".join(text)

def get_total_mora_text(data, emojis):
    ascension_mora = data["materials"]["ascension"]["mora"]["amount"]
    level_mora = data["materials"]["level"]["mora"]["amount"]

    total = ascension_mora + level_mora

    mora_data = MISC["mora"]

    return (
        f"{get_material_emoji(emojis, mora_data['emoji'])} "
        f"**{mora_data['name']}** ×{total:,}"
    )


def build_ascension_materials_embed(data, emojis):
    embed = discord.Embed(
        title=f"Ascension Materials • {data['name']}",
        colour=WEAPON_RARITY_COLOURS[data["rarity"]]
    )

    embed.set_thumbnail(url="attachment://weapon.webp")

    ascension_text = (
        f"{get_weapon_material_text(data, emojis)}\n"

        f"{get_common_material_text(data, emojis)}\n"

        f"{get_elite_material_text(data, emojis)}\n"

        f"{get_mora_ascension_text(data, emojis)}"
    )

    embed.add_field(
        name=f"Weapon Ascension • Lv. 1 → {data['max_level']}",
        value=ascension_text + "\n\u200b",
        inline=False
    )

    embed.add_field(
        name=f"Weapon Levels • Lv. 1 → {data['max_level']}",
        value=get_level_material_text(data, emojis)  + "\n\u200b",
        inline=False
    )

    embed.add_field(
        name=f"Total Mora • Lv. 1 → {data['max_level']}",
        value=get_total_mora_text(data, emojis),
        inline=False
    )

    return embed