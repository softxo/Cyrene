import discord
from pathlib import Path
from discord import Emoji
from typing import Optional

CHARACTER_ASSETS = Path("assets/characters")
WEAPON_ASSETS = Path("assets/weapons")
ENEMY_ASSETS = Path("assets/enemies")
WARD_ASSETS = Path("assets/wards")
ARTIFACT_ASSETS = Path("assets/artifacts")

TALENT_SUFFIXES = {
    "normal": "NA",
    "skill": "E",
    "burst": "Q",
    "a1": "A1",
    "a4": "A4",
    "utility": "Utility",
    "witch's homework": "WitchsHomework",
    "radiance": "Radiance"
}

# ================
# EMOJI Helpers
# ================

def get_constellation_emoji(
        emojis,
        character_id: str,
        constellation: int
) -> Optional[Emoji]:

    name = f"{get_emoji_character_name(character_id)}_C{constellation}"

    return discord.utils.get(emojis, name=name)


def get_emoji_character_name(character_id: str) -> str:
    return "_".join(part.capitalize() for part in character_id.split("_"))


def get_talent_emoji(
        emojis,
        character_id: str,
        talent: str
) -> Optional[Emoji]:

    suffix = TALENT_SUFFIXES.get(talent)

    if suffix is None:
        return None

    return discord.utils.get(
        emojis,
        name=f"{get_emoji_character_name(character_id)}_{suffix}"
    )


def get_material_emoji(
    emojis,
    emoji_name: str
) -> str:
    emoji = discord.utils.get(
        emojis,
        name=emoji_name
    )

    return str(emoji) if emoji else ""


def get_artifact_emoji(
    emojis,
    emoji_name: str
) -> str:
    emoji = discord.utils.get(
        emojis,
        name=emoji_name
    )

    return str(emoji) if emoji else ""

def get_application_emoji(
    emojis,
    emoji_name: str
) -> str:
    emoji = discord.utils.get(
        emojis,
        name=emoji_name
    )

    if emoji is None:
        return ""

    if emoji.animated:
        return f"<a:{emoji.name}:{emoji.id}>"

    return f"<:{emoji.name}:{emoji.id}>"

# ================
# ASSET Helpers
# ================

def get_constellation_icons(character_id: str) -> list[Path]:
    folder = CHARACTER_ASSETS / character_id / "constellations"

    return [
        folder / f"C{i}.webp"
        for i in range(1,7)
    ]


def get_talent_images(character_id: str) -> dict[str, Path]:
    folder = CHARACTER_ASSETS / character_id / "talents"

    return {
        "normal": folder / "Normal_Attack.webp",
        "skill": folder / "Elemental_Skill.webp",
        "burst": folder / "Elemental_Burst.webp",
        "a1": folder / "A1.webp",
        "a4" : folder / "A4.webp",
        "utility": folder / "Utility.webp",
        "witch's homework": folder / "Witch's Homework.webp",
    }


def get_character_icon(character_id: str) -> Path:
    return CHARACTER_ASSETS / character_id / "icons" / "icon.webp"


def get_character_splash(character_id: str) -> Path:
    return CHARACTER_ASSETS / character_id / "icons" / "splash.png"


def get_character_card(character_id: str) -> Path:
    return CHARACTER_ASSETS / character_id / "icons" / "card.png"


def get_weapon_icon(weapon: dict) -> Path:
    return (
        WEAPON_ASSETS
        / weapon["weapon_type"]
        / f'{weapon["rarity"]}_star'
        / f'{weapon["icon"]}.webp'
    )


def get_weapon_asset(
    weapon: dict,
    filename: str
) -> Path:
    return (
        WEAPON_ASSETS
        / weapon["weapon_type"]
        / f'{weapon["rarity"]}_star'
        / filename
    )


def get_enemy_icon(enemy_data, category):
    return (
        ENEMY_ASSETS
        / category
        / "icons"
        / f"{enemy_data['emoji']}.webp"
    )


def get_enemy_splash(enemy_data, category):
    return (
        ENEMY_ASSETS
        / category
        / "splash"
        / f"{enemy_data['emoji']}.png"
    )


def get_ward_icon(shield: str):
    return WARD_ASSETS / f"{shield}.png"


def get_artifact_icon(artifact: dict) -> Path:
    return ARTIFACT_ASSETS / f'{artifact["icon"]}.webp'
