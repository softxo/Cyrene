import json
from pathlib import Path

WARDS_PATH = Path("data/shields/wards.json")

with WARDS_PATH.open(encoding="utf-8") as f:
    WARDS = json.load(f)


def get_ward(ward_id: str):
    return WARDS.get(ward_id)