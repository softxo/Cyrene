import json
from pathlib import Path

from discord import app_commands

DATA_DIR = Path("data")


def load_characters():
    characters = {}

    for file in (DATA_DIR / "characters").glob("*.json"):
        with open(file, encoding="utf-8") as f:
            data = json.load(f)

        characters[data["id"]] = data

    return characters


CHARACTERS = load_characters()


def get_character(character_id: str):
    return CHARACTERS.get(character_id.lower())


def search_characters(query: str):
    results = []

    for char_id, data in CHARACTERS.items():
        if query.lower() in data["name"].lower():
            results.append(char_id)

    return results[:25]


async def character_autocomplete(interaction, current: str):
    choices = []

    for char_id in search_characters(current):
        choices.append(app_commands.Choice(name=CHARACTERS[char_id]["name"], value=char_id))

    return choices
