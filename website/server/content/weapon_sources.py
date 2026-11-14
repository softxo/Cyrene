"""Resolve released weapon acquisition sources from the public Wiki API."""

import asyncio
import logging
import re
import time
from datetime import date, datetime, timezone

import aiohttp

from shared.storage.database import get_pool

LOGGER = logging.getLogger(__name__)
API_URL = "https://genshin-impact.fandom.com/api.php"
RETRY_SECONDS = 6 * 60 * 60
SOURCES = {
    "events": "Event",
    "event": "Event",
    "wishes": "Gacha",
    "wish": "Gacha",
    "forging": "Craftable",
    "battle pass": "BP",
    "fishing association": "Fishing Association",
    "fishing": "Fishing Association",
    "chests": "Exploration",
    "quests": "Quest",
    "quest": "Quest",
    "promotional": "Promotional",
}
_sources: dict[int, str] = {}
_pending: dict[int, tuple[str, float]] = {}


def source_for(weapon_id: int) -> str | None:
    return _sources.get(weapon_id)


def enqueue(weapon_id: int, name: str) -> None:
    if weapon_id not in _sources and weapon_id not in _pending and name and len(name) <= 160:
        _pending[weapon_id] = (name, 0)


def parse_source(data: dict, weapon_id: int, name: str, today: date | None = None) -> str | None:
    if not isinstance(data, dict):
        return None
    parsed = data.get("parse", {})
    if not isinstance(parsed, dict) or not isinstance(parsed.get("title"), str):
        return None
    if parsed["title"].casefold() != name.casefold():
        return None
    wikitext = parsed.get("wikitext", {})
    text = wikitext.get("*", "") if isinstance(wikitext, dict) else ""
    if not isinstance(text, str):
        return None
    infobox = re.search(r"\{\{Weapon Infobox\s*\n(.*?)\n\}\}", text, re.S | re.I)
    if not infobox:
        return None
    pairs = re.findall(r"^\|\s*(id|obtain|releaseDate)\s*=\s*([^\n\r]*)", infobox[1], re.M | re.I)
    fields = {}
    for key, value in pairs:
        key = key.casefold()
        if key in fields:
            return None
        fields[key] = value.strip()
    if fields.get("id") != str(weapon_id):
        return None
    try:
        release_date = date.fromisoformat(fields.get("releasedate", ""))
    except ValueError:
        return None
    if release_date > (today or datetime.now(timezone.utc).date()):
        return None
    return SOURCES.get(fields.get("obtain", "").casefold())


async def initialise() -> None:
    async with get_pool().connection() as connection:
        await connection.execute(
            """CREATE TABLE IF NOT EXISTS weapon_wiki_sources (
                weapon_id BIGINT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL
            )"""
        )
        result = await connection.execute("SELECT weapon_id, source FROM weapon_wiki_sources")
        rows = await result.fetchall()
    _sources.update(
        {row["weapon_id"]: row["source"] for row in rows if row["source"] in SOURCES.values()}
    )
    for weapon_id in _sources:
        _pending.pop(weapon_id, None)


async def sync_pending(session: aiohttp.ClientSession) -> None:
    for weapon_id, (name, due) in list(_pending.items()):
        if due > time.monotonic():
            continue
        _pending[weapon_id] = (name, time.monotonic() + RETRY_SECONDS)
        try:
            async with session.get(
                API_URL,
                params={"action": "parse", "page": name, "prop": "wikitext", "format": "json"},
            ) as response:
                response.raise_for_status()
                data = await response.json()
            source = parse_source(data, weapon_id, name)
            if not source:
                continue
            async with get_pool().connection() as connection:
                await connection.execute(
                    """INSERT INTO weapon_wiki_sources (weapon_id, name, source) VALUES (%s,%s,%s)
                    ON CONFLICT (weapon_id) DO UPDATE SET name=EXCLUDED.name, source=EXCLUDED.source""",
                    (weapon_id, name, source),
                )
            _sources[weapon_id] = source
            _pending.pop(weapon_id, None)
        except aiohttp.ClientError, asyncio.TimeoutError, ValueError:
            LOGGER.warning("Wiki weapon source lookup failed for %s", name, exc_info=True)


async def worker() -> None:
    initialised = False
    while True:
        try:
            if not initialised:
                await initialise()
                initialised = True
            async with aiohttp.ClientSession(
                headers={
                    "User-Agent": "Cyrene weapon metadata reader",
                    "Accept": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=12),
            ) as session:
                await sync_pending(session)
        except Exception:
            LOGGER.exception("Wiki weapon source worker failed")
        await asyncio.sleep(60)
