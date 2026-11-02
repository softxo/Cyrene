import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from utils.web import app as web
from utils.web import auth


class AccountAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_profiles_are_grouped_by_uid_and_server_with_safe_avatars(self):
        rows = [
            dict(
                genshin_uid="777",
                genshin_server="os_euro",
                discord_user_id=7,
                username="everly",
                display_name="Everly",
                avatar_hash="a" * 32,
            ),
            dict(
                genshin_uid="777",
                genshin_server="os_euro",
                discord_user_id=8,
                username="alice",
                display_name="Alice",
                avatar_hash="javascript:bad",
            ),
            dict(
                genshin_uid="777",
                genshin_server="os_usa",
                discord_user_id=9,
                username=None,
                display_name=None,
                avatar_hash=None,
            ),
        ]
        connection = SimpleNamespace(
            execute=AsyncMock(return_value=SimpleNamespace(fetchall=AsyncMock(return_value=rows)))
        )
        context = AsyncMock()
        context.__aenter__.return_value = connection
        with patch.object(
            auth, "get_pool", return_value=SimpleNamespace(connection=lambda: context)
        ):
            access = await auth.get_account_discord_access(7)
        self.assertEqual([p["id"] for p in access[("777", "os_euro")]], ["7", "8"])
        self.assertEqual(
            access[("777", "os_euro")][1]["avatar_url"], "/static/images/ui/ui_icons/Discord.png"
        )
        self.assertEqual(access[("777", "os_usa")][0]["display_name"], "Discord account")
        self.assertEqual(connection.execute.await_args.args[1], (7,))


class AccountAccessApiTests(unittest.TestCase):
    def test_only_owned_accounts_receive_public_access_profiles(self):
        account = dict(
            genshin_uid="777",
            nickname="Evernight",
            cyrene_nickname=None,
            level=60,
            genshin_server="os_euro",
        )
        profiles = [
            {
                "id": "7",
                "username": "everly",
                "display_name": "Everly",
                "avatar_url": "/static/images/ui/ui_icons/Discord.png",
            }
        ]
        with (
            patch.object(
                web, "get_web_session", AsyncMock(return_value=SimpleNamespace(user_id=7))
            ),
            patch.object(web, "get_accounts", AsyncMock(return_value=[account])),
            patch.object(
                web,
                "get_account_discord_access",
                AsyncMock(
                    return_value={("777", "os_euro"): profiles, ("888", "os_euro"): profiles}
                ),
            ) as access,
        ):
            data = TestClient(web.app).get("/api/hoyolab/accounts").json()
        access.assert_awaited_once_with(7)
        self.assertEqual(len(data["accounts"]), 1)
        self.assertEqual(data["accounts"][0]["discord_access"], profiles)

    def test_signed_out_cannot_list_access(self):
        with (
            patch.object(web, "get_web_session", AsyncMock(return_value=None)),
            patch.object(web, "get_account_discord_access", AsyncMock()) as access,
        ):
            self.assertEqual(TestClient(web.app).get("/api/hoyolab/accounts").status_code, 401)
        access.assert_not_awaited()
