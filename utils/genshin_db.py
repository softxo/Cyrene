"""Exact GenshinDB records with reviewed previews for missing announced content."""

import asyncio
import time
import unicodedata
from collections import OrderedDict

import aiohttp

from utils.web.preview_materials import matches_preview_materials, preview_entry

API_URL = "https://genshin-db-api.vercel.app/api/v5"
CACHE_SECONDS = 24 * 60 * 60
_cache: OrderedDict = OrderedDict()


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

    async def get(self, folder: str, name: str) -> dict:
        if folder not in {"characters", "talents", "weapons", "materials"}:
            raise ValueError("Unsupported GenshinDB folder.")
        preview = preview_entry(folder, name)
        if folder == "materials" and self.using_preview and preview:
            return preview
        key = (folder, name.strip().casefold())
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            if _same_name(name, str(cached[1].get("name", ""))) and (
                not preview
                or folder == "materials"
                or matches_preview_materials(cached[1], preview)
            ):
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
            if preview:
                self.using_preview = True
                return preview
            raise GenshinDBError("Couldn't load material data. Please try again.") from error

        if not isinstance(data, dict) or not data.get("name"):
            if preview:
                self.using_preview = True
                return preview
            raise GenshinDBError(f"Material data for {name} is unavailable.")

        if not _same_name(name, str(data["name"])):
            if preview:
                self.using_preview = True
                return preview
            raise GenshinDBIdentityError(
                "Exact material data for this character is not available yet."
            )

        if (
            preview
            and folder in {"characters", "talents"}
            and not matches_preview_materials(data, preview)
        ):
            self.using_preview = True
            return preview

        _cache[key] = (time.monotonic(), data)
        _cache.move_to_end(key)
        while len(_cache) > 2048:
            _cache.popitem(last=False)
        return data
