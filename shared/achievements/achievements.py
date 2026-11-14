import asyncio
import json
import logging
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

ACHIEVEMENTS_DIR = BASE_DIR / "data" / "achievements"


def load_achievements() -> list[dict]:
    if _catalogue is not None:
        return _catalogue
    achievements = []

    for file_path in sorted(ACHIEVEMENTS_DIR.glob("*.json")):
        with open(
            file_path,
            "r",
            encoding="utf-8",
        ) as file:
            data = json.load(file)

        achievements.extend(data.get("achievements", []))

    return achievements


_REFRESH_SECONDS = 6 * 60 * 60
_RETRY_SECONDS = 15 * 60
_catalogue: list[dict] | None = None
_next_refresh = 0.0
_refresh_lock = asyncio.Lock()
_SNAPSHOT = BASE_DIR / "data" / "achievement_catalogue_cache.json"


def _refresh_catalogue(fallback: list[dict]) -> list[dict]:
    from scripts.update_achievements import download_achievements, validate_achievement

    downloaded = download_achievements()
    if not downloaded or not all(
        isinstance(item, dict) and validate_achievement(item) for item in downloaded
    ):
        raise ValueError("Achievement refresh failed validation")
    old_ids = {tier for item in fallback for tier in item["id"]}
    new_ids = [tier for item in downloaded for tier in item["id"]]
    if len(new_ids) != len(set(new_ids)) or not old_ids.issubset(new_ids):
        raise ValueError(
            "Achievement refresh contains duplicate IDs or removes existing achievements"
        )
    temporary = _SNAPSHOT.with_suffix(".tmp")
    try:
        temporary.write_text(json.dumps({"achievements": downloaded}), encoding="utf-8")
        temporary.replace(_SNAPSHOT)
    except OSError:
        logging.getLogger(__name__).warning(
            "Could not persist achievement catalogue cache", exc_info=True
        )
    return downloaded


_refresh_task: asyncio.Task | None = None


def _load_cached_catalogue() -> None:
    global _catalogue, _next_refresh
    if _catalogue is not None:
        return
    _catalogue = load_achievements()
    try:
        snapshot = json.loads(_SNAPSHOT.read_text(encoding="utf-8"))["achievements"]
        from scripts.update_achievements import validate_achievement

        if (
            isinstance(snapshot, list)
            and snapshot
            and all(isinstance(item, dict) and validate_achievement(item) for item in snapshot)
            and {i for item in _catalogue for i in item["id"]}.issubset(
                {i for item in snapshot for i in item["id"]}
            )
        ):
            _catalogue = snapshot
            age = max(0, time.time() - _SNAPSHOT.stat().st_mtime)
            _next_refresh = time.monotonic() + max(0, _REFRESH_SECONDS - age)
    except OSError, ValueError, KeyError, TypeError:
        pass


async def _update_catalogue() -> None:
    global _catalogue, _next_refresh
    async with _refresh_lock:
        if time.monotonic() < _next_refresh:
            return
        try:
            _catalogue = await asyncio.to_thread(_refresh_catalogue, _catalogue)
            _next_refresh = time.monotonic() + _REFRESH_SECONDS
        except Exception:
            logging.getLogger(__name__).warning(
                "Achievement refresh failed; retaining the existing catalogue", exc_info=True
            )
            _next_refresh = time.monotonic() + _RETRY_SECONDS


async def load_current_achievements(*, wait_for_refresh: bool = True) -> list[dict]:
    """Page reads use saved data immediately; imports can await the latest catalogue."""
    global _refresh_task
    _load_cached_catalogue()
    if time.monotonic() >= _next_refresh:
        if wait_for_refresh:
            await _update_catalogue()
        elif _refresh_task is None or _refresh_task.done():
            _refresh_task = asyncio.create_task(_update_catalogue())
    return _catalogue
