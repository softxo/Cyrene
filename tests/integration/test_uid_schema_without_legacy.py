"""Current schema starts and relinks accounts without any retired tables."""

import asyncio
import os
import re
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import patch

import psycopg
import pytest
from psycopg.rows import dict_row

from utils.hoyolab import database
from utils.hoyolab.auth import HoYoLABCredentials

RETIRED = {
    "achievement_progress",
    "wish_history",
    "game_data_accounts",
    "character_plans",
    "character_plan_snapshots",
    "weapon_scan_snapshots",
    "event_activity_checks",
    "custom_event_account_order",
    "gift_code_settings",
    "gift_code_redemptions",
    "daily_checkin_settings",
    "reminder_uid_legacy_archive",
    "event_uid_migrations",
    "reminder_uid_migrations",
    "automation_uid_migrations",
}


@pytest.fixture
def event_loop_policy():
    return (
        asyncio.WindowsSelectorEventLoopPolicy()
        if os.name == "nt"
        else asyncio.DefaultEventLoopPolicy()
    )


class TemporaryPool:
    def __init__(self, connection):
        self.c = connection

    @asynccontextmanager
    async def connection(self):
        yield self

    async def execute(self, query, args=None):
        # Fail if startup or account linking tries to use a retired table.
        assert not RETIRED.intersection(re.findall(r"\b\w+\b", query))
        return await self.c.execute(
            query.replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE IF NOT EXISTS"), args
        )

    def transaction(self):
        return self.c.transaction()


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("CYRENE_TEST_POSTGRES_URL"), reason="PostgreSQL test connection not configured"
)
async def test_fresh_schema_repeated_startup_and_account_linking_without_legacy_tables():
    async with await psycopg.AsyncConnection.connect(
        os.environ["CYRENE_TEST_POSTGRES_URL"], row_factory=dict_row
    ) as c:
        try:
            await c.execute("SET LOCAL search_path=pg_temp")
            await c.execute("SET LOCAL statement_timeout='15s'")
            pool = TemporaryPool(c)
            with (
                patch.object(database, "_pool", pool),
                patch.object(
                    database,
                    "HoYoLABCrypto",
                    return_value=SimpleNamespace(encrypt=lambda value: value),
                ),
            ):
                await database.initialise_database()
                await database.save_account(
                    10, HoYoLABCredentials(), genshin_uid="777000001", genshin_server="os_euro"
                )
                r = await c.execute("SELECT id FROM accounts WHERE discord_user_id=10")
                account_id = (await r.fetchone())["id"]
                await database.replace_character_plans(10, account_id, [{"id": 1}])
                await database.set_gift_code_auto_claim(account_id, True)
                await database.update_gift_code_redemption(account_id, "DONE", "submitted")
                await c.execute("""INSERT INTO custom_events(discord_user_id,title,account_scope,start_at)
                    VALUES(10,'All accounts event','all',NOW())""")
                await database.save_account(
                    10, HoYoLABCredentials(), genshin_uid="777000001", genshin_server="os_euro"
                )
                r = await c.execute("SELECT count(*) AS count FROM custom_event_accounts")
                assert (await r.fetchone())["count"] == 1
                await database.initialise_database()
                assert await database.get_character_plans(10, account_id) == [{"id": 1}]
                assert (await database.get_gift_code_settings(account_id))["auto_claim_enabled"]
                assert (await database.get_gift_code_redemptions(account_id))["DONE"][
                    "status"
                ] == "submitted"
                await database.delete_account(10, "777000001")
                await database.save_account(
                    20, HoYoLABCredentials(), genshin_uid="777000001", genshin_server="os_euro"
                )
                r = await c.execute("SELECT id FROM accounts WHERE discord_user_id=20")
                new_id = (await r.fetchone())["id"]
                assert await database.get_character_plans(20, new_id) == [{"id": 1}]
                assert (await database.get_gift_code_settings(new_id))["auto_claim_enabled"]
                r = await c.execute("SELECT count(*) AS count FROM custom_event_accounts")
                assert (await r.fetchone())["count"] == 1
                r = await c.execute(
                    "SELECT relname FROM pg_class WHERE relnamespace=pg_my_temp_schema() AND relkind='r'"
                )
                assert not RETIRED.intersection(row["relname"] for row in await r.fetchall())
        finally:
            await c.rollback()
