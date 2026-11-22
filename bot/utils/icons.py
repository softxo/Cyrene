from pathlib import Path
from typing import Optional

import discord
from discord import Emoji

CHARACTER_ASSETS = Path("assets/characters")
WEAPON_ASSETS = Path("assets/weapons")
ENEMY_ASSETS = Path("assets/enemies")

TALENT_SUFFIXES = {
    "normal": "NA",
    "skill": "E",
    "burst": "Q",
    "a1": "A1",
    "a4": "A4",
    "utility": "Utility",
    "witch's homework": "WitchsHomework",
    "radiance": "Radiance",
}


def get_constellation_emoji(emojis, character_id: str, constellation: int) -> Optional[Emoji]:
    name = f"{get_emoji_character_name(character_id)}_C{constellation}"

    return discord.utils.get(emojis, name=name)


def get_emoji_character_name(character_id: str) -> str:
    return "_".join(part.capitalize() for part in character_id.split("_"))


def get_talent_emoji(emojis, character_id: str, talent: str) -> Optional[Emoji]:
    suffix = TALENT_SUFFIXES.get(talent)

    if suffix is None:
        return None

    return discord.utils.get(emojis, name=f"{get_emoji_character_name(character_id)}_{suffix}")


def get_material_emoji(emojis, emoji_name: str) -> str:
    emoji = discord.utils.get(emojis, name=emoji_name)

    return str(emoji) if emoji else ""


def get_application_emoji(emojis, emoji_name: str) -> str:
    emoji = discord.utils.get(emojis, name=emoji_name)

    if emoji is None:
        return ""

    if emoji.animated:
        return f"<a:{emoji.name}:{emoji.id}>"

    return f"<:{emoji.name}:{emoji.id}>"


def get_character_icon(character_id: str) -> Path:
    return CHARACTER_ASSETS / character_id / "icons" / "icon.webp"


def get_character_splash(character_id: str) -> Path:
    return CHARACTER_ASSETS / character_id / "icons" / "splash.png"


def get_weapon_icon(weapon: dict) -> Path:
    return (
        WEAPON_ASSETS
        / weapon["weapon_type"]
        / f"{weapon['rarity']}_star"
        / f"{weapon['icon']}.webp"
    )


def get_enemy_icon(enemy_data, category):
    return ENEMY_ASSETS / category / "icons" / f"{enemy_data['emoji']}.webp"


def get_enemy_splash(enemy_data, category):
    return ENEMY_ASSETS / category / "splash" / f"{enemy_data['emoji']}.webp"
