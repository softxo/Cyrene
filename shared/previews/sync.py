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
PAGE_TIMEOUT_SECONDS = 25
IMAGE_TIMEOUT_SECONDS = 15
MAX_FIELD_SIZE = 65536

ENKA_AVATAR_ICON_URL = "https://enka.network/ui/UI_AvatarIcon_{icon_name}.png"
MIHOYO_UPLOAD_PREFIX = "https://upload-os-bbs.mihoyo.com/"

WEAPON_TYPES = {"Sword", "Claymore", "Polearm", "Bow", "Catalyst"}
WEAPON_RARITIES = {"1", "2", "3", "4", "5"}

CHECK_ERRORS = (aiohttp.ClientError, asyncio.TimeoutError, ValueError, KeyError)

ENTITY_LINK_PATTERN = re.compile(
    r'href="/(characters|weapons)/(\d+)/([a-z0-9-]+)/beta(?:\?[^" ]*)?"'
)

_seed_path = Path(__file__).resolve().parents[2] / "data" / "previews" / "gachabase_seed.json"
_seed_records = json.loads(_seed_path.read_text(encoding="utf-8"))

_seeds = {
    (entry["kind"], entry["data"][entry["kind"]]["name"].casefold()): entry["data"]
    for entry in _seed_records
}

_previews = deepcopy(_seeds)
_released = set()
_released_catalogue = {}


def _entity_key(kind, name):
    return (kind, name.casefold())


def _next_check(now):
    return now + timedelta(seconds=INTERVAL)


def preview(kind, name):
    return deepcopy(_previews.get(_entity_key(kind, name)))


def released_entity(kind, name):
    return _entity_key(kind, name) in _released


def released_catalogue(kind):
    return [
        deepcopy(value) for (category, _), value in _released_catalogue.items() if category == kind
    ]


def catalogue(kind):
    return [deepcopy(value) for (category, _), value in _previews.items() if category == kind]


def _unconfirmed_previews(kind):
    return [
        entry[kind]
        for (category, _), entry in _previews.items()
        if category == kind and not entry.get("release_confirmed")
    ]


def _is_five_star_of_type(item, weapon_type):
    return item.get("rarity") == 5 and item.get("weapon_type_id") == weapon_type


def signature_for(weapon_id):
    for item in _released_catalogue.values():
        if item.get("id") == weapon_id:
            return item.get("signature")

    weapons = _unconfirmed_previews("weapons")
    weapon = next((item for item in weapons if item.get("id") == weapon_id), None)

    if not weapon or weapon.get("rarity") != 5 or not weapon.get("weapon_type_id"):
        return None

    weapon_type = weapon["weapon_type_id"]

    candidates = [
        character
        for character in _unconfirmed_previews("characters")
        if _is_five_star_of_type(character, weapon_type)
    ]
    matching_weapons = [item for item in weapons if _is_five_star_of_type(item, weapon_type)]

    if len(candidates) == len(matching_weapons) == 1:
        return candidates[0].get("name")

    return None


async def initialise():
    async with get_pool().connection() as connection:
        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS gachabase_previews (
                kind TEXT NOT NULL,
                entity_id BIGINT NOT NULL,
                name TEXT NOT NULL,
                slug TEXT NOT NULL,
                data JSONB,
                released BOOLEAN NOT NULL DEFAULT FALSE,
                next_check TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (kind, entity_id)
            )
            """
        )

    await refresh()


async def refresh():
    global _previews, _released, _released_catalogue

    async with get_pool().connection() as connection:
        result = await connection.execute("SELECT kind,name,data,released FROM gachabase_previews")
        rows = await result.fetchall()

    stored = {
        _entity_key(row["kind"], row["name"]): row["data"]
        for row in rows
        if not row["released"] and row["data"] is not None
    }

    _released = {_entity_key(row["kind"], row["name"]) for row in rows if row["released"]}

    _previews = {key: deepcopy(data) for key, data in _seeds.items() if key not in _released}
    _previews.update(stored)

    _released_catalogue = {
        _entity_key(row["kind"], row["name"]): row["data"]
        for row in rows
        if row["released"] and row["data"] is not None
    }


async def _fetch(session, path):
    async with session.get(
        urljoin(BASE, path),
        headers=HEADERS,
        timeout=aiohttp.ClientTimeout(total=PAGE_TIMEOUT_SECONDS),
    ) as response:
        response.raise_for_status()

        return await response.text()


def _entities(html):
    matches = ENTITY_LINK_PATTERN.findall(html)
    entities = ((kind, int(entity_id), slug) for kind, entity_id, slug in matches)

    return list(dict.fromkeys(entities))


def _name(html, entity_id):
    match = re.search(
        rf'dto:\{{id:{entity_id},[^{{}}]*?name:\{{key:"[^"\\]*",text:("(?:\\.|[^"\\])*")',
        html,
    )

    if not match:
        raise GachabaseFormatError("Missing exact entity identity")

    return json.loads(match.group(1))


async def _image_available(session, url):
    try:
        async with session.head(
            url,
            timeout=aiohttp.ClientTimeout(total=IMAGE_TIMEOUT_SECONDS),
        ) as response:
            return response.status == 200 and response.content_type.startswith("image/")
    except aiohttp.ClientError, asyncio.TimeoutError, ValueError:
        return False


async def _upstream_records(db, kind, entity_id, name):
    folders = ("characters", "talents") if kind == "characters" else ("weapons",)
    records = {}

    for folder in folders:
        item = await db._upstream_record(folder, name)

        if not item:
            return None

        if folder != "talents" and item.get("id") != entity_id:
            return None

        records[folder] = item

    return records


async def _character_icon_released(session, entity_id, name):
    from genshin.models.genshin.constants import CHARACTER_NAMES

    character = CHARACTER_NAMES.get("en-us", {}).get(entity_id)

    if character is None or character.name.casefold() != name.casefold():
        return False

    icon_name = getattr(character, "icon_name", "")

    if not re.fullmatch(r"[A-Za-z0-9_]+", icon_name):
        return False

    return await _image_available(session, ENKA_AVATAR_ICON_URL.format(icon_name=icon_name))


async def _weapon_record_released(session, weapon):
    icon = weapon.get("images", {}).get("mihoyo_icon", "")

    if not icon.startswith(MIHOYO_UPLOAD_PREFIX):
        return False

    if not await _image_available(session, weapon["images"]["mihoyo_icon"]):
        return False

    if weapon.get("weaponText") not in WEAPON_TYPES:
        return False

    return str(weapon.get("rarity")) in WEAPON_RARITIES


def _cost_tables(kind, records):
    costs = [records[kind].get("costs", {})]

    if kind == "characters":
        talent = records["talents"]
        fallback = talent.get("costs", {})

        for index in range(1, 4):
            costs.append(talent.get(f"combat{index}", {}).get("costs", fallback))

    return costs


def _is_valid_cost_entry(entry):
    return (
        isinstance(entry, dict)
        and isinstance(entry.get("id"), int)
        and isinstance(entry.get("name"), str)
        and isinstance(entry.get("count"), int)
        and entry["count"] > 0
    )


def _collect_material_ids(costs):
    material_ids = {}

    for index, steps in enumerate(costs):
        prefix, count, start = ("ascend", 6, 1) if index == 0 else ("lvl", 10, 2)

        for level in range(start, count + 1):
            entries = steps.get(f"{prefix}{level}")

            if not isinstance(entries, list) or not entries:
                return None

            for entry in entries:
                if not _is_valid_cost_entry(entry):
                    return None

                known_name = material_ids.setdefault(entry["id"], entry["name"])

                if known_name.casefold() != entry["name"].casefold():
                    return None

    return material_ids


async def _material_released(session, db, material_id, material_name):
    data = await db._upstream_record("materials", material_name)

    if not data or data.get("id") != material_id or not data.get("images", {}).get("icon"):
        return False

    async with db.limit:
        return await _image_available(session, data["images"]["icon"])


async def _released_records(session, kind, entity_id, name):
    from shared.genshin_db import GenshinDB

    db = GenshinDB(session)
    records = await _upstream_records(db, kind, entity_id, name)

    if records is None:
        return False

    if kind == "characters":
        if not await _character_icon_released(session, entity_id, name):
            return False
    elif not await _weapon_record_released(session, records[kind]):
        return False

    material_ids = _collect_material_ids(_cost_tables(kind, records))

    if material_ids is None:
        return False

    checks = (
        _material_released(session, db, material_id, material_name)
        for material_id, material_name in material_ids.items()
    )

    return all(await asyncio.gather(*checks))


async def _fetch_release_page(session, path):
    try:
        return await _fetch(session, path + "/release?lang=en")
    except aiohttp.ClientResponseError as error:
        if error.status != 404:
            raise

        return None


async def _mark_unavailable_materials(session, materials):
    from shared.genshin_db import GenshinDB

    db = GenshinDB(session)

    async def verify_material(item):
        released_material = await db._upstream_record("materials", item["name"])
        item["inventory_unavailable"] = (
            not released_material or released_material.get("id") != item["id"]
        )

    await asyncio.gather(*(verify_material(item) for item in materials.values()))


async def _check(session, kind, entity_id, slug, previous):
    path = f"/{kind}/{entity_id}/{slug}"
    released = await _fetch_release_page(session, path)

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

    await _mark_unavailable_materials(session, data["materials"])
    data["release_confirmed"] = bool(released)

    return name, data, False


async def _stored_previews():
    async with get_pool().connection() as connection:
        result = await connection.execute(
            "SELECT kind,entity_id,name,slug,data,released,next_check FROM gachabase_previews"
        )

        return await result.fetchall()


def _seed_slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")


def _entities_to_check(entities, rows, known):
    for row in rows:
        if row["released"]:
            continue

        entity = (row["kind"], row["entity_id"], row["slug"])

        if entity not in entities:
            entities.append(entity)

    listed = {(kind, entity_id) for kind, entity_id, _ in entities}

    for (kind, _), entry in _seeds.items():
        entity_id = entry[kind]["id"]

        if (kind, entity_id) in listed or (kind, entity_id) in known:
            continue

        entities.append((kind, entity_id, _seed_slug(entry[kind]["name"])))
        listed.add((kind, entity_id))

    return entities


async def _postpone_check(kind, entity_id, now):
    async with get_pool().connection() as connection:
        await connection.execute(
            "UPDATE gachabase_previews SET next_check=%s WHERE kind=%s AND entity_id=%s",
            (_next_check(now), kind, entity_id),
        )


async def _released_weapon_entry(session, name, entity_id, signatures):
    from shared.genshin_db import GenshinDB

    record = await GenshinDB(session)._upstream_record("weapons", name)

    if not record:
        return None

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

    return data


async def _save_preview(kind, entity_id, name, slug, data, released, now):
    async with get_pool().connection() as connection:
        await connection.execute(
            """
            INSERT INTO gachabase_previews(kind,entity_id,name,slug,data,released,next_check)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(kind, entity_id) DO UPDATE SET
                name = EXCLUDED.name,
                slug = EXCLUDED.slug,
                data = EXCLUDED.data,
                released = EXCLUDED.released,
                next_check = EXCLUDED.next_check
            WHERE NOT gachabase_previews.released
            """,
            (
                kind,
                entity_id,
                name,
                slug,
                Jsonb(data) if data else None,
                released,
                _next_check(now),
            ),
        )


def _is_due(previous, now):
    if not previous:
        return True

    return not previous["released"] and previous["next_check"] <= now


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

    rows = await _stored_previews()
    known = {(row["kind"], row["entity_id"]): row for row in rows}
    entities = _entities_to_check(entities, rows, known)

    now = datetime.now(timezone.utc)

    for kind, entity_id, slug in entities:
        previous = known.get((kind, entity_id))

        if not _is_due(previous, now):
            continue

        try:
            name, data, released = await _check(session, kind, entity_id, slug, previous)
        except CHECK_ERRORS as error:
            LOGGER.warning("Gachabase preview check failed for %s %s: %s", kind, entity_id, error)

            if previous:
                await _postpone_check(kind, entity_id, now)

            continue

        if released and kind == "weapons":
            data = await _released_weapon_entry(session, name, entity_id, signatures)

            if data is None:
                continue

        await _save_preview(kind, entity_id, name, slug, data, released, now)
        await refresh()

    await refresh()


async def worker():
    while True:
        try:
            async with aiohttp.ClientSession(max_field_size=MAX_FIELD_SIZE) as session:
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
