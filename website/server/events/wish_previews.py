"""Public upcoming Wish schedules and artwork, merged with official calendar data."""

import asyncio
import json
import re
import time
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, unquote

import aiohttp

from shared.genshin_db import GenshinDB, GenshinDBError
from website.server.events.announcement_events import (
    SERVER_OFFSETS,
    TIME_TAG,
    normalise_name,
    plain_text,
    timestamp,
)
from website.server.events.quest_reward_details import (
    TableParser,
    image_url,
    localise_reward_images,
)
from website.server.events.wiki_event_details import HEADERS, MONTH_DATE, _page

_lock = asyncio.Lock()
_cache: dict[str, tuple[float, list[dict]]] = {}
WIKI = "https://genshin-impact.fandom.com/wiki/"


def clean_wish_title(value: str) -> str:
    title = plain_text(value)
    title = re.sub(r"^(?:Event\s+)+(?:Wishes|Wish)\s*", "", title, flags=re.I)
    return title.strip(' -:\u2014\u2013"\u201c\u201d')


@lru_cache(maxsize=1)
def _signature_catalogue(tags_version: int, icons_version: int) -> dict:
    root = Path(__file__).resolve().parents[3] / "data" / "metadata"
    tags = json.loads((root / "weapon_tags.json").read_text(encoding="utf-8"))["weapons"]
    icons = {
        str(item["id"]): item
        for item in json.loads((root / "weapon_scan_catalogue.json").read_text(encoding="utf-8"))
    }
    result = {}
    for weapon_id, weapon in tags.items():
        character = weapon.get("signature")
        icon = icons.get(weapon_id)
        if character and icon and icon["rarity"] == 5:
            result[normalise_name(character)] = {"name": weapon["name"], "icon": icon["icon"]}
    return result


def signature_wish_previews(banners: list[dict]) -> list[dict]:
    root = Path(__file__).resolve().parents[3] / "data" / "metadata"
    signatures = _signature_catalogue(
        (root / "weapon_tags.json").stat().st_mtime_ns,
        (root / "weapon_scan_catalogue.json").stat().st_mtime_ns,
    )
    result = []
    groups = {}
    for banner in banners:
        if banner.get("is_upcoming") and banner["banner_type"] in {301, 400}:
            groups.setdefault(banner["start_time"], []).append(banner)
        elif (
            banner.get("is_upcoming")
            and banner["banner_type"] == 500
            and banner.get("preview_kind") != "weapons"
        ):
            groups[(banner["start_time"], banner["banner_id"])] = [banner]
    for key, characters in groups.items():
        chronicled = isinstance(key, tuple)
        start = characters[0]["start_time"]
        if not chronicled and any(
            banner["banner_type"] == 302 and abs(banner["start_time"] - start) < 3600
            for banner in banners
        ):
            continue
        items = []
        for banner in characters:
            for item in banner["r5_up_items"]:
                weapon = signatures.get(normalise_name(item["name"]))
                if weapon and weapon not in items:
                    items.append(deepcopy(weapon))
        if chronicled and characters[0].get("chronicled_weapons"):
            items = deepcopy(characters[0]["chronicled_weapons"])
            for item in items:
                known = next(
                    (weapon for weapon in signatures.values() if weapon["name"] == item["name"]),
                    None,
                )
                if known:
                    item["icon"] = known["icon"]
        if not items or (not chronicled and len(items) != 2):
            continue
        result.append(
            {
                "banner_id": "signature-weapons:" + str(key),
                "banner_type": 500 if chronicled else 302,
                "preview_kind": "weapons",
                "title": characters[0]["title"] if chronicled else "Epitome Invocation",
                "is_upcoming": True,
                "start_time": start,
                "end_time": characters[0]["end_time"],
                "image": None,
                "r5_up_items": items,
                "r4_up_items": [],
                "preview_art": deepcopy(items),
            }
        )
    return result


def upcoming_pages(markup: str) -> list[tuple[str, int]]:
    """Read only the Upcoming section, never historical Wish tables."""
    section = re.search(r'id="Upcoming_Event_Wishes"(.*?)(?=<h[23]\b|$)', markup, re.S)
    if not section:
        return []
    parser = TableParser()
    parser.feed(section[1])
    result = []
    for row in parser.root.walk("tr"):
        text = row.text()
        kind = 500 if "Chronicled" in text else 302 if "Weapon" in text else 301
        for link in row.walk("a"):
            href = link.attrs.get("href", "")
            if not re.fullmatch(r"/wiki/[^?#]+/\d{4}-\d{2}-\d{2}", href):
                continue
            title = unquote(href.removeprefix("/wiki/")).replace("_", " ")
            if (title, kind) not in result:
                result.append((title, kind))
    return result[:12]


def parse_wish_preview(markup: str, title: str, kind: int, server: str, now: int) -> dict | None:
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
        zone = timezone(timedelta(hours=8 if "GMT+8" in text else SERVER_OFFSETS[server]))
        try:
            stamp = datetime.strptime(" ".join(match.groups()), "%B %d, %Y %H:%M")
            schedule[field] = int(stamp.replace(tzinfo=zone).timestamp())
        except ValueError:
            continue
    start = schedule.get("time_start", 0)
    if start <= now:
        return None
    for field in parser.root.walk():
        if field.attrs.get("data-source") == "type":
            if "Chronicled" in field.text():
                kind = 500
            elif "Weapon" in field.text():
                kind = 302
    stars = {5: [], 4: []}
    pools = list(parser.root.walk("table", css_class="wish-pool-table"))
    for table in pools[:1]:
        for card in table.walk(css_class="card-container"):
            quality = next(
                (
                    node
                    for node in card.walk()
                    if re.search(r"card-quality-[45](?: |$)", node.attrs.get("class", ""))
                ),
                None,
            )
            image = next(card.walk("img"), None)
            if quality is None or image is None:
                continue
            rarity = 5 if "card-quality-5" in quality.attrs["class"] else 4
            name = image.attrs.get("alt", "").replace("\xad", "").strip()
            icon = image_url(image)
            if not name or name.startswith("Unknown") or not icon:
                continue
            item = {"name": name, "icon": icon}
            if not any(existing["name"] == name for existing in stars[rarity]):
                stars[rarity].append(item)
    weapons = []
    if kind == 500 and len(pools) > 1:
        for card in pools[1].walk(css_class="card-container"):
            quality = next(card.walk(css_class="card-quality-5"), None)
            image = next(card.walk("img"), None)
            if quality is None or image is None:
                continue
            name, icon = image.attrs.get("alt", ""), image_url(image)
            if name and not name.startswith("Unknown") and icon:
                weapons.append({"name": name, "icon": icon})
    if not stars[5]:
        return None
    return {
        "banner_id": "wiki:" + title,
        "banner_type": kind,
        "title": title.rsplit("/", 1)[0],
        "image": None,
        "start_time": start,
        "end_time": schedule.get("time_end", 0),
        "r5_up_items": stars[5],
        "r4_up_items": stars[4],
        "chronicled_weapons": weapons,
        "is_upcoming": True,
        "schedule_source": WIKI + quote(title.replace(" ", "_"), safe="/"),
    }


async def _artwork(session: aiohttp.ClientSession, item: dict, kind: int) -> str:
    if kind == 302:
        return re.sub(r"/scale-to-width-down/\d+", "/scale-to-width-down/600", item["icon"])
    if kind == 500:
        try:
            character = await asyncio.wait_for(
                GenshinDB(session).get("characters", item["name"]), timeout=3
            )
            filename = (character.get("images") or {}).get("filename_gachaSlice")
            if isinstance(filename, str) and re.fullmatch(
                r"UI_Gacha_AvatarIcon_[A-Za-z0-9_]+", filename
            ):
                return f"https://enka.network/ui/{filename}.png"
        except GenshinDBError, aiohttp.ClientError, asyncio.TimeoutError, ValueError:
            pass
    titles = [item["name"]]
    for title in titles:
        markup = await _page(session, title)
        if not markup:
            continue
        parser = TableParser()
        parser.feed(markup)
        suffixes = [" Full Wish.png"]
        for suffix in suffixes:
            for image in parser.root.walk("img"):
                key = unquote(image.attrs.get("data-image-key", "")).replace("_", " ")
                if key.endswith(suffix) and (url := image_url(image)):
                    return re.sub(r"/scale-to-width-down/\d+", "/scale-to-width-down/900", url)
    return item["icon"]


async def wiki_wish_previews(server: str, now: int) -> list[dict]:
    async with _lock:
        cached = _cache.get(server)
        if cached and cached[0] > time.monotonic():
            return deepcopy([banner for banner in cached[1] if banner["start_time"] > now])
        result = []
        async with aiohttp.ClientSession(
            headers=HEADERS, timeout=aiohttp.ClientTimeout(total=8)
        ) as session:
            index = await _page(session, "Wish")
            if index:
                pages = upcoming_pages(index)
                details = await asyncio.gather(*(_page(session, title) for title, _ in pages))
                extra = []
                for markup in details:
                    if not markup:
                        continue
                    parser = TableParser()
                    parser.feed(markup)
                    for field in parser.root.walk():
                        if field.attrs.get("data-source") != "alongside":
                            continue
                        for link in field.walk("a"):
                            href = link.attrs.get("href", "")
                            if not re.fullmatch(r"/wiki/[^?#]+/\d{4}-\d{2}-\d{2}", href):
                                continue
                            title = unquote(href.removeprefix("/wiki/")).replace("_", " ")
                            if title not in {page[0] for page in pages + extra}:
                                extra.append(
                                    (title, 302 if title.startswith("Epitome Invocation/") else 301)
                                )
                extra = extra[:12]
                if extra:
                    details += await asyncio.gather(*(_page(session, title) for title, _ in extra))
                    pages += extra
                for (title, kind), markup in zip(pages, details):
                    preview = (
                        parse_wish_preview(markup, title, kind, server, now) if markup else None
                    )
                    if preview:
                        result.append(preview)
                targets = [(banner, item) for banner in result for item in banner["r5_up_items"]]
                artwork = await asyncio.gather(
                    *(_artwork(session, item, banner["banner_type"]) for banner, item in targets)
                )
                for (banner, item), url in zip(targets, artwork):
                    banner.setdefault("preview_art", []).append(dict(item, icon=url))
                entries = [
                    item
                    for banner in result
                    for item in banner.get("preview_art", [])
                    + banner["r5_up_items"]
                    + banner["r4_up_items"]
                ]
                await localise_reward_images({"rewards": entries})
            elif cached:
                result = [banner for banner in cached[1] if banner["start_time"] > now]
        _cache[server] = (time.monotonic() + (900 if result else 120), result)
        return deepcopy(result)


def matching_notice(banner: dict, announcements: list, server: str):
    names = [normalise_name(item["name"]) for item in banner["r5_up_items"]]
    for notice in announcements:
        subtitle = getattr(notice, "subtitle", "") or ""
        if not ("Wish" in subtitle or "Wish" in (getattr(notice, "title", "") or "")):
            continue
        content = normalise_name(getattr(notice, "content", "") or "")
        if not names or not all(name in content for name in names):
            continue
        raw_content = getattr(notice, "content", "") or ""
        dates = [timestamp(match, server) for match in TIME_TAG.finditer(raw_content)]
        date = datetime.fromtimestamp(
            banner["start_time"], timezone(timedelta(hours=SERVER_OFFSETS[server]))
        )
        dated = any(
            stamp is not None and abs(stamp - banner["start_time"]) < 3600 for stamp in dates
        )
        if (
            banner.get("is_upcoming")
            and not dated
            and not re.search(rf"{date.year}[/.-]{date.month:02d}[/.-]{date.day:02d}", raw_content)
        ):
            continue
        four_stars = [normalise_name(item["name"]) for item in banner["r4_up_items"]]
        if four_stars:
            if not all(name in content for name in four_stars):
                continue
        elif not re.search(r"4(?:[-\s]*star|\u2605)", raw_content, re.I):
            continue
        if getattr(notice, "banner", None):
            return notice
    return None


async def enrich_wish_previews(
    banners: list[dict], announcements: list, server: str, now: int
) -> None:
    previews = await wiki_wish_previews(server, now)
    for preview in previews:
        names = {normalise_name(item["name"]) for item in preview["r5_up_items"]}
        existing = next(
            (
                banner
                for banner in banners
                if banner["banner_type"] == preview["banner_type"]
                and abs(banner["start_time"] - preview["start_time"]) < 86400
                and names.issubset({normalise_name(item["name"]) for item in banner["r5_up_items"]})
            ),
            None,
        )
        if existing:
            existing["preview_art"] = preview.get("preview_art", [])
            existing["schedule_source"] = preview["schedule_source"]
            if not existing["r4_up_items"]:
                existing["r4_up_items"] = preview["r4_up_items"]
            existing["title"] = preview["title"]
            if not existing.get("chronicled_weapons"):
                existing["chronicled_weapons"] = preview.get("chronicled_weapons", [])
        else:
            banners.append(preview)
    for banner in banners:
        banner["is_upcoming"] = banner["start_time"] > now
    signature_previews = signature_wish_previews(banners)
    await localise_reward_images(
        {
            "rewards": [
                item
                for banner in signature_previews
                for item in banner["preview_art"] + banner["r5_up_items"]
            ]
        }
    )
    banners.extend(signature_previews)
    for banner in banners:
        banner["title"] = clean_wish_title(banner["title"])
        if not banner["is_upcoming"]:
            continue
        notice = matching_notice(banner, announcements, server)
        if notice:
            banner["image"] = notice.banner
        else:
            banner["image"] = None
            banner["r4_up_items"] = []
        if not banner.get("image") and not banner.get("preview_art"):
            async with aiohttp.ClientSession(
                headers=HEADERS, timeout=aiohttp.ClientTimeout(total=8)
            ) as session:
                banner["preview_art"] = [
                    dict(item, icon=await _artwork(session, item, banner["banner_type"]))
                    for item in banner["r5_up_items"]
                ]
    banners.sort(
        key=lambda banner: (banner["is_upcoming"], banner["start_time"], banner["banner_type"])
    )
