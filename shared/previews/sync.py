"""Persistent Gachabase previews and verified release handovers."""

import asyncio
import json
import logging
import re
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

import aiohttp
from psycopg.types.json import Jsonb

from shared.previews.gachabase import GachabaseFormatError, extract_costs
from shared.storage.database import get_pool

LOGGER = logging.getLogger(__name__)
BASE = "https://gi.gachabase.net"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; Cyrene/1.0)"}
INTERVAL = 6 * 60 * 60
_seed_path = Path(__file__).resolve().parents[2] / "data" / "previews" / "gachabase_seed.json"
_seed_records = json.loads(_seed_path.read_text(encoding="utf-8"))
_seeds = {
    (entry["kind"], entry["data"][entry["kind"]]["name"].casefold()): entry["data"]
    for entry in _seed_records
}
_previews = deepcopy(_seeds)
_released = set()
_released_catalogue = {}


def preview(kind, name):
    return deepcopy(_previews.get((kind, name.casefold())))


def released_entity(kind, name):
    return (kind, name.casefold()) in _released


def released_catalogue(kind):
    return [
        deepcopy(value) for (category, _), value in _released_catalogue.items() if category == kind
    ]


def catalogue(kind):
    return [deepcopy(value) for (category, _), value in _previews.items() if category == kind]


def signature_for(weapon_id):
    """Match an unambiguous five-star beta weapon and character by weapon type."""
    released = next(
        (item for item in _released_catalogue.values() if item.get("id") == weapon_id), None
    )
    if released:
        return released.get("signature")
    weapons = [
        entry["weapons"]
        for (kind, _), entry in _previews.items()
        if kind == "weapons" and not entry.get("release_confirmed")
    ]
    weapon = next((item for item in weapons if item.get("id") == weapon_id), None)
    if not weapon or weapon.get("rarity") != 5 or not weapon.get("weapon_type_id"):
        return None
    weapon_type = weapon["weapon_type_id"]
    candidates = [
        entry["characters"]
        for (kind, _), entry in _previews.items()
        if kind == "characters"
        and not entry.get("release_confirmed")
        and entry["characters"].get("rarity") == 5
        and entry["characters"].get("weapon_type_id") == weapon_type
    ]
    matching_weapons = [
        item
        for item in weapons
        if item.get("rarity") == 5 and item.get("weapon_type_id") == weapon_type
    ]
    if len(candidates) == len(matching_weapons) == 1:
        return candidates[0].get("name")
    return None


async def initialise():
    async with get_pool().connection() as connection:
        await connection.execute("""CREATE TABLE IF NOT EXISTS gachabase_previews (
            kind TEXT NOT NULL, entity_id BIGINT NOT NULL, name TEXT NOT NULL,
            slug TEXT NOT NULL, data JSONB, released BOOLEAN NOT NULL DEFAULT FALSE,
            next_check TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (kind, entity_id))""")
    await refresh()


async def refresh():
    global _previews, _released, _released_catalogue
    async with get_pool().connection() as connection:
        result = await connection.execute("SELECT kind,name,data,released FROM gachabase_previews")
        rows = await result.fetchall()
    stored = {
        (row["kind"], row["name"].casefold()): row["data"]
        for row in rows
        if not row["released"] and row["data"] is not None
    }
    _released = {(row["kind"], row["name"].casefold()) for row in rows if row["released"]}
    _previews = {key: deepcopy(data) for key, data in _seeds.items() if key not in _released}
    _previews.update(stored)
    _released_catalogue = {
        (row["kind"], row["name"].casefold()): row["data"]
        for row in rows
        if row["released"] and row["data"] is not None
    }


async def _fetch(session, path):
    async with session.get(
        urljoin(BASE, path), headers=HEADERS, timeout=aiohttp.ClientTimeout(total=25)
    ) as response:
        response.raise_for_status()
        return await response.text()


def _entities(html):
    matches = re.findall(r'href="/(characters|weapons)/(\d+)/([a-z0-9-]+)/beta(?:\?[^" ]*)?"', html)
    return list(dict.fromkeys((kind, int(entity_id), slug) for kind, entity_id, slug in matches))


def _name(html, entity_id):
    import json

    match = re.search(
        rf'dto:\{{id:{entity_id},[^{{}}]*?name:\{{key:"[^"\\]*",text:("(?:\\.|[^"\\])*")', html
    )
    if not match:
        raise GachabaseFormatError("Missing exact entity identity")
    return json.loads(match.group(1))


async def _image_available(session, url):
    try:
        async with session.head(url, timeout=aiohttp.ClientTimeout(total=15)) as response:
            return response.status == 200 and response.content_type.startswith("image/")
    except aiohttp.ClientError, asyncio.TimeoutError, ValueError:
        return False


async def _released_records(session, kind, entity_id, name):
    from shared.genshin_db import GenshinDB

    db = GenshinDB(session)
    folders = ("characters", "talents") if kind == "characters" else ("weapons",)
    records = {}
    for folder in folders:
        item = await db._upstream_record(folder, name)
        if not item or (folder != "talents" and item.get("id") != entity_id):
            return False
        records[folder] = item
    if kind == "characters":
        from genshin.models.genshin.constants import CHARACTER_NAMES

        character = CHARACTER_NAMES.get("en-us", {}).get(entity_id)
        if character is None or character.name.casefold() != name.casefold():
            return False
        icon_name = getattr(character, "icon_name", "")
        if not re.fullmatch(r"[A-Za-z0-9_]+", icon_name):
            return False
        if not await _image_available(
            session, f"https://enka.network/ui/UI_AvatarIcon_{icon_name}.png"
        ):
            return False
    elif (
        not records[kind]
        .get("images", {})
        .get("mihoyo_icon", "")
        .startswith("https://upload-os-bbs.mihoyo.com/")
    ):
        return False
    if kind == "weapons" and not await _image_available(
        session, records[kind]["images"]["mihoyo_icon"]
    ):
        return False
    if kind == "weapons" and (
        records[kind].get("weaponText") not in {"Sword", "Claymore", "Polearm", "Bow", "Catalyst"}
        or str(records[kind].get("rarity")) not in {"1", "2", "3", "4", "5"}
    ):
        return False
    costs = [records[kind].get("costs", {})]
    if kind == "characters":
        talent = records["talents"]
        costs.extend(
            talent.get(f"combat{i}", {}).get("costs", talent.get("costs", {})) for i in range(1, 4)
        )
    material_ids = {}
    for index, steps in enumerate(costs):
        prefix, count, start = ("ascend", 6, 1) if index == 0 else ("lvl", 10, 2)
        for level in range(start, count + 1):
            entries = steps.get(f"{prefix}{level}")
            if not isinstance(entries, list) or not entries:
                return False
            for entry in entries:
                if (
                    not isinstance(entry, dict)
                    or not isinstance(entry.get("id"), int)
                    or not isinstance(entry.get("name"), str)
                    or not isinstance(entry.get("count"), int)
                    or entry["count"] <= 0
                ):
                    return False
                old = material_ids.setdefault(entry["id"], entry["name"])
                if old.casefold() != entry["name"].casefold():
                    return False

    async def valid(material_id, material_name):
        data = await db._upstream_record("materials", material_name)
        if not data or data.get("id") != material_id or not data.get("images", {}).get("icon"):
            return False
        async with db.limit:
            return await _image_available(session, data["images"]["icon"])

    return all(await asyncio.gather(*(valid(key, value) for key, value in material_ids.items())))


async def _check(session, kind, entity_id, slug, previous):
    path = f"/{kind}/{entity_id}/{slug}"
    try:
        released = await _fetch(session, path + "/release?lang=en")
    except aiohttp.ClientResponseError as error:
        if error.status != 404:
            raise
        released = None
    if released and 'version:{branch:"release"}' in released:
        name = _name(released, entity_id)
        if await _released_records(session, kind, entity_id, name):
            return name, None, True
        if previous and previous["data"]:
            data = deepcopy(previous["data"])
            data["release_confirmed"] = True
            return previous["name"], data, False
    beta = await _fetch(session, path + "/beta?lang=en")
    name = _name(beta, entity_id)
    data = extract_costs(beta, name, entity_id, kind)
    from shared.genshin_db import GenshinDB

    db = GenshinDB(session)

    async def verify_material(item):
        released_material = await db._upstream_record("materials", item["name"])
        item["inventory_unavailable"] = (
            not released_material or released_material.get("id") != item["id"]
        )

    await asyncio.gather(*(verify_material(item) for item in data["materials"].values()))
    data["release_confirmed"] = bool(released)
    return name, data, False


async def sync_once(session):
    await initialise()
    signatures = {
        entry["weapons"]["id"]: signature_for(entry["weapons"]["id"])
        for entry in catalogue("weapons")
    }
    html = await _fetch(session, "/changelog/beta?lang=en")
    entities = _entities(html)
    if not entities:
        raise GachabaseFormatError("No beta entities found in changelog")
    async with get_pool().connection() as connection:
        result = await connection.execute(
            "SELECT kind,entity_id,name,slug,data,released,next_check FROM gachabase_previews"
        )
        rows = await result.fetchall()
    known = {(row["kind"], row["entity_id"]): row for row in rows}
    for row in rows:
        if not row["released"]:
            entity = (row["kind"], row["entity_id"], row["slug"])
            if entity not in entities:
                entities.append(entity)
    now = datetime.now(timezone.utc)
    for kind, entity_id, slug in entities:
        previous = known.get((kind, entity_id))
        if previous and (previous["released"] or previous["next_check"] > now):
            continue
        try:
            name, data, released = await _check(session, kind, entity_id, slug, previous)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError, KeyError) as error:
            LOGGER.warning("Gachabase preview check failed for %s %s: %s", kind, entity_id, error)
            if previous:
                async with get_pool().connection() as connection:
                    await connection.execute(
                        "UPDATE gachabase_previews SET next_check=%s WHERE kind=%s AND entity_id=%s",
                        (now + timedelta(seconds=INTERVAL), kind, entity_id),
                    )
            continue
        if released and kind == "weapons":
            from shared.genshin_db import GenshinDB

            record = await GenshinDB(session)._upstream_record("weapons", name)
            if not record:
                continue
            data = {
                "id": record["id"],
                "name": record["name"],
                "rarity": int(record["rarity"]),
                "type": record["weaponText"],
                "icon": record["images"]["mihoyo_icon"],
            }
            signature = signatures.get(entity_id) or signature_for(entity_id)
            if signature:
                data["signature"] = signature
        async with get_pool().connection() as connection:
            await connection.execute(
                """INSERT INTO gachabase_previews(kind,entity_id,name,slug,data,released,next_check)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT(kind,entity_id) DO UPDATE SET name=EXCLUDED.name,slug=EXCLUDED.slug,
                data=EXCLUDED.data,released=EXCLUDED.released,next_check=EXCLUDED.next_check
                WHERE NOT gachabase_previews.released""",
                (
                    kind,
                    entity_id,
                    name,
                    slug,
                    Jsonb(data) if data else None,
                    released,
                    now + timedelta(seconds=INTERVAL),
                ),
            )
        await refresh()
    await refresh()


async def worker():
    while True:
        try:
            async with aiohttp.ClientSession(max_field_size=65536) as session:
                await sync_once(session)
        except aiohttp.ClientResponseError as error:
            if error.status == 403:
                LOGGER.warning(
                    "Gachabase rejected the sync request (HTTP 403); saved and bundled "
                    "previews remain available. The next attempt is in six hours."
                )
            else:
                LOGGER.exception("Gachabase sync failed")
        except Exception:
            LOGGER.exception("Gachabase sync failed")
        await asyncio.sleep(INTERVAL)
