import json
from pathlib import Path

MATERIALS_PATH = Path("data/materials")

with open(MATERIALS_PATH / "gems.json", encoding="utf-8") as f:
    GEMS = json.load(f)

with open(MATERIALS_PATH / "books.json", encoding="utf-8") as f:
    BOOKS = json.load(f)

with open(MATERIALS_PATH / "common_drops.json", encoding="utf-8") as f:
    COMMON = json.load(f)

with open(MATERIALS_PATH / "boss_drops.json", encoding="utf-8") as f:
    BOSSES = json.load(f)

with open(MATERIALS_PATH / "weekly_drops.json", encoding="utf-8") as f:
    WEEKLY = json.load(f)

with open(MATERIALS_PATH / "local_specialties.json", encoding="utf-8") as f:
    LOCAL_SPECIALTIES = json.load(f)

with open(MATERIALS_PATH / "miscellaneous.json", encoding="utf-8") as f:
    MISC = json.load(f)