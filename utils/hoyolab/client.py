import asyncio
import uuid
from collections.abc import Awaitable, Callable

import aiohttp
import genshin

from .auth import HoYoLABCredentials


class RedemptionAuthenticationError(RuntimeError):
    """Redemption requires the account to be reconnected."""


class HoYoLABClient:
    BASE_URL = "https://bbs-api-os.hoyolab.com"
    CALCULATOR_BASE_URL = "https://sg-act-public-api.hoyolab.com/event/e20200928calculate"

    def __init__(
        self,
        credentials: HoYoLABCredentials,
        *,
        on_cookie_token_update: (Callable[[str], Awaitable[None]] | None) = None,
    ):
        self.credentials = credentials
        self.on_cookie_token_update = on_cookie_token_update
        self.session: aiohttp.ClientSession | None = None
        self.genshin_client: genshin.Client | None = None
        self.calculator_device_id = str(uuid.uuid4())

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            cookies=self.credentials.as_cookies(),
            headers={
                "User-Agent": (
                    "Mozilla/5.0 "
                    "(Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 "
                    "(KHTML, like Gecko) "
                    "Chrome/149.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json, text/plain, */*",
            },
        )

        cookies = self.credentials.as_cookies()

        self.genshin_client = genshin.Client(
            cookies=cookies,
            game=genshin.types.Game.GENSHIN,
        )

        return self

    async def __aexit__(self, exc_type, exc, tb):
        if self.session:
            await self.session.close()

        self.genshin_client = None

    async def get_game_roles(self) -> dict:
        if self.session is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        url = "https://api-account-os.hoyolab.com/account/binding/api/getUserGameRolesByCookieToken"

        async with self.session.get(url) as response:
            response.raise_for_status()
            return await response.json()

    async def get_genshin_daily_note(self, genshin_uid: str, genshin_server: str) -> dict:
        if self.session is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        url = "https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote"

        params = {"role_id": genshin_uid, "server": genshin_server}

        async with self.session.get(url, params=params) as response:
            response.raise_for_status()

            return await response.json()

    async def get_genshin_notes(self) -> dict:
        if self.session is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        return await self.get_genshin_daily_note(self.genshin_uid, self.genshin_server)

    async def redeem_genshin_code(self, code: str) -> None:
        """Redeem a Genshin Impact gift code for this account."""
        if self.genshin_client is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        async def redeem() -> None:
            await self.genshin_client.redeem_code(
                code=code,
                uid=int(self.genshin_uid),
                game=genshin.types.Game.GENSHIN,
                region=self.genshin_server,
            )

        try:
            await redeem()
        except genshin.errors.InvalidCookies as exc:
            mid = self.credentials.ltmid_v2 or self.credentials.account_mid_v2
            if not self.credentials.stoken or not mid:
                raise RedemptionAuthenticationError(
                    "The gift-code login has expired and this account "
                    "has no saved refresh credentials. Reconnect the "
                    "account; manual cookie login also needs an stoken "
                    "to enable automatic refresh."
                ) from exc

            refresh_cookies = self.credentials.as_cookies()
            refresh_cookies["ltmid_v2"] = mid
            try:
                refreshed = await genshin.fetch_cookie_with_stoken_v2(
                    refresh_cookies,
                    token_types=[4],
                )
            except genshin.errors.InvalidCookies as refresh_error:
                raise RedemptionAuthenticationError(
                    "HoYoLAB rejected the saved refresh credentials. "
                    "Reconnect the account to restore gift-code redemption."
                ) from refresh_error
            cookie_token = refreshed.get("cookie_token_v2")

            if not cookie_token:
                raise RedemptionAuthenticationError(
                    "HoYoLAB did not return a replacement gift-code login. Reconnect the account."
                ) from exc

            self.credentials.cookie_token_v2 = cookie_token
            self.genshin_client.set_cookies(self.credentials.as_cookies())

            if self.on_cookie_token_update is not None:
                await self.on_cookie_token_update(cookie_token)

            try:
                await redeem()
            except genshin.errors.InvalidCookies as retry_error:
                raise RedemptionAuthenticationError(
                    "HoYoLAB rejected the refreshed gift-code login. Reconnect the account."
                ) from retry_error

    async def get_stygian_onslaught(self) -> list:
        if self.genshin_client is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        return await self.genshin_client.get_stygian_onslaught(raw=True)

    async def get_imaginarium_theater(self) -> dict:
        if self.genshin_client is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        return await self.genshin_client.get_imaginarium_theater(raw=True)

    async def get_genshin_spiral_abyss(self):
        if self.genshin_client is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        return await self.genshin_client.get_genshin_spiral_abyss()

    async def get_genshin_banners(self):
        client = genshin.Client(
            cookies=self.credentials.as_cookies(), game=genshin.types.Game.GENSHIN
        )

        return await client.get_banner_details()

    async def get_genshin_banner_ids(self):
        client = genshin.Client(
            cookies=self.credentials.as_cookies(), game=genshin.types.Game.GENSHIN
        )

        return await client.get_genshin_banner_ids()

    async def get_genshin_announcements(self):
        client = genshin.Client(
            cookies=self.credentials.as_cookies(), game=genshin.types.Game.GENSHIN
        )

        return await client.get_genshin_announcements(uid=int(self.genshin_uid), lang="en-us")

    async def get_genshin_banner_announcements(self) -> list[dict]:
        if self.session is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        url = (
            "https://sg-hk4e-api-static.hoyoverse.com/"
            "common/hk4e_global/announcement/api/getAnnContent"
        )

        params = {
            "game": "hk4e",
            "game_biz": "hk4e_global",
            "region": "os_asia",
            "bundle_id": "hk4e_global",
            "channel_id": "1",
            "level": "55",
            "platform": "pc",
            "lang": "en-us",
            "uid": "100000000",
        }

        async with self.session.get(url, params=params) as response:
            response.raise_for_status()

            data = await response.json()

        if data.get("retcode") not in (None, 0):
            raise RuntimeError(f"HoYoLAB announcement API failed: {data.get('message')}")

        return data.get("data", {}).get("list", [])

    async def get_genshin_banner_names(self):
        client = genshin.Client(
            cookies=self.credentials.as_cookies(), game=genshin.types.Game.GENSHIN
        )

        return await client.get_genshin_banner_names()

    async def get_genshin_event_calendar(self):
        if self.session is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        client = genshin.Client(
            cookies=self.credentials.as_cookies(),
            game=genshin.types.Game.GENSHIN,
        )

        return await client.get_genshin_event_calendar(
            uid=self.genshin_uid,
        )

    async def get_genshin_characters(self):
        """Retrieve the character roster from the account's Battle Chronicle."""
        if self.genshin_client is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        return await self.genshin_client.get_genshin_characters(
            uid=int(self.genshin_uid),
            lang="en-us",
        )

    async def get_genshin_detailed_characters(
        self,
        characters: list[int] | None = None,
    ):
        """Retrieve detailed Battle Chronicle data for the account's characters."""
        if self.genshin_client is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        return await self.genshin_client.get_genshin_detailed_characters(
            uid=int(self.genshin_uid),
            characters=characters,
            lang="en-us",
        )

    async def _post_calculator(
        self,
        path: str,
        payload: dict,
    ) -> dict:
        """POST to the HoYoLAB Enhancement Progression Calculator."""
        if self.session is None:
            raise RuntimeError("HoYoLABClient must be used with 'async with'.")

        headers = {
            "Content-Type": "application/json;charset=UTF-8",
            "Origin": "https://act.hoyolab.com",
            "Referer": ("https://act.hoyolab.com/ys/event/calculator-sea/index.html"),
            "x-rpc-device_id": self.calculator_device_id,
            "x-rpc-lang": "en-us",
            "x-rpc-page": "__#",
            "x-rpc-platform": "4",
        }

        async with self.session.post(
            f"{self.CALCULATOR_BASE_URL}{path}",
            json=payload,
            headers=headers,
        ) as response:
            response.raise_for_status()
            result = await response.json()

        if result.get("retcode") != 0:
            message = result.get("message") or "Unknown HoYoLAB error"
            raise RuntimeError(f"HoYoLAB calculator API failed: {message}")

        return result.get("data") or {}

    async def _get_calculator_catalogue(
        self,
        path: str,
        list_key: str = "list",
    ) -> list[dict]:
        """Retrieve every page from a calculator catalogue endpoint."""
        items = []
        page = 1
        page_size = 200

        while True:
            payload = {
                "page": page,
                "size": page_size,
                "is_all": True,
                "lang": "en-us",
            }

            if path.endswith("/avatar/list"):
                payload.update(
                    {
                        "element_attr_ids": [],
                        "weapon_cat_ids": [],
                    }
                )

            data = await self._post_calculator(path, payload)
            page_items = data.get(list_key) or []
            items.extend(page_items)

            if len(page_items) < page_size:
                break

            page += 1

        return items

    async def get_genshin_inventory(self) -> list[dict]:
        """Retrieve calculator-supported material counts from HoYoLAB."""
        avatars, weapons = await asyncio.gather(
            self._get_calculator_catalogue("/v1/avatar/list"),
            self._get_calculator_catalogue("/v1/weapon/list"),
        )

        # The calculator reveals owned quantities only for materials used by
        # the submitted upgrades. Covering the full catalogues produces the
        # broadest inventory view that HoYoLAB currently supports.
        upgrades = []
        unsupported_avatar_ids = {
            10000005,
            10000007,
            10000117,
            10000118,
        }

        for avatar in avatars:
            avatar_id = avatar.get("id")
            if not avatar_id or avatar_id in unsupported_avatar_ids:
                continue

            skills = []
            for skill in avatar.get("skill_list") or []:
                if int(skill.get("max_level") or 0) != 10:
                    continue

                skill_id = skill.get("group_id") or skill.get("id")
                if skill_id:
                    skills.append(
                        {
                            "id": skill_id,
                            "level_current": 1,
                            "level_target": 10,
                        }
                    )

            upgrades.append(
                {
                    "avatar_id": avatar_id,
                    "avatar_level_current": 1,
                    "avatar_level_target": 90,
                    "avatar_promote_level": 0,
                    "element_attr_id": avatar.get("element_attr_id"),
                    "from_user_sync": False,
                    "skill_list": skills,
                }
            )

        for weapon in weapons:
            weapon_id = weapon.get("id")
            if not weapon_id:
                continue

            upgrades.append(
                {
                    "weapon": {
                        "id": weapon_id,
                        "level_current": 1,
                        "level_target": int(weapon.get("max_level") or 90),
                    }
                }
            )

        if not upgrades:
            return []

        result = await self._post_calculator(
            "/v3/batch_compute",
            {
                "items": upgrades,
                "uid": self.genshin_uid,
                "region": self.genshin_server,
                "lang": "en-us",
            },
        )

        material_lists = [
            result.get("overall_consume") or [],
            result.get("available_material") or [],
        ]

        for role_result in result.get("single_role_result") or []:
            material_lists.extend(
                [
                    role_result.get("overall_consume") or [],
                    role_result.get("available_material") or [],
                ]
            )

        inventory_by_id = {}
        for material in (
            material for material_list in material_lists for material in material_list
        ):
            required = int(material.get("num") or 0)
            missing = int(material.get("lack_num") or 0)
            amount = max(0, required - missing)

            if amount == 0:
                continue

            material_id = material.get("id")
            item = {
                "id": material_id,
                "name": material.get("name") or "Unknown material",
                "icon": (material.get("icon_url") or material.get("icon")),
                "rarity": int(material.get("level") or 0),
                "amount": amount,
            }

            existing = inventory_by_id.get(material_id)
            if existing is None or amount > existing["amount"]:
                inventory_by_id[material_id] = item

        inventory = list(inventory_by_id.values())

        material_priority = {
            202: 0,
            104003: 1,
            104002: 2,
            104001: 3,
            104013: 4,
            104012: 5,
            104011: 6,
        }

        inventory.sort(
            key=lambda item: (
                material_priority.get(item["id"], 100),
                -item["rarity"],
                item["name"].casefold(),
            )
        )
        return inventory
