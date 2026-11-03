"""Wish history UID migration and import regressions (temporary PostgreSQL tables)."""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime

import psycopg
import pytest
from psycopg.rows import dict_row

from tests.integration.legacy_uid_fixtures import migrate_wish
from utils.hoyolab import wish_store as store


@pytest.fixture
def event_loop_policy():
    return (
        asyncio.WindowsSelectorEventLoopPolicy()
        if os.name == "nt"
        else asyncio.DefaultEventLoopPolicy()
    )


class Pool:
    def __init__(self, c):
        self.c = c

    @asynccontextmanager
    async def connection(self):
        yield self.c


class Migration:
    def __init__(self, c):
        self.c = c

    async def execute(self, query, args=None):
        return await self.c.execute(
            query.replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE IF NOT EXISTS"), args
        )


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("CYRENE_TEST_POSTGRES_URL"),
    reason="PostgreSQL integration connection not configured",
)
async def test_wishes_shared_uid_migration_import_and_relink():
    async with await psycopg.AsyncConnection.connect(
        os.environ["CYRENE_TEST_POSTGRES_URL"], row_factory=dict_row
    ) as c:
        try:
            await c.execute(
                "CREATE TEMP TABLE accounts(id bigint PRIMARY KEY,discord_user_id bigint,genshin_uid text)"
            )
            await c.execute("""CREATE TEMP TABLE wish_history(account_id bigint,wish_id text,genshin_uid text,
                gacha_type text,item_name text,item_type text,rank_type integer,icon_url text,
                pulled_at timestamp,created_at timestamptz DEFAULT NOW(),PRIMARY KEY(account_id,wish_id))""")
            await c.execute(
                "INSERT INTO accounts VALUES(1,10,'777000001'),(2,20,'777000001'),(3,30,'777000003')"
            )
            await c.execute("""INSERT INTO wish_history(account_id,wish_id,genshin_uid,gacha_type,item_name,item_type,rank_type,icon_url,pulled_at) VALUES
                (10,'100','777000001','301','Older character','Character',5,NULL,'2020-01-01 12:00:00'),
                (11,'100','777000001','301','Older character','Character',5,'https://enka.network/ui/Test.png','2020-01-01 12:00:00'),
                (11,'101','777000001','200','Weapon','Weapon',3,NULL,'2021-01-01 12:00:00'),
                (30,'100','777000003','301','Other UID','Character',5,NULL,'2020-01-01 12:00:00')""")
            await migrate_wish(Migration(c))
            pool = Pool(c)
            first = await store.get_history(pool, 1)
            assert [w["wish_id"] for w in first] == ["101", "100"]
            assert first[-1]["icon_url"] == "https://enka.network/ui/Test.png"
            assert first[-1]["pulled_at"] == datetime(2020, 1, 1, 12)
            assert await store.get_history(pool, 2) == first
            assert (await store.get_history(pool, 3))[0]["item_name"] == "Other UID"
            wish = dict(
                id="102",
                uid="777000001",
                gacha_type="301",
                name="New character",
                item_type="Character",
                rank_type=5,
                pulled_at="2026-11-02 12:00:00",
            )
            assert await store.import_history(pool, 2, [wish]) == 1
            assert await store.import_history(pool, 1, [wish]) == 0
            assert len(await store.get_history(pool, 1)) == 3
            assert (
                await store.import_history(
                    pool, 1, [wish | {"icon_url": "https://enka.network/ui/New.png"}]
                )
                == 0
            )
            assert await store.import_history(pool, 2, [wish]) == 0
            assert (await store.get_history(pool, 1))[0][
                "icon_url"
            ] == "https://enka.network/ui/New.png"
            with pytest.raises(ValueError):
                await store.import_history(
                    pool, 1, [wish | {"id": "103"}, wish | {"id": "104", "uid": "777000003"}]
                )
            assert len(await store.get_history(pool, 1)) == 3
            await c.execute("DELETE FROM accounts WHERE id=1")
            await c.execute("INSERT INTO accounts VALUES(4,40,'777000001')")
            assert len(await store.get_history(pool, 4)) == 3
            assert await store.import_history(pool, 4, []) == 0
            await migrate_wish(Migration(c))
            assert len(await store.get_history(pool, 4)) == 3
            assert (await store.get_history(pool, 4))[0][
                "icon_url"
            ] == "https://enka.network/ui/New.png"
            with pytest.raises(ValueError):
                await store.get_history(pool, 1)
            result = await c.execute("SELECT COUNT(*) AS count FROM wish_history")
            assert (await result.fetchone())["count"] == 4
        finally:
            await c.rollback()
