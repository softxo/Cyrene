import aiohttp
import genshin
from .auth import HoYoLABCredentials



class HoYoLABClient:
    BASE_URL = "https://bbs-api-os.hoyolab.com"

    def __init__(
            self,
            credentials: HoYoLABCredentials
    ):
        self.credentials = credentials
        self.session: aiohttp.ClientSession | None = None
        self.genshin_client: genshin.Client | None = None

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
            }
        )

        cookies = self.credentials.as_cookies()

        self.genshin_client = genshin.Client(
            cookies=cookies,
            game=genshin.types.Game.GENSHIN,
        )

        return self

    async def __aexit__(
            self,
            exc_type,
            exc,
            tb
    ):
        if self.session:
            await self.session.close()

        self.genshin_client = None

    async def get_game_roles(self) -> dict:
        if self.session is None:
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

        url = (
            "https://api-account-os.hoyolab.com/"
            "account/binding/api/"
            "getUserGameRolesByCookieToken"
        )

        async with self.session.get(url) as response:
            response.raise_for_status()
            return await response.json()

    async def get_genshin_daily_note(
            self,
            genshin_uid: str,
            genshin_server: str
    ) -> dict:
        if self.session is None:
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

        url = (
            "https://sg-public-api.hoyolab.com/"
            "event/game_record/genshin/api/dailyNote"
        )

        params = {
            "role_id": genshin_uid,
            "server": genshin_server
        }

        async with self.session.get(
                url,
                params=params
        ) as response:

            response.raise_for_status()

            return await response.json()

    async def get_genshin_notes(self) -> dict:
        if self.session is None:
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

        return await self.get_genshin_daily_note(
            self.genshin_uid,
            self.genshin_server
        )
        
    async def redeem_genshin_code(self, code: str) -> None:
        """Redeem a Genshin Impact gift code for this account."""
        if self.genshin_client is None:
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

        await self.genshin_client.redeem_code(
            code=code,
            uid=int(self.genshin_uid),
            game=genshin.types.Game.GENSHIN,
            region=self.genshin_server,
        )

    async def get_stygian_onslaught(self) -> list:
        if self.genshin_client is None:
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

        return await self.genshin_client.get_stygian_onslaught(
            raw=True
        )

    async def get_imaginarium_theater(self) -> dict:
        if self.genshin_client is None:
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

        return await self.genshin_client.get_imaginarium_theater(
            raw=True
        )

    async def get_genshin_spiral_abyss(self):
        if self.genshin_client is None:
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

        return await self.genshin_client.get_genshin_spiral_abyss()

    async def get_genshin_banners(self):
        client = genshin.Client(
            cookies=self.credentials.as_cookies(),
            game=genshin.types.Game.GENSHIN
        )

        return await client.get_banner_details()

    async def get_genshin_banner_ids(self):
        client = genshin.Client(
            cookies=self.credentials.as_cookies(),
            game=genshin.types.Game.GENSHIN
        )

        return await client.get_genshin_banner_ids()

    async def get_genshin_announcements(self):
        client = genshin.Client(
            cookies=self.credentials.as_cookies(),
            game=genshin.types.Game.GENSHIN
        )

        return await client.get_genshin_announcements()

    async def get_genshin_banner_announcements(self) -> list[dict]:
        if self.session is None:
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

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

        async with self.session.get(
            url,
            params=params
        ) as response:
            response.raise_for_status()

            data = await response.json()

        if data.get("retcode") not in (None, 0):
            raise RuntimeError(
                f"HoYoLAB announcement API failed: "
                f"{data.get('message')}"
            )

        return data.get("data", {}).get("list", [])

    async def get_genshin_banner_names(self):
        client = genshin.Client(
            cookies=self.credentials.as_cookies(),
            game=genshin.types.Game.GENSHIN
        )

        return await client.get_genshin_banner_names()

    async def get_genshin_event_calendar(self):
        if self.session is None:
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

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
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

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
            raise RuntimeError(
                "HoYoLABClient must be used with 'async with'."
            )

        return await self.genshin_client.get_genshin_detailed_characters(
            uid=int(self.genshin_uid),
            characters=characters,
            lang="en-us",
        )