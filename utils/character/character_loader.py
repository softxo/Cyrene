from pathlib import Path
import json

DATA_DIR = Path("data")


def load_characters():
    characters = {}

    for file in (DATA_DIR / "characters").glob("*.json"):
        with open(file, encoding="utf-8") as f:
            data = json.load(f)

        characters[data["id"]] = data

    return characters


CHARACTERS = load_characters()
