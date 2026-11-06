"""Read current-edition event schedules and total rewards from the wiki index."""

import asyncio
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, unquote

import aiohttp

from utils.web.announcement_events import SERVER_OFFSETS, normalise_name
from utils.web.quest_reward_details import TableParser, localise_reward_images, parse_rewards

API_URL = "https://genshin-impact.fandom.com/api.php"
HEADERS = {"User-Agent": "Cyrene event preview reader", "Accept": "application/json,text/html"}
MONTH_DATE = r"[A-Z][a-z]+ \d{1,2}, \d{4}"
_cache: dict[str, tuple[float, str | None]] = {}
_lock = asyncio.Lock()
logger = logging.getLogger(__name__)


def event_page_from_index(markup: str, name: str, now: int) -> str | None:
    parser = TableParser()
    parser.feed(markup)
    for row in parser.root.walk("tr"):
        dates = re.findall(MONTH_DATE, row.text())
        if not dates:
            continue
        try:
            # Allow all server offsets at the end of the last displayed day.
            expiry = datetime.strptime(dates[-1], "%B %d, %Y").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if expiry.timestamp() + 2 * 86400 <= now:
            continue
        for link in row.walk("a"):
            href = link.attrs.get("href", "")
            if not href.startswith("/wiki/"):
                continue
            title = unquote(href.removeprefix("/wiki/")).split("#", 1)[0].replace("_", " ")
            base_name = re.sub(r"/\d{4}-\d{2}-\d{2}$", "", title).removesuffix(" (Event)")
            if normalise_name(base_name) == normalise_name(name):
                return title
    return None


def parse_event_details(markup: str, server: str, now: int) -> dict | None:
    if server not in SERVER_OFFSETS:
        return None
    parser = TableParser()
    parser.feed(markup)
    schedule = {}
    for cell in parser.root.walk("td"):
        field = cell.attrs.get("data-source")
        if field not in {"time_start", "time_end"}:
            continue
        text = cell.text()
        match = re.search(rf"({MONTH_DATE}) (\d{{2}}:\d{{2}})", text)
        if not match or not ("Server Time" in text or "GMT+8" in text):
            continue
        try:
            zone = timezone(timedelta(hours=8 if "GMT+8" in text else SERVER_OFFSETS[server]))
            date = datetime.strptime(" ".join(match.groups()), "%B %d, %Y %H:%M")
            schedule[field] = int(date.replace(tzinfo=zone).timestamp())
        except ValueError:
            continue
    start, end = schedule.get("time_start"), schedule.get("time_end")
    if start is None or end is None or not start < end or end + 59 <= now:
        return None
    # Only the explicit total is safe to sum; stage tables can repeat subtotals.
    totals = re.search(r'<h2\b[^>]*>.*?id="Total_Rewards".*?</h2>(.*?)(?=<h2\b|$)', markup, re.S)
    rewards = []
    if totals:
        reward_parser = TableParser()
        reward_parser.feed(totals[1])
        rewards = parse_rewards(reward_parser.root)
    return {"start_time": start, "end_time": end + 59, "rewards": rewards}


async def _page(session: aiohttp.ClientSession, title: str) -> str | None:
    cached = _cache.get(title)
    if cached and cached[0] > time.monotonic():
        return cached[1]
    result = None
    try:
        async with session.get(
            API_URL, params={"action": "parse", "page": title, "prop": "text", "format": "json"}
        ) as response:
            if response.status == 200:
                data = await response.json()
                result = data.get("parse", {}).get("text", {}).get("*", "") or None
    except aiohttp.ClientError, asyncio.TimeoutError, ValueError:
        logger.warning("Wiki event preview unavailable for %s", title)
    if len(_cache) >= 64:
        _cache.pop(next(iter(_cache)))
    _cache[title] = (time.monotonic() + (1800 if result else 300), result)
    return result


async def enrich_upcoming_events(events: list[dict], server: str, now: int) -> None:
    upcoming = [event for event in events if event.get("is_upcoming")]
    if not upcoming:
        return
    # Public session only: account cookies must never be sent to the wiki.
    async with (
        _lock,
        aiohttp.ClientSession(headers=HEADERS, timeout=aiohttp.ClientTimeout(total=8)) as session,
    ):
        index = await _page(session, "Event")
        if not index:
            return
        for event in upcoming:
            title = event_page_from_index(index, event["name"], now)
            if not title:
                continue
            markup = await _page(session, title)
            details = parse_event_details(markup, server, now) if markup else None
            if not details:
                continue
            if not event.get("start_time"):
                event["start_time"] = details["start_time"]
            if not event.get("end_time"):
                event["end_time"] = details["end_time"]
            event["is_unscheduled_upcoming"] = False
            event["is_upcoming"] = event["start_time"] > now
            event["opening_source"] = "https://genshin-impact.fandom.com/wiki/" + quote(
                title.replace(" ", "_"), safe="/"
            )
            if not event.get("rewards") and details["rewards"]:
                await localise_reward_images(details)
                event["rewards"] = details["rewards"]
                event["reward_source"] = event["opening_source"]
            if (
                normalise_name(event["name"]) == "ley line overflow"
                and not event.get("rewards")
                and "double the rewards" in markup
            ):
                event["rewards"] = [
                    {
                        "id": 202,
                        "name": "Mora",
                        "icon": "/static/images/events/reward-previews/202.png",
                        "amount": None,
                        "rarity": 3,
                    },
                    {
                        "id": "character-exp",
                        "name": "Character EXP materials",
                        "icon": "/static/images/events/reward-previews/104003.png",
                        "amount": None,
                        "rarity": 4,
                    },
                ]
                event["reward_source"] = event["opening_source"]
                event["reward_preview_note"] = (
                    "Double Mora or Character EXP material drops, up to three times each day. Material tiers and amounts depend on your World Level."
                )
