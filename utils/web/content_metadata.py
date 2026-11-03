"""Explicit preview metadata for announced content absent from release catalogues."""

import json
from datetime import date, datetime, timezone
from pathlib import Path

CHARACTER_CONTENT_METADATA = json.loads(
    (Path(__file__).resolve().parents[2] / "data" / "character_content_metadata.json").read_text(
        encoding="utf-8"
    )
)


def character_content_metadata(
    name: str, release_date: str = "", *, today: date | None = None
) -> dict:
    metadata = CHARACTER_CONTENT_METADATA.get(name, {})
    release_date = metadata.get("release_date", release_date)
    current_date = today or datetime.now(timezone.utc).date()
    try:
        unreleased = date.fromisoformat(release_date) > current_date
    except ValueError:
        unreleased = bool(metadata.get("unreleased", False))
    return {"unreleased": unreleased, "release_date": release_date}
