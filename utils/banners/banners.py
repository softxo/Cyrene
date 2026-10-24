import json
from pathlib import Path


BANNER_FILE = Path("data/banners/banners.json")


def load_banner():
    if not BANNER_FILE.exists():
        raise FileNotFoundError(
            f"Banner data file not found: {BANNER_FILE}"
        )

    with BANNER_FILE.open("r", encoding="utf-8") as file:
        return json.load(file)


BANNER = load_banner()


def get_current_banner():
    return BANNER