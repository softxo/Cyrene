import json
from pathlib import Path

import discord

from bot.utils.icons import get_material_emoji

MATERIALS_PATH = Path("data/materials")

with open(MATERIALS_PATH / "gems.json", encoding="utf-8") as f:
    GEMS = json.load(f)

with open(MATERIALS_PATH / "books.json", encoding="utf-8") as f:
    BOOKS = json.load(f)

with open(MATERIALS_PATH / "common_drops.json", encoding="utf-8") as f:
    COMMON = json.load(f)

with open(MATERIALS_PATH / "boss_drops.json", encoding="utf-8") as f:
    BOSSES = json.load(f)

with open(MATERIALS_PATH / "weekly_drops.json", encoding="utf-8") as f:
    WEEKLY = json.load(f)

with open(MATERIALS_PATH / "local_specialties.json", encoding="utf-8") as f:
    LOCAL_SPECIALTIES = json.load(f)

with open(MATERIALS_PATH / "miscellaneous.json", encoding="utf-8") as f:
    MISC = json.load(f)


def material_line(emojis, material, amount):
    emoji = get_material_emoji(emojis, material["emoji"])

    return f"{emoji} **{material['name']}** ×{amount}"


def format_materials(material_data, costs, emojis):
    text = ""

    for tier, amount in costs.items():
        if not tier.startswith("tier"):
            continue

        material = material_data["tiers"][tier]
        emoji = get_material_emoji(emojis, material["emoji"])

        text += f"{emoji} **{material['name']}** ×{amount}\n"

    return text


def tier_lines(emojis, material, amounts, tiers, *, skip_empty=False):
    lines = []

    for tier in tiers:
        amount = amounts.get(tier, 0)

        if skip_empty and amount <= 0:
            continue

        lines.append(material_line(emojis, material["tiers"][tier], amount))

    return "\n".join(lines)


def exp_value(emojis, exp, exp_emoji, wasted_emoji):
    return (
        f"{get_material_emoji(emojis, exp_emoji)} **Required:** {exp['required']:,}\n"
        f"{get_material_emoji(emojis, wasted_emoji)} **Wasted:** {exp['wasted']:,}\n\u200b"
    )


def mora_breakdown(emojis, mora):
    return "\n\u200b".join(
        f"{material_line(emojis, MISC['mora'], f'{mora[key]:,}')} → **{label}**"
        for key, label in (("levelling", "Level"), ("ascension", "Ascension"), ("total", "Total"))
    )


def resource_embed(title, colour, subject_name, subject_value, levels):
    embed = discord.Embed(title=title, colour=discord.Colour.from_str(colour))

    embed.add_field(name=subject_name, value=subject_value, inline=True)
    embed.add_field(name="Starting Level", value=str(levels["starting"]), inline=True)
    embed.add_field(name="Target Level", value=str(levels["ending"]), inline=True)
    embed.add_field(name=" ", value=" ", inline=False)

    return embed
