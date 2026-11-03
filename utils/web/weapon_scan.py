"""Validate complete weapon scans before replacing an account's saved snapshot."""

import json
import re
import uuid
from functools import lru_cache
from pathlib import Path

from genshin.models.genshin.constants import CHARACTER_NAMES

from utils.web.weapons import weapon_release_version, weapon_tag


def _normalise(value):
    return re.sub(r"[\W_]", "", value.casefold())


@lru_cache(maxsize=1)
def _catalogue():
    path = Path(__file__).resolve().parents[2] / "data" / "weapon_scan_catalogue.json"
    return json.loads(path.read_text(encoding="utf-8"))


def normalise_scan_character(row, nickname=""):
    result = dict(row)
    location = str(result.get("equipped") or "").strip()
    if not location:
        return result
    characters = {_normalise(char.name): char for char in CHARACTER_NAMES.get("en-us", {}).values()}
    if _normalise(location) and _normalise(location) in {
        _normalise(nickname),
        "aether",
        "lumine",
        "traveler",
        "traveller",
    }:
        location = "Traveler"
    character = characters.get(_normalise(location))
    if character:
        result.update(
            equipped=character.name,
            character_icon=f"https://enka.network/ui/UI_AvatarIcon_{character.icon_name}.png",
            character_rarity=character.rarity,
        )
    return result


def validate_weapon_scan(payload, genshin_uid, nickname=""):

    if not isinstance(payload, dict) or payload.get("format") != "GOOD":
        raise ValueError("Choose a GOOD weapon export from Cyrene Scanner.")
    metadata = payload.get("cyrene")
    if not isinstance(metadata, dict) or metadata.get("complete") is not True:
        raise ValueError("This scan is incomplete. Finish and review the scan before importing.")
    if str(metadata.get("uid", "")) != str(genshin_uid):
        raise ValueError(
            "This scan belongs to a different Genshin UID. Select the matching account."
        )
    rows = payload.get("weapons")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 5000:
        raise ValueError("The export must contain between 1 and 5000 weapons.")
    count = metadata.get("expected_count")
    if type(count) is not int or count != len(rows):
        raise ValueError("The scanned count does not match the inventory count.")
    try:
        scan_id = str(uuid.UUID(metadata.get("scan_id", "")))
    except ValueError, AttributeError, TypeError:
        raise ValueError("The scan identifier is invalid.") from None
    definitions = _catalogue()
    by_id = {row["id"]: row for row in definitions}
    by_key = {_normalise(row["key"]): row for row in definitions}
    characters = {_normalise(char.name): char for char in CHARACTER_NAMES.get("en-us", {}).values()}
    weapons = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or not isinstance(row.get("key"), str):
            raise ValueError(f"Weapon {index + 1} has no valid identity.")
        definition = by_key.get(_normalise(row["key"]))
        if definition is None or ("cyrene_id" in row and by_id.get(row["cyrene_id"]) != definition):
            raise ValueError(
                f"Weapon {index + 1} is not in the scanner catalogue. Update the scanner."
            )
        level, refinement = row.get("level"), row.get("refinement")
        if type(level) is not int or not 1 <= level <= (70 if definition["rarity"] <= 2 else 90):
            raise ValueError(f"Weapon {index + 1} has an invalid level.")
        if type(refinement) is not int or not 1 <= refinement <= 5:
            raise ValueError(f"Weapon {index + 1} has an invalid refinement.")
        location = row.get("location", "")
        if not isinstance(location, str) or len(location) > 80:
            raise ValueError(f"Weapon {index + 1} has an invalid equipped character.")
        result = {
            "id": definition["id"],
            "name": definition["name"],
            "type": definition["type"],
            "rarity": definition["rarity"],
            "icon": definition["icon"],
            "level": level,
            "refinement": refinement,
            "scan_copy_id": f"{scan_id}:{index}",
            "tag": weapon_tag(definition["id"]),
            "release_version": weapon_release_version(definition["id"]),
        }
        if location.strip():
            character = characters.get(_normalise(location))
            result["equipped"] = character.name if character else location.strip()
            if character:
                result["character_icon"] = (
                    f"https://enka.network/ui/UI_AvatarIcon_{character.icon_name}.png"
                )
                result["character_rarity"] = character.rarity
        weapons.append(normalise_scan_character(result, nickname))
    return {"scan_id": scan_id, "weapons": weapons, "uid": str(genshin_uid)}
