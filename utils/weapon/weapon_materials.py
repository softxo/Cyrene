import json
from pathlib import Path

MATERIALS_PATH = Path("data/materials")

with open(MATERIALS_PATH / "weapon_materials.json", encoding="utf-8") as f:
    WEAPON_MATERIALS = json.load(f)

with open(MATERIALS_PATH / "common_drops.json", encoding="utf-8") as f:
    COMMON_MATERIALS = json.load(f)

with open(MATERIALS_PATH / "elite_drops.json", encoding="utf-8") as f:
    ELITE_MATERIALS = json.load(f)


def get_weapon_material(material_id):
    return WEAPON_MATERIALS.get(material_id)


def get_common_material(material_id):
    return COMMON_MATERIALS.get(material_id)


def get_elite_material(material_id):
    return ELITE_MATERIALS.get(material_id)