"""Cached, automatic Insight reward previews from the public wiki API.

HoYoverse notices remain authoritative for event availability. Wiki HTML is parsed
into a small data model; it is never rendered or executed in the application.
"""

import asyncio
import hashlib
import logging
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import quote, urlsplit
from uuid import uuid4

import aiohttp

from utils.web.announcement_events import normalise_name

API_URL = "https://genshin-impact.fandom.com/api.php"
_cache: OrderedDict = OrderedDict()
_lock = asyncio.Lock()
logger = logging.getLogger(__name__)
IMAGE_DIRECTORY = (
    Path(__file__).resolve().parents[2]
    / "website"
    / "static"
    / "images"
    / "events"
    / "quest-rewards"
)
IMAGE_URL_PREFIX = "/static/images/events/quest-rewards/"


def image_extension(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    return None


async def localise_reward_images(details: dict) -> None:
    """Serve images from Cyrene so browsers need no access to the wiki CDN."""
    entries = list(details.get("rewards", []))
    for insight in details.get("insight_rewards", []):
        entries.append(insight)
        entries.extend(insight.get("rewards", []))
    remote = {}
    for entry in entries:
        if normalise_name(entry.get("name", "")) in {"primogem", "primogems"}:
            entry["icon"] = "/static/images/misc/Primogem.webp"
            continue
        url = entry.get("icon", "")
        if url.startswith((IMAGE_URL_PREFIX, "/static/cache/quest-rewards/")):
            filename = url.rsplit("/", 1)[-1]
            if (
                re.fullmatch(r"[0-9a-f]{64}\.(?:webp|png|jpg|gif)", filename)
                and (IMAGE_DIRECTORY / filename).is_file()
            ):
                entry["icon"] = IMAGE_URL_PREFIX + filename
                continue
            url = entry.get("source_icon", "")
        parsed = urlsplit(url)
        if parsed.scheme == "https" and parsed.hostname == "static.wikia.nocookie.net":
            entry["source_icon"] = url
            remote.setdefault(url, []).append(entry)
    if not remote:
        return
    try:
        IMAGE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    except OSError:
        logger.warning("Quest reward image cache is not writable")
        return
    limit = asyncio.Semaphore(4)
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:

        async def cache_image(url, targets):
            digest = hashlib.sha256(url.encode()).hexdigest()
            for extension in (".webp", ".png", ".jpg", ".gif"):
                if (IMAGE_DIRECTORY / (digest + extension)).is_file():
                    for target in targets:
                        target["icon"] = f"{IMAGE_URL_PREFIX}{digest}{extension}"
                    return
            temporary = None
            try:
                async with limit:
                    async with session.get(url, allow_redirects=False) as response:
                        response.raise_for_status()
                        if response.status != 200:
                            return
                        data = bytearray()
                        async for chunk in response.content.iter_chunked(65536):
                            data.extend(chunk)
                            if len(data) > 2 * 1024 * 1024:
                                return
                extension = image_extension(data)
                if not extension:
                    return
                name = digest + extension
                temporary = IMAGE_DIRECTORY / f"{digest}-{uuid4().hex}.tmp"
                temporary.write_bytes(data)
                temporary.replace(IMAGE_DIRECTORY / name)
                for target in targets:
                    target["icon"] = IMAGE_URL_PREFIX + name
            except aiohttp.ClientError, asyncio.TimeoutError, OSError:
                logger.warning("Quest reward image unavailable: %s", digest)
            finally:
                if temporary and temporary.exists():
                    temporary.unlink(missing_ok=True)

        await asyncio.gather(*(cache_image(url, targets) for url, targets in remote.items()))


@dataclass
class Node:
    tag: str
    attrs: dict = field(default_factory=dict)
    children: list = field(default_factory=list)

    def walk(self, tag=None, css_class=None):
        for child in self.children:
            if isinstance(child, Node):
                if (tag is None or child.tag == tag) and (
                    css_class is None or css_class in child.attrs.get("class", "").split()
                ):
                    yield child
                yield from child.walk(tag, css_class)

    def text(self):
        return " ".join(
            child.text() if isinstance(child, Node) else child for child in self.children
        ).strip()


class TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, dict(attrs))
        self.stack[-1].children.append(node)
        if tag not in {"img", "br", "hr", "input", "meta", "link", "source", "wbr"}:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def image_url(image):
    value = image.attrs.get("data-src") or image.attrs.get("src", "")
    url = urlsplit(value)
    return value if url.scheme == "https" and url.hostname == "static.wikia.nocookie.net" else None


def parse_rewards(cell):
    result = []
    for card in cell.walk(css_class="card-container"):
        image = next(card.walk("img"), None)
        amount = next(card.walk(css_class="card-text"), None)
        if image is None or amount is None or not image_url(image):
            continue
        count = amount.text().replace(",", "").strip()
        if not count.isdecimal():
            continue
        quality = next(
            (
                re.search(r"card-quality-(\d)", node.attrs.get("class", ""))
                for node in card.walk()
                if "card-quality-" in node.attrs.get("class", "")
            ),
            None,
        )
        name = image.attrs.get("alt", "")
        result.append(
            {
                "id": name,
                "name": name,
                "icon": image_url(image),
                "amount": int(count),
                "rarity": int(quality[1]) if quality else 0,
                "homepage_show": False,
            }
        )
    return result


def parse_quest_reward_table(markup: str, event_name: str) -> dict | None:
    parser = TableParser()
    parser.feed(markup)
    for table in parser.root.walk("table"):
        if "Archon Quest Rewards" not in table.text() or "Insight Rewards" not in table.text():
            continue
        main, insights, section = [], [], None
        for row in table.walk("tr"):
            headers = list(row.walk("th"))
            if headers:
                heading = " ".join(header.text() for header in headers)
                section = (
                    "main"
                    if heading == "Archon Quest Rewards"
                    else "insight"
                    if heading == "Insight Rewards"
                    else None
                )
                continue
            cells = [
                child for child in row.children if isinstance(child, Node) and child.tag == "td"
            ]
            if len(cells) != 3:
                continue
            rewards = parse_rewards(cells[2])
            task = next(cells[1].walk("a"), None)
            if (
                section == "main"
                and task
                and normalise_name(task.text()) == normalise_name(event_name)
            ):
                main.extend(
                    reward
                    for reward in rewards
                    if normalise_name(reward["name"]) in {"primogem", "primogems"}
                )
            elif section == "insight":
                portrait = next(cells[0].walk("img"), None)
                character = next(cells[0].walk("a"), None)
                if portrait and character and image_url(portrait) and rewards:
                    insights.append(
                        {
                            "character": character.attrs.get("title")
                            or portrait.attrs.get("alt", "").removesuffix(" Icon"),
                            "icon": image_url(portrait),
                            "task": task.text() if task else "Insight Rewards",
                            "rewards": rewards,
                        }
                    )
        if main and insights:
            return {"rewards": main, "insight_rewards": insights}
    return None


async def get_quest_reward_details(name: str) -> dict | None:
    key = normalise_name(name)
    async with _lock:
        cached = _cache.get(key)
        if cached and time.monotonic() < cached[0]:
            _cache.move_to_end(key)
            if cached[1]:
                await localise_reward_images(cached[1])
            return cached[1]
        result = None
        try:
            # Separate public session: account cookies must never go to the wiki.
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as session:
                for title in (f"{name} (Event)", name):
                    async with session.get(
                        API_URL,
                        params={
                            "action": "parse",
                            "page": title,
                            "prop": "text",
                            "format": "json",
                            "redirects": "1",
                        },
                    ) as response:
                        response.raise_for_status()
                        data = await response.json()
                    markup = data.get("parse", {}).get("text", {}).get("*", "")
                    result = parse_quest_reward_table(markup, name)
                    if result:
                        result["reward_source"] = "https://genshin-impact.fandom.com/wiki/" + quote(
                            title.replace(" ", "_"), safe=""
                        )
                        break
        except aiohttp.ClientError, asyncio.TimeoutError, ValueError, KeyError:
            logger.warning("Quest reward preview unavailable for %s", name)
        if result is None and cached:
            result = cached[1]
            ttl = 300
        else:
            ttl = 21600 if result else 300
        if result:
            await localise_reward_images(result)
        _cache[key] = (time.monotonic() + ttl, result)
        _cache.move_to_end(key)
        while len(_cache) > 64:
            _cache.popitem(last=False)
        return result


async def enrich_quest_rewards(events: list[dict]) -> None:
    for event in events:
        # Notes can supply completion before enrichment runs. Reward previews are
        # shared event information, independent of an account's progress source.
        if event.get("category") == "Quest" and (
            event.get("progress_available") is False
            or event.get("completion_source") == "archon_quest_notes"
        ):
            details = await get_quest_reward_details(event["name"])
            if details:
                event.update(details)
