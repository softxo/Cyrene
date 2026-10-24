import json
import time
from pathlib import Path

import requests


BASE_DIR = Path(__file__).resolve().parents[2]

ACHIEVEMENTS_DIR = (
    BASE_DIR
    / "data"
    / "achievements"
)

API_URL = (
    "https://genshin-db-api.vercel.app/api/v5/achievements"
)


def lookup_achievement(name: str):

    response = requests.get(
        API_URL,
        params={
            "query": name,
            "dumpResult": "true",
            "queryLanguages": "English",
            "resultLanguage": "English",
        },
        timeout=15,
    )

    response.raise_for_status()

    data = response.json()

    result = data.get("result")

    if not isinstance(result, dict):
        return None

    ids = result.get("id")

    if not isinstance(ids, list):
        return None

    return ids


def process_file(path: Path):

    print()
    print("=" * 60)
    print(f"FILE: {path.name}")
    print("=" * 60)

    with path.open(
        "r",
        encoding="utf-8",
    ) as file:
        data = json.load(file)

    achievements = data.get(
        "achievements",
        []
    )

    matched = 0
    unmatched = 0
    already_mapped = 0

    for achievement in achievements:

        name = achievement.get("name")

        if not name:
            continue

        existing_ids = achievement.get(
            "genshin_ids"
        )

        if existing_ids:
            already_mapped += 1
            print(
                f"[SKIP] {name}"
                f" → already has IDs"
            )
            continue

        try:

            ids = lookup_achievement(name)

        except Exception as error:

            print(
                f"[ERROR] {name}"
            )
            print(
                f"        {type(error).__name__}: "
                f"{error}"
            )

            unmatched += 1
            continue

        if not ids:

            print(
                f"[MISS] {name}"
            )

            unmatched += 1
            continue

        achievement["genshin_ids"] = ids

        matched += 1

        print(
            f"[MATCH] {name}"
        )
        print(
            f"        → {ids}"
        )

        time.sleep(0.1)

    with path.open(
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            data,
            file,
            indent=2,
            ensure_ascii=False,
        )

        file.write("\n")

    print()
    print(
        f"Matched:       {matched}"
    )
    print(
        f"Unmatched:     {unmatched}"
    )
    print(
        f"Already mapped: {already_mapped}"
    )


def main():

    files = [
        path
        for path in ACHIEVEMENTS_DIR.glob("*.json")
        if path.name != "test_export.json"
    ]

    print(
        f"Found {len(files)} achievement files."
    )

    for path in files:
        process_file(path)


if __name__ == "__main__":
    main()