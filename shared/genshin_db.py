import asyncio
import re
import time
import unicodedata
from collections import OrderedDict

import aiohttp

API_URL = "https://genshin-db-api.vercel.app/api/v5"
RAW_URL = "https://raw.githubusercontent.com/theBowja/genshin-db/main/src/data/English"
IMAGE_URL = "https://raw.githubusercontent.com/theBowja/genshin-db/main/src/data/image"
MATERIAL_ICON_URL = "https://gi.yatta.moe/assets/UI/{filename}.png"

CACHE_SECONDS = 24 * 60 * 60
MAX_CACHED_RECORDS = 2048
MAX_SLUG_LENGTH = 160
REQUEST_TIMEOUT_SECONDS = 15
MAX_CONCURRENT_REQUESTS = 6

SUPPORTED_FOLDERS = {"characters", "talents", "weapons", "materials"}
FOLDERS_WITH_IMAGES = {"materials", "weapons"}

FETCH_ERRORS = (aiohttp.ClientError, asyncio.TimeoutError, ValueError)

_cache: OrderedDict = OrderedDict()
_image_cache: dict = {}


class GenshinDBError(Exception):
    pass


class GenshinDBIdentityError(GenshinDBError):
    pass


def _normalise_name(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value).casefold()

    return "".join(char for char in decomposed if char.isalnum())


def _same_name(requested: str, returned: str) -> bool:
    return _normalise_name(requested) == _normalise_name(returned)


def _slug(name: str) -> str:
    decomposed = unicodedata.normalize("NFKD", name).casefold()

    return "".join(char for char in decomposed if char.isascii() and char.isalnum())


def _is_fresh(cached_at: float) -> bool:
    return time.monotonic() - cached_at < CACHE_SECONDS


def _with_material_icon(images: dict) -> dict:
    images = dict(images)
    filename = images.get("filename_icon")

    if isinstance(filename, str) and re.fullmatch(r"UI_ItemIcon_[0-9]+", filename):
        images["icon"] = MATERIAL_ICON_URL.format(filename=filename)

    return images


def _remember(key: tuple, data: dict) -> None:
    _cache[key] = (time.monotonic(), data)
    _cache.move_to_end(key)

    while len(_cache) > MAX_CACHED_RECORDS:
        _cache.popitem(last=False)


def _cached_record(key: tuple, name: str) -> dict | None:
    cached = _cache.get(key)

    if not cached or not _is_fresh(cached[0]):
        return None

    data = cached[1]

    if _same_name(name, str(data.get("name", ""))):
        _cache.move_to_end(key)

        return data

    del _cache[key]

    return None


class GenshinDB:
    def __init__(self, session: aiohttp.ClientSession):
        self.session = session
        self.limit = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)
        self.using_preview = False
        self._preview_materials = {}
        self._released_source = False

    async def _fetch_json(self, url: str, *, params: dict | None = None, strict_type=False):
        options = {"timeout": aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_SECONDS)}

        if params is not None:
            options = {"params": params, **options}

        async with self.limit:
            async with self.session.get(url, **options) as response:
                response.raise_for_status()

                if strict_type:
                    return await response.json()

                return await response.json(content_type=None)

    async def _upstream_images(self, folder: str) -> dict:
        cached = _image_cache.get(folder)

        if cached and _is_fresh(cached[0]):
            return cached[1]

        try:
            data = await self._fetch_json(f"{IMAGE_URL}/{folder}.json")
        except FETCH_ERRORS:
            return {}

        if not isinstance(data, dict):
            return {}

        _image_cache[folder] = (time.monotonic(), data)

        return data

    async def _attach_images(self, folder: str, slug: str, data: dict) -> None:
        images = (await self._upstream_images(folder)).get(slug, {})

        if not isinstance(images, dict):
            return

        if folder == "materials":
            data["images"] = _with_material_icon(images)
        else:
            data["images"] = dict(images)

    async def _upstream_record(self, folder: str, name: str) -> dict | None:
        slug = _slug(name)

        if not slug or len(slug) > MAX_SLUG_LENGTH:
            return None

        try:
            data = await self._fetch_json(f"{RAW_URL}/{folder}/{slug}.json")
        except FETCH_ERRORS:
            return None

        if not isinstance(data, dict) or not _same_name(name, str(data.get("name", ""))):
            return None

        if folder in FOLDERS_WITH_IMAGES:
            await self._attach_images(folder, slug, data)

        return data

    def _retained_preview(self, kind: str, name: str) -> dict | None:
        from shared.previews.sync import preview as retained_preview

        retained = retained_preview(kind, name) if kind != "materials" else None

        if not retained and kind == "weapons":
            from shared.previews.legacy import legacy_weapon

            retained = legacy_weapon(name)

        return retained

    def _use_preview(self, retained: dict, folder: str) -> dict:
        self.using_preview = True
        self._preview_materials = {
            item["name"].casefold(): item for item in retained["materials"].values()
        }

        return retained[folder]

    async def _query_api(self, folder: str, name: str):
        return await self._fetch_json(
            f"{API_URL}/{folder}",
            params={
                "query": name,
                "resultLanguage": "English",
                "queryLanguages": "English",
                "matchCategories": "false",
            },
            strict_type=True,
        )

    async def get(self, folder: str, name: str) -> dict:
        if folder not in SUPPORTED_FOLDERS:
            raise ValueError("Unsupported GenshinDB folder.")

        from shared.previews.sync import released_entity

        if folder == "materials" and self._preview_materials:
            material = self._preview_materials.get(name.casefold())

            if material:
                return material

        kind = "characters" if folder in {"characters", "talents"} else folder

        if released_entity(kind, name):
            self._released_source = True

        if self._released_source:
            upstream = await self._upstream_record(folder, name)

            if upstream:
                return upstream

        retained = self._retained_preview(kind, name)

        if retained and folder in retained:
            return self._use_preview(retained, folder)

        key = (folder, name.strip().casefold())
        cached = _cached_record(key, name)

        if cached is not None:
            return cached

        try:
            data = await self._query_api(folder, name)
        except FETCH_ERRORS as error:
            upstream = await self._upstream_record(folder, name)

            if upstream:
                return upstream

            raise GenshinDBError("Couldn't load material data. Please try again.") from error

        if not isinstance(data, dict) or not data.get("name"):
            upstream = await self._upstream_record(folder, name)

            if upstream:
                return upstream

            raise GenshinDBError(f"Material data for {name} is unavailable.")

        if not _same_name(name, str(data["name"])):
            upstream = await self._upstream_record(folder, name)

            if upstream:
                return upstream

            raise GenshinDBIdentityError(
                "Exact material data for this character is not available yet."
            )

        _remember(key, data)

        return data
