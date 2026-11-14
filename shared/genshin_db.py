"""Exact GenshinDB records with reviewed previews for missing announced content."""

import asyncio
import re
import time
import unicodedata
from collections import OrderedDict

import aiohttp

API_URL = "https://genshin-db-api.vercel.app/api/v5"
RAW_URL = "https://raw.githubusercontent.com/theBowja/genshin-db/main/src/data/English"
CACHE_SECONDS = 24 * 60 * 60
_cache: OrderedDict = OrderedDict()
_image_cache: dict = {}
IMAGE_URL = "https://raw.githubusercontent.com/theBowja/genshin-db/main/src/data/image"


class GenshinDBError(Exception):
    """A catalogue entry could not be retrieved or understood."""


class GenshinDBIdentityError(GenshinDBError):
    """The provider returned a different entity for a fuzzy name query."""


def _same_name(requested: str, returned: str) -> bool:
    def normalise(value):
        return "".join(
            char for char in unicodedata.normalize("NFKD", value).casefold() if char.isalnum()
        )

    return normalise(requested) == normalise(returned)


class GenshinDB:
    def __init__(self, session: aiohttp.ClientSession):
        self.session = session
        self.limit = asyncio.Semaphore(6)
        self.using_preview = False
        self._preview_materials = {}
        self._released_source = False

    async def _upstream_images(self, folder: str) -> dict:
        cached = _image_cache.get(folder)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            return cached[1]
        try:
            async with self.limit:
                async with self.session.get(
                    f"{IMAGE_URL}/{folder}.json", timeout=aiohttp.ClientTimeout(total=15)
                ) as response:
                    response.raise_for_status()
                    data = await response.json(content_type=None)
        except aiohttp.ClientError, asyncio.TimeoutError, ValueError:
            return {}
        if not isinstance(data, dict):
            return {}
        _image_cache[folder] = (time.monotonic(), data)
        return data

    async def _upstream_record(self, folder: str, name: str) -> dict | None:
        slug = "".join(
            char
            for char in unicodedata.normalize("NFKD", name).casefold()
            if char.isascii() and char.isalnum()
        )
        if not slug or len(slug) > 160:
            return None
        try:
            async with self.limit:
                async with self.session.get(
                    f"{RAW_URL}/{folder}/{slug}.json",
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    response.raise_for_status()
                    data = await response.json(content_type=None)
        except aiohttp.ClientError, asyncio.TimeoutError, ValueError:
            return None
        if isinstance(data, dict) and _same_name(name, str(data.get("name", ""))):
            if folder in {"materials", "weapons"}:
                images = (await self._upstream_images(folder)).get(slug, {})
                if isinstance(images, dict):
                    images = dict(images)
                    filename = images.get("filename_icon")
                    if (
                        folder == "materials"
                        and isinstance(filename, str)
                        and re.fullmatch(r"UI_ItemIcon_[0-9]+", filename)
                    ):
                        images["icon"] = f"https://gi.yatta.moe/assets/UI/{filename}.png"
                    data["images"] = images
            return data
        return None

    async def get(self, folder: str, name: str) -> dict:
        if folder not in {"characters", "talents", "weapons", "materials"}:
            raise ValueError("Unsupported GenshinDB folder.")
        from shared.previews.sync import preview as retained_preview
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
        retained = retained_preview(kind, name) if kind != "materials" else None
        if not retained and kind == "weapons":
            from shared.previews.legacy import legacy_weapon

            retained = legacy_weapon(name)
        if retained and folder in retained:
            self.using_preview = True
            self._preview_materials = {
                item["name"].casefold(): item for item in retained["materials"].values()
            }
            return retained[folder]
        key = (folder, name.strip().casefold())
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            if _same_name(name, str(cached[1].get("name", ""))):
                _cache.move_to_end(key)
                return cached[1]
            del _cache[key]

        try:
            async with self.limit:
                async with self.session.get(
                    f"{API_URL}/{folder}",
                    params={
                        "query": name,
                        "resultLanguage": "English",
                        "queryLanguages": "English",
                        "matchCategories": "false",
                    },
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as response:
                    response.raise_for_status()
                    data = await response.json()
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as error:
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

        _cache[key] = (time.monotonic(), data)
        _cache.move_to_end(key)
        while len(_cache) > 2048:
            _cache.popitem(last=False)
        return data
