"""Season-specific elements and opening cast from the public Theater wiki."""

import asyncio
import logging
import re
import time
from collections import OrderedDict
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

import aiohttp

from utils.web.announcement_events import SERVER_OFFSETS
from utils.web.quest_reward_details import TableParser, image_url, localise_reward_images

API_URL = "https://genshin-impact.fandom.com/api.php"
ELEMENTS = {"Pyro", "Hydro", "Anemo", "Electro", "Dendro", "Cryo", "Geo"}
_cache = OrderedDict()
_lock = asyncio.Lock()
logger = logging.getLogger(__name__)


class ElementParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.elements = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        value = attrs.get("alt") if tag == "img" else attrs.get("title") if tag == "a" else None
        if value in ELEMENTS and value not in self.elements:
            self.elements.append(value)


def parse_theater_elements(markup: str) -> tuple[str, ...]:
    # Read only the allowed elements, excluding opening cast, guests and enemies.
    section = re.search(
        r'id=["\']Alternate_Cast_Elements["\'][\s\S]*?</h[1-6]\s*>([\s\S]*?)(?=<h[1-6]\b|$)',
        markup,
        re.I,
    )
    if not section:
        return ()
    parser = ElementParser()
    parser.feed(section[1])
    return tuple(parser.elements) if len(parser.elements) == 3 else ()


def parse_opening_cast(markup: str) -> list[dict]:
    section = re.search(
        r'id=["\']Opening_Characters["\'][\s\S]*?</h[1-6]\s*>([\s\S]*?)(?=<h[1-6]\b|$)',
        markup,
        re.I,
    )
    if not section:
        return []
    parser = TableParser()
    parser.feed(section[1])
    cast = []
    seen = set()
    for card in parser.root.walk(css_class="card-container"):
        portrait = next(card.walk(css_class="card-image-container"), None)
        label = next(card.walk(css_class="card-text"), None)
        if portrait is None or label is None:
            continue
        image = next(portrait.walk("img"), None)
        icon = image_url(image) if image else None
        name = label.text().strip()
        classes = portrait.attrs.get("class", "")
        rarity = re.search(r"\bcard-quality-([45])\b", classes)
        element = re.search(r"\bcard-element-([a-z]+)\b", classes)
        if not name or name in seen or not icon or not rarity:
            continue
        seen.add(name)
        cast.append(
            {
                "name": name,
                "icon": icon,
                "rarity": int(rarity[1]),
                "element": element[1].capitalize()
                if element and element[1].capitalize() in ELEMENTS
                else None,
            }
        )
    return cast if len(cast) == 6 else []


def season_page(start_time: int, server: str) -> str | None:
    if not start_time or server not in SERVER_OFFSETS:
        return None
    date = datetime.fromtimestamp(
        int(start_time), timezone(timedelta(hours=SERVER_OFFSETS[server]))
    )
    return f"Imaginarium Theater/Seasons/{date:%Y-%m-%d}"


async def get_theater_season(start_time: int, server: str) -> dict:
    page = season_page(start_time, server)
    if page is None:
        return {"elements": [], "opening_cast": []}
    async with _lock:
        cached = _cache.get(page)
        if cached and cached[0] > time.monotonic():
            return deepcopy(cached[1])
        elements = ()
        cast = []
        try:
            # Public session only: never reuse an authenticated HoYoLAB client.
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as session:
                async with session.get(
                    API_URL,
                    params={
                        "action": "parse",
                        "page": page,
                        "prop": "text",
                        "format": "json",
                        "redirects": "1",
                    },
                ) as response:
                    response.raise_for_status()
                    data = await response.json()
                markup = data.get("parse", {}).get("text", {}).get("*", "")
                elements = parse_theater_elements(markup)
                cast = parse_opening_cast(markup)
        except aiohttp.ClientError, asyncio.TimeoutError, ValueError, TypeError, AttributeError:
            logger.warning("Imaginarium Theater season unavailable for %s", page)
        # Retry unavailable pages soon; keep verified results only for this exact season.
        ttl = 21600 if elements and cast else 300
        if cached:
            elements = elements or cached[1]["elements"]
            cast = cast or cached[1]["opening_cast"]
        if cast:
            await localise_reward_images({"rewards": cast})
        details = {"elements": list(elements), "opening_cast": cast}
        _cache[page] = (time.monotonic() + ttl, details)
        _cache.move_to_end(page)
        while len(_cache) > 12:
            _cache.popitem(last=False)
        return deepcopy(details)


async def get_theater_elements(start_time: int, server: str) -> list[str]:
    return (await get_theater_season(start_time, server))["elements"]
