"""Rollback-only regression checks for shared Achievement UID storage."""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import psycopg
import pytest
from psycopg.rows import dict_row

from tests.integration.legacy_uid_fixtures import migrate_achievement
from utils.hoyolab import achievement_store as store


@pytest.fixture
def event_loop_policy():
    return (
        asyncio.WindowsSelectorEventLoopPolicy()
        if os.name == "nt"
        else asyncio.DefaultEventLoopPolicy()
    )


class Pool:
    def __init__(self, connection):
        self.connection_value = connection

    @asynccontextmanager
    async def connection(self):
        yield self.connection_value


class Migration:
    def __init__(self, connection):
        self.connection = connection

    async def execute(self, query, args=None):
        return await self.connection.execute(
            query.replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE IF NOT EXISTS"), args
        )


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("CYRENE_TEST_POSTGRES_URL"),
    reason="PostgreSQL integration connection not configured",
)
async def test_achievement_migration_and_shared_uid_state():
    async with await psycopg.AsyncConnection.connect(
        os.environ["CYRENE_TEST_POSTGRES_URL"], row_factory=dict_row
    ) as c:
        try:
            await c.execute(
                "CREATE TEMP TABLE accounts(id bigint PRIMARY KEY,discord_user_id bigint,genshin_uid text)"
            )
            await c.execute(
                "CREATE TEMP TABLE game_data_accounts(id bigint PRIMARY KEY,discord_user_id bigint,genshin_uid text)"
            )
            await c.execute("""CREATE TEMP TABLE achievement_progress(id bigint GENERATED ALWAYS AS IDENTITY,
                discord_user_id bigint,account_id bigint,achievement_id text,tier int,completed bool,current int,
                completed_at timestamptz,note text,created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW())""")
            await c.execute(
                "INSERT INTO accounts VALUES(1,10,'777000001'),(2,20,'777000001'),(3,30,'777000003')"
            )
            await c.execute(
                "INSERT INTO game_data_accounts VALUES(10,10,'777000001'),(11,20,'777000001')"
            )
            await c.execute("""INSERT INTO achievement_progress
                (discord_user_id,account_id,achievement_id,tier,completed,current,note,updated_at) VALUES
                (10,10,'100',1,true,5,'Older note','2026-10-31T00:00:00Z'),
                (20,11,'100',1,false,2,'Latest note','2026-11-01T00:00:00Z'),
                (99,NULL,'999',1,true,1,'Unidentified legacy account',NOW())""")
            await migrate_achievement(Migration(c))
            pool = Pool(c)
            old = await store.get_tier(pool, 10, 1, "100", 1)
            assert (
                old["completed"] is False and old["current"] == 2 and old["note"] == "Latest note"
            )
            assert await store.get_tier(pool, 20, 2, "100", 1) == old
            assert await store.get_progress(pool, 30, 3) == []
            assert await store.get_progress(pool, 20, 1) == []
            assert await store.update_tier(pool, 20, 1, "100", 1, completed=True) is False
            timestamp = datetime(2026, 10, 25, tzinfo=timezone.utc)
            assert await store.update_tier(
                pool, 10, 1, "100", 1, completed=True, completed_at=timestamp
            )
            assert await store.update_tier(pool, 20, 2, "100", 1, note="Shared note")
            assert await store.update_tier(pool, 20, 2, "100", 1, current=7)
            state = await store.get_tier(pool, 10, 1, "100", 1)
            assert (
                state["completed"]
                and state["completed_at"].timestamp() == timestamp.timestamp()
                and state["note"] == "Shared note"
                and state["current"] == 7
            )
            await store.import_progress(
                pool,
                10,
                1,
                {
                    "100": {
                        "tiers": {
                            "1": {
                                "completed": True,
                                "current": 8,
                                "timestamp": int(timestamp.timestamp()),
                            }
                        }
                    }
                },
            )
            state = await store.get_tier(pool, 20, 2, "100", 1)
            assert (
                state["current"] == 8
                and state["note"] == "Shared note"
                and state["completed_at"].timestamp() == timestamp.timestamp()
            )
            assert await store.update_tier(pool, 20, 2, "101", 2, note="Note-only tier")
            await c.execute("DELETE FROM accounts WHERE id=1")
            await c.execute("INSERT INTO accounts VALUES(4,40,'777000001')")
            state = await store.get_tier(pool, 40, 4, "100", 1)
            assert state["current"] == 8 and state["note"] == "Shared note"
            assert (await store.get_tier(pool, 40, 4, "101", 2))["note"] == "Note-only tier"
            await store.update_tier(pool, 40, 4, "100", 1, completed=False, current=0, note=None)
            await migrate_achievement(Migration(c))
            state = await store.get_tier(pool, 20, 2, "100", 1)
            assert (
                state["completed"] is False
                and state["current"] == 0
                and state["note"] is None
                and state["completed_at"] is None
            )
            with pytest.raises(ValueError):
                await store.import_progress(pool, 20, 4, {})
            cursor = await c.execute(
                "SELECT note FROM achievement_progress WHERE account_id IS NULL"
            )
            assert (await cursor.fetchone())["note"] == "Unidentified legacy account"
        finally:
            await c.rollback()
