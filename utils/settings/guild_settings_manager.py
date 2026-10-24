import json
from pathlib import Path

SETTINGS_FILE = Path("data/misc/settings/guild_settings.json")


def load_settings():
    if not SETTINGS_FILE.exists():
        return {}

    with SETTINGS_FILE.open("r", encoding="utf-8") as f:
        return json.load(f)

settings = load_settings()

def save_settings():
    SETTINGS_FILE.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    with SETTINGS_FILE.open("w", encoding="utf-8") as f:
        json.dump(
            settings,
            f,
            indent=4
        )

def get_guild_settings(guild_id):
    return settings.setdefault(
        str(guild_id),
        {}
    )