import json
import re
from pathlib import Path


ENEMIES_PATH = Path("data/enemy_groups/elite/elite_groups.json")


def load_enemies():
    with open(
        ENEMIES_PATH,
        encoding="utf-8"
    ) as f:
        groups = json.load(f)

    enemies = {}

    for group_name, group in groups.items():
        for enemy_id, enemy_data in group.get("enemies", {}).items():
            enemy_data["category"] = "elite"
            enemies[enemy_id] = enemy_data

    return enemies


def normalise(text: str) -> str:
    return re.sub(r"[\s_-]", "", text.casefold())

ENEMIES = load_enemies()


def get_enemy(query: str):
    query = normalise(query)

    for enemy_id, enemy in ENEMIES.items():

        if normalise(enemy_id) == query:
            return enemy

        if normalise(enemy["name"]) == query:
            return enemy

        if any(
            normalise(alias) == query
            for alias in enemy.get("aliases", [])
        ):
            return enemy

    return None