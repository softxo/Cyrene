"""Discover category artwork from the Wiki, including newly added categories."""

import asyncio
import json
import logging
import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

MANIFEST = Path(__file__).resolve().parents[2] / "data" / "achievement_category_icons.json"
WIKI_API = "https://genshin-impact.fandom.com/api.php"
_lock = asyncio.Lock()
_next_refresh = 0.0
_icons: dict[str, str] | None = None


def normalise_category(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.casefold())


def valid_icon_url(url: str) -> bool:
    parsed = urllib.parse.urlsplit(url)
    return (
        parsed.scheme == "https"
        and parsed.netloc == "static.wikia.nocookie.net"
        and parsed.path.startswith("/gensin-impact/images/")
        and urllib.parse.unquote(parsed.path).lower().endswith(".png")
        and not parsed.query
        and not parsed.fragment
    )


class WikiIconParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.icons: dict[str, str] = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag != "img" or not attrs.get("data-image-name", "").startswith("Achievement "):
            return
        url = attrs.get("data-src", attrs.get("src", "")).split("/revision/")[0]
        name = attrs.get("alt", "").removeprefix("Achievement ")
        if name and valid_icon_url(url):
            self.icons[normalise_category(name)] = url


def parse_category_icons(markup: str) -> dict[str, str]:
    parser = WikiIconParser()
    parser.feed(markup)
    return parser.icons


def _wiki_icons(page: str) -> dict[str, str]:
    query = urllib.parse.urlencode(
        {"action": "parse", "page": page, "prop": "text", "format": "json"}
    )
    request = urllib.request.Request(
        WIKI_API + "?" + query, headers={"User-Agent": "Cyrene achievement category icons"}
    )
    with urllib.request.urlopen(request, timeout=8) as response:
        markup = json.load(response)["parse"]["text"]["*"]
    return parse_category_icons(markup)


def refresh_category_icons(categories: list[str], existing: dict[str, str]) -> dict[str, str]:
    icons = {**existing, **_wiki_icons("Achievement")}
    # A category can appear before the index is updated. Its own Wiki page is a fallback.
    for category in categories:
        key = normalise_category(category)
        if key not in icons:
            try:
                page_icons = _wiki_icons(category)
                if key in page_icons:
                    icons[key] = page_icons[key]
                elif len(page_icons) == 1:
                    icons[key] = next(iter(page_icons.values()))
            except OSError, ValueError, KeyError:
                logging.getLogger(__name__).warning("Wiki category icon unavailable: %s", category)
    temporary = MANIFEST.with_suffix(".tmp")
    try:
        temporary.write_text(json.dumps(icons, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temporary.replace(MANIFEST)
    except OSError:
        logging.getLogger(__name__).warning("Could not persist Wiki category icons", exc_info=True)
    return icons


_refresh_task: asyncio.Task | None = None


async def _update_icons(categories: list[str]) -> None:
    global _icons, _next_refresh
    async with _lock:
        if time.monotonic() < _next_refresh:
            return
        try:
            _icons = await asyncio.to_thread(refresh_category_icons, categories, _icons)
            complete = all(normalise_category(category) in _icons for category in categories)
            _next_refresh = time.monotonic() + (21600 if complete else 900)
        except OSError, ValueError, KeyError:
            logging.getLogger(__name__).warning(
                "Wiki icon refresh failed; retaining existing icons", exc_info=True
            )
            _next_refresh = time.monotonic() + 900


async def load_category_icons(
    categories: list[str], *, wait_for_refresh: bool = True
) -> dict[str, str]:
    global _icons, _refresh_task
    if _icons is None:
        try:
            saved = json.loads(MANIFEST.read_text(encoding="utf-8"))
            _icons = {
                key: url
                for key, url in saved.items()
                if isinstance(url, str) and valid_icon_url(url)
            }
        except OSError, ValueError, AttributeError:
            _icons = {}
    if time.monotonic() >= _next_refresh:
        if wait_for_refresh:
            await _update_icons(categories)
        elif _refresh_task is None or _refresh_task.done():
            _refresh_task = asyncio.create_task(_update_icons(categories))
    return {category: _icons.get(normalise_category(category), "") for category in categories}
