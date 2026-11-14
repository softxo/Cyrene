"""Material categories shared with the local development-material catalogue."""

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path


def material_name_key(name: str) -> str:
    """Ignore typography differences in the calculator's material names."""
    name = unicodedata.normalize("NFKC", name).casefold()
    return re.sub(r"[^a-z0-9]", "", name)


@lru_cache(maxsize=1)
def material_kinds() -> dict[str, str]:
    kinds = {}
    directory = Path(__file__).resolve().parents[2] / "data" / "materials"
    categories = {
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

    def collect(node, kind):
        if not isinstance(node, dict):
            return
        if "name" in node:
            kinds[node["name"].casefold()] = kind
        for value in node.values():
            collect(value, kind)

    for filename, kind in categories.items():
        collect(json.loads((directory / f"{filename}.json").read_text(encoding="utf-8")), kind)
    kinds["mora"] = "Currency"
    for name in ("Hero's Wit", "Adventurer's Experience", "Wanderer's Advice"):
        kinds[name.casefold()] = "Character EXP materials"
    for name in ("Enhancement Ore", "Fine Enhancement Ore", "Mystic Enhancement Ore"):
        kinds[name.casefold()] = "Weapon EXP materials"
    kinds["crown of insight"] = "Talent materials"
    additions = {
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
    for kind, names in additions.items():
        kinds.update(dict.fromkeys(names, kind))
    return {material_name_key(name): kind for name, kind in kinds.items()}
