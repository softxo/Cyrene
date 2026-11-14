"""Weapon rows shared by the account view and calculator catalogue."""

import json
from functools import lru_cache
from pathlib import Path

from genshin.models.genshin.calculator import CALCULATOR_WEAPON_TYPES


def _weapon_tags():
    path = Path(__file__).resolve().parents[3] / "data" / "metadata" / "weapon_tags.json"
    return _read_weapon_tags(path.stat().st_mtime_ns)


@lru_cache(maxsize=1)
def _read_weapon_tags(_modified_ns):
    path = Path(__file__).resolve().parents[3] / "data" / "metadata" / "weapon_tags.json"
    return json.loads(path.read_text(encoding="utf-8"))["weapons"]


def weapon_tag(weapon_id, name=None):
    from shared.previews.sync import signature_for
    from website.server.content.weapon_sources import enqueue, source_for

    entry = _weapon_tags().get(str(weapon_id), {})
    signature = entry.get("signature") or signature_for(weapon_id)
    source = entry.get("source") or source_for(weapon_id)
    if not source and name:
        enqueue(weapon_id, name)
    source = source or "Unknown"
    return {
        "label": f"{signature}'s Signature" if signature else source,
        "kind": "signature" if signature else "source",
        "source": source,
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
                "tag": weapon_tag(weapon.id, weapon.name),
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
            "tag": weapon_tag(weapon.id, weapon.name),
            "release_version": weapon_release_version(weapon.id),
        }
        for weapon in weapons
    }
    from shared.previews.legacy import legacy_catalogue
    from shared.previews.sync import catalogue, released_catalogue

    for weapon in released_catalogue("weapons"):
        rows.setdefault(
            weapon["id"],
            {
                **weapon,
                "max_level": 90,
                "tag": weapon_tag(weapon["id"], weapon["name"]),
                "release_version": weapon_release_version(weapon["id"]),
            },
        )

    weapon_types = {1: "Sword", 10: "Catalyst", 11: "Claymore", 12: "Polearm", 13: "Bow"}
    for entry in catalogue("weapons"):
        weapon = entry["weapons"]
        weapon_type = weapon_types.get(weapon.get("weapon_type_id"))
        if not weapon_type or not weapon.get("icon") or not weapon.get("rarity"):
            continue
        if weapon["id"] in rows:
            rows[weapon["id"]]["unreleased"] = not entry.get("release_confirmed", False)
        rows.setdefault(
            weapon["id"],
            {
                "id": weapon["id"],
                "name": weapon["name"],
                "icon": weapon["icon"],
                "rarity": weapon["rarity"],
                "type": weapon_type,
                "max_level": 90,
                "tag": weapon_tag(weapon["id"], weapon["name"]),
                "release_version": "",
                "unreleased": not entry.get("release_confirmed", False),
            },
        )
    for weapon in legacy_catalogue():
        rows.setdefault(
            weapon["id"],
            {**weapon, "tag": weapon_tag(weapon["id"], weapon["name"]), "unreleased": False},
        )
    return sorted(
        rows.values(), key=lambda row: (not row.get("unreleased", False), *weapon_sort_key(row))
    )
