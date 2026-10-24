from pathlib import Path
import json


DATA_FILE = Path("data/hoyolab/expedition_icons.json")


def load_expedition_icons() -> dict[str, str]:
    with open(
        DATA_FILE,
        encoding="utf-8"
    ) as file:
        return json.load(file)


EXPEDITION_ICONS = load_expedition_icons()