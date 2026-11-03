"""Weapon rows shared by the account view and calculator catalogue."""

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from genshin.models.genshin.calculator import CALCULATOR_WEAPON_TYPES


def _weapon_tags():
    path = Path(__file__).resolve().parents[2] / "data" / "weapon_tags.json"
    return _read_weapon_tags(path.stat().st_mtime_ns)


@lru_cache(maxsize=1)
def _read_weapon_tags(_modified_ns):
    # Updating the catalogue invalidates the cached labels automatically.
    path = Path(__file__).resolve().parents[2] / "data" / "weapon_tags.json"
    return json.loads(path.read_text(encoding="utf-8"))["weapons"]


def weapon_tag(weapon_id):
    entry = _weapon_tags().get(str(weapon_id), {})
    signature = entry.get("signature")
    return {
        "label": f"{signature}'s Signature"
        if signature
        else entry.get("source", "Source unavailable"),
        "kind": "signature" if signature else "source",
        "source": entry.get("source", "Source unavailable"),
    }


def weapon_release_version(weapon_id):
    return _weapon_tags().get(str(weapon_id), {}).get("release_version", "")


def weapon_sort_key(row):
    version = [int(part) for part in row.get("release_version", "").split(".") if part.isdigit()]
    version = (version + [0, 0, 0])[:3]
    return (-row["rarity"], *(-part for part in version), row["name"].casefold())


def validate_manual_weapon(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid weapon.")
    row = {}
    for key in ("id", "rarity", "level", "refinement"):
        value = payload.get(key)
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError("Invalid number.")
        row[key] = value
    if row["id"] <= 0 or not 1 <= row["rarity"] <= 5:
        raise ValueError("Invalid weapon.")
    if not 1 <= row["refinement"] <= 5 or not 1 <= row["level"] <= (
        70 if row["rarity"] <= 2 else 90
    ):
        raise ValueError("Invalid progression.")
    for key in ("name", "icon", "type"):
        value = payload.get(key)
        if not isinstance(value, str) or not value.strip() or len(value) > 2048:
            raise ValueError("Invalid identity.")
        row[key] = value.strip()
    if row["type"] not in {"Sword", "Claymore", "Polearm", "Bow", "Catalyst"}:
        raise ValueError("Invalid type.")
    if not row["icon"].startswith("https://"):
        raise ValueError("Invalid icon.")
    return row


def owned_weapon_rows(characters):
    # Weapon IDs identify a weapon type, not a unique copy. Keep each wielder.
    rows = []
    for character in characters:
        weapon = character.weapon
        rows.append(
            {
                "id": weapon.id,
                "name": weapon.name,
                "icon": weapon.icon,
                "rarity": weapon.rarity,
                "type": CALCULATOR_WEAPON_TYPES.get(weapon.type, "Unknown"),
                "level": weapon.level,
                "refinement": weapon.refinement,
                "ascension": getattr(weapon, "ascension", None),
                "equipped": character.name,
                "character_icon": character.icon,
                "character_rarity": character.rarity,
                "tag": weapon_tag(weapon.id),
                "release_version": weapon_release_version(weapon.id),
            }
        )
    return sorted(rows, key=weapon_sort_key)


def catalogue_weapon_rows(weapons):
    rows = {
        int(weapon.id): {
            "id": weapon.id,
            "name": weapon.name,
            "icon": weapon.icon,
            "rarity": weapon.rarity,
            "type": weapon.type,
            "max_level": weapon.max_level,
            "tag": weapon_tag(weapon.id),
            "release_version": weapon_release_version(weapon.id),
        }
        for weapon in weapons
    }
    # HoYoLAB's calculator can lag behind announced weapons. Prefer its exact
    # record as soon as it arrives, without duplicating the supplemental entry.
    path = Path(__file__).resolve().parents[2] / "data" / "preview_weapons.json"
    today = datetime.now(timezone.utc).date().isoformat()
    for weapon in json.loads(path.read_text(encoding="utf-8"))["weapons"]:
        if weapon["id"] in rows:
            rows[weapon["id"]]["unreleased"] = weapon["release_date"] > today
        rows.setdefault(
            weapon["id"],
            {
                **weapon,
                "tag": weapon_tag(weapon["id"]),
                "unreleased": weapon["release_date"] > today,
            },
        )
    return sorted(rows.values(), key=weapon_sort_key)
