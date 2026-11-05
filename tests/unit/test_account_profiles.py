import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from utils.hoyolab import account_profiles as profiles


class AccountProfileTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        profiles._pending.clear()
        self.account = {
            "id": 1,
            "genshin_uid": "123",
            "genshin_server": "os_euro",
            "credentials": object(),
            "nickname": "Old",
            "cyrene_nickname": "My alias",
            "level": 50,
        }
        self.connection = SimpleNamespace(execute=AsyncMock(), commit=AsyncMock())
        self.context = MagicMock()
        self.context.__aenter__ = AsyncMock(return_value=self.connection)
        self.context.__aexit__ = AsyncMock(return_value=None)
        self.pool = SimpleNamespace(connection=lambda: self.context)
        self.client = MagicMock()
        self.client.__aenter__ = AsyncMock(return_value=self.client)
        self.client.__aexit__ = AsyncMock(return_value=None)
        self.client.get_game_roles = AsyncMock(
            return_value={
                "retcode": 0,
                "data": {
                    "list": [
                        {
                            "game_biz": "hk4e_global",
                            "game_uid": "123",
                            "region": "os_euro",
                            "nickname": "New",
                            "level": "56",
                        },
                    ]
                },
            }
        )

    async def refresh(self, accounts=None):
        with (
            patch.object(profiles, "HoYoLABClient", return_value=self.client),
            patch("utils.hoyolab.database.get_pool", return_value=self.pool),
        ):
            await profiles.refresh_account_profiles(accounts or [self.account])

    async def test_updates_game_fields_and_preserves_custom_alias(self):
        await self.refresh()
        self.assertEqual(self.account["nickname"], "New")
        self.assertEqual(self.account["level"], 56)
        self.assertEqual(self.account["cyrene_nickname"], "My alias")
        sql, values = self.connection.execute.await_args.args
        self.assertNotIn("cyrene_nickname", sql)
        self.assertIn("genshin_server=%s", sql)
        self.assertEqual(values[:2], ("New", 56))
        self.connection.commit.assert_awaited_once()

    async def test_fresh_profiles_do_not_request_upstream(self):
        self.account["profile_checked_at"] = datetime.now(timezone.utc)
        await self.refresh()
        self.client.get_game_roles.assert_not_awaited()

    async def test_upstream_failure_preserves_saved_details(self):
        self.client.get_game_roles.side_effect = RuntimeError("offline")
        await self.refresh()
        self.assertEqual(self.account["nickname"], "Old")
        self.assertEqual(self.account["level"], 50)
        self.assertNotIn("nickname", self.connection.execute.await_args.args[0])

    async def test_unrelated_roles_cannot_replace_identity(self):
        for field, value in (
            ("game_uid", "999"),
            ("region", "os_asia"),
            ("game_biz", "hkrpg_global"),
            ("nickname", ""),
            ("level", "99"),
        ):
            original = self.client.get_game_roles.return_value["data"]["list"][0].copy()
            self.client.get_game_roles.return_value["data"]["list"][0][field] = value
            await self.refresh()
            self.assertEqual(self.account["nickname"], "Old")
            self.client.get_game_roles.return_value["data"]["list"][0] = original

    async def test_concurrent_readers_share_one_request(self):
        other = {**self.account, "id": 2}
        await self.refresh([self.account, other])
        self.client.get_game_roles.assert_awaited_once()
        self.assertEqual(other["nickname"], "New")
