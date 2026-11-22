import json
from copy import deepcopy
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2] / "data" / "previews"


def _read_preview_file(filename):
    path = _ROOT / filename

    if not path.exists():
        return None

    return json.loads(path.read_text(encoding="utf-8"))


def _find_weapon(weapons, name):
    wanted = name.casefold()

    for key, weapon in weapons.items():
        if key.casefold() == wanted:
            return weapon

    return None


def legacy_weapon(name):
    from shared.previews.sync import released_entity

    if released_entity("weapons", name):
        return None

    data = _read_preview_file("preview_weapon_materials.json")

    if data is None:
        return None

    weapon = _find_weapon(data["weapons"], name)

    if not weapon:
        return None

    return {
        "weapons": deepcopy(weapon),
        "materials": deepcopy(data["materials"]),
    }


def legacy_catalogue():
    from shared.previews.sync import released_entity

    data = _read_preview_file("preview_weapons.json")

    if data is None:
        return []

    return [weapon for weapon in data["weapons"] if not released_entity("weapons", weapon["name"])]
