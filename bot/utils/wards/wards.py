import json
from pathlib import Path

from discord import app_commands

WARDS_PATH = Path("data/shields/wards.json")
WARD_CHOICES = ["Pyro", "Hydro", "Electro", "Cryo", "Dendro", "Geo", "Void", "Deepdark"]

with WARDS_PATH.open(encoding="utf-8") as f:
    WARDS = json.load(f)


def get_ward(ward_id: str):
    return WARDS.get(ward_id)


async def ward_autocomplete(interaction, current: str):
    return [
        app_commands.Choice(name=ward, value=ward.lower())
        for ward in WARD_CHOICES
        if current.lower() in ward.lower()
    ][:25]
