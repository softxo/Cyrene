import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

MATERIALS_DIRECTORY = Path(__file__).resolve().parents[2] / "data" / "materials"

CATALOGUE_CATEGORIES = {
    "books": "Talent books",
    "boss_drops": "Boss drops",
    "common_drops": "Common enemy drops",
    "elite_drops": "Elite enemy drops",
    "gems": "Character ascension gems",
    "local_specialties": "Local specialities",
    "weapon_materials": "Weapon ascension materials",
    "weekly_drops": "Weekly boss drops",
    "miscellaneous": "Other materials",
}

CHARACTER_EXP_MATERIALS = ("Hero's Wit", "Adventurer's Experience", "Wanderer's Advice")
WEAPON_EXP_MATERIALS = ("Enhancement Ore", "Fine Enhancement Ore", "Mystic Enhancement Ore")

ADDITIONAL_MATERIALS = {
    "Weekly boss drops": ["Denial and Judgment"],
    "Local specialities": ["Golden Fern"],
    "Boss drops": [
        "Vagabond's Cracked Sigil",
        '"Tourbillon Device"',
        "Artificed Spare Clockwork Component ? Coppelia",
        "Artificed Spare Clockwork Component ? Coppelius",
    ],
    "Common enemy drops": [
        "Crystalline Cyst Dust",
        "Luminescent Pollen",
        "Prime Chimeric Nexus",
    ],
    "Elite enemy drops": [
        "Robust Fungal Nucleus",
        "Accreted Fragment",
        "Accreted Mass",
        "Accreted Growth",
        "Hollow Root of Life",
        "Sprout Node of Life",
        "Coiled Core of Life",
    ],
    "Weapon ascension materials": [
        "Tile of Decarabian's Tower",
        "Debris of Decarabian's City",
        "Fragment of Decarabian's Epic",
        "Scattered Piece of Decarabian's Dream",
        "Rise of the Pale Star Army",
        "Muster of the Pale Star Army",
        "Clarion of the Pale Star Army",
        "Triumph of the Pale Star Army",
        "Measured Pour of the Cellared Spiritual Nectar",
        "Intoxication of the Cellared Spiritual Nectar",
        "Exhilaration of the Cellared Spiritual Nectar",
        "Revelry of the Cellared Spiritual Nectar",
        "The Frost Emperor's Revival",
        "The Frost Emperor's Ceremony",
        "The Frost Emperor's Lament",
        "The Frost Emperor's Farewell",
    ],
}


def material_name_key(name: str) -> str:
    name = unicodedata.normalize("NFKC", name).casefold()

    return re.sub(r"[^a-z0-9]", "", name)


def _collect_names(node, kind, kinds):
    if not isinstance(node, dict):
        return

    if "name" in node:
        kinds[node["name"].casefold()] = kind

    for value in node.values():
        _collect_names(value, kind, kinds)


def _read_catalogue(filename):
    path = MATERIALS_DIRECTORY / f"{filename}.json"

    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def material_kinds() -> dict[str, str]:
    kinds = {}

    for filename, kind in CATALOGUE_CATEGORIES.items():
        _collect_names(_read_catalogue(filename), kind, kinds)

    kinds["mora"] = "Currency"

    for name in CHARACTER_EXP_MATERIALS:
        kinds[name.casefold()] = "Character EXP materials"

    for name in WEAPON_EXP_MATERIALS:
        kinds[name.casefold()] = "Weapon EXP materials"

    kinds["crown of insight"] = "Talent materials"

    for kind, names in ADDITIONAL_MATERIALS.items():
        kinds.update(dict.fromkeys(names, kind))

    return {material_name_key(name): kind for name, kind in kinds.items()}
