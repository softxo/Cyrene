"""Shared, cached access to the public GenshinDB v5 catalogue."""

import asyncio
import time
from collections import OrderedDict

import aiohttp

API_URL = "https://genshin-db-api.vercel.app/api/v5"
CACHE_SECONDS = 24 * 60 * 60
_cache: OrderedDict = OrderedDict()


class GenshinDBError(Exception):
    """A catalogue entry could not be retrieved or understood."""


class GenshinDB:
    def __init__(self, session: aiohttp.ClientSession):
        self.session = session
        self.limit = asyncio.Semaphore(6)

    async def get(self, folder: str, name: str) -> dict:
        if folder not in {"characters", "talents", "weapons", "materials"}:
            raise ValueError("Unsupported GenshinDB folder.")
        key = (folder, name.strip().casefold())
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < CACHE_SECONDS:
            _cache.move_to_end(key)
            return cached[1]

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
            raise GenshinDBError("Couldn't load material data. Please try again.") from error

        if not isinstance(data, dict) or not data.get("name"):
            raise GenshinDBError(f"Material data for {name} is unavailable.")

        _cache[key] = (time.monotonic(), data)
        _cache.move_to_end(key)
        while len(_cache) > 2048:
            _cache.popitem(last=False)
        return data
