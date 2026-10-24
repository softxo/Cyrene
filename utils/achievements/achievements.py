import json
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]

ACHIEVEMENTS_DIR = (
    BASE_DIR
    / "data"
    / "achievements"
)


def load_achievements() -> list[dict]:
    achievements = []

    for file_path in sorted(ACHIEVEMENTS_DIR.glob("*.json")):
        with open(
            file_path,
            "r",
            encoding="utf-8",
        ) as file:
            data = json.load(file)

        achievements.extend(
            data.get("achievements", [])
        )

    return achievements