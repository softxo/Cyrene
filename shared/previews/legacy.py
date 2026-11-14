"""Transitional preview retained until the persistent importer takes over."""

import json
from copy import deepcopy
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2] / "data" / "previews"


def legacy_weapon(name):
    from shared.previews.sync import released_entity

    if released_entity("weapons", name):
        return None
    path = _ROOT / "preview_weapon_materials.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    weapon = next(
        (value for key, value in data["weapons"].items() if key.casefold() == name.casefold()), None
    )
    if not weapon:
        return None
    return {"weapons": deepcopy(weapon), "materials": deepcopy(data["materials"])}


def legacy_catalogue():
    from shared.previews.sync import released_entity

    path = _ROOT / "preview_weapons.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [item for item in data["weapons"] if not released_entity("weapons", item["name"])]
