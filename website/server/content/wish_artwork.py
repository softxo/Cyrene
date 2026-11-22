import json
import re
from functools import lru_cache
from pathlib import Path

from genshin.models.genshin import constants


@lru_cache(maxsize=1)
def _weapon_icons():
    path = Path(__file__).resolve().parents[3] / "data/metadata/weapon_scan_catalogue.json"

    return {
        ("weapon", item["name"].casefold()): item["icon"]
        for item in json.loads(path.read_text(encoding="utf-8"))
    }


def wish_icons() -> dict[tuple[str, str], str]:
    icons = dict(_weapon_icons())

    for character in constants.CHARACTER_NAMES.get("en-us", {}).values():
        if not character.guessed and re.fullmatch(r"[A-Za-z0-9_]+", character.icon_name):
            icons[("character", character.name.casefold())] = (
                f"https://enka.network/ui/UI_AvatarIcon_{character.icon_name}.png"
            )

    for name in ("Mitya", "Valeriy"):
        icons[("character", name.casefold())] = f"https://enka.network/ui/UI_AvatarIcon_{name}.png"

    return icons
