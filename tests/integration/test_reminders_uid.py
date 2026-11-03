"""Shared Planner reminder migration and authorisation, with rollback-only PostgreSQL tables."""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import psycopg
import pytest
from psycopg.rows import dict_row

from tests.integration.legacy_uid_fixtures import migrate_reminder
from utils.hoyolab import reminder_store as store


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

    async def execute(self, q, args=None):
        return await self.c.execute(
            q.replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE IF NOT EXISTS"), args
        )


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("CYRENE_TEST_POSTGRES_URL"),
    reason="PostgreSQL integration connection not configured",
)
async def test_uid_reminders_merge_share_and_survive_discord_changes():
    async with await psycopg.AsyncConnection.connect(
        os.environ["CYRENE_TEST_POSTGRES_URL"], row_factory=dict_row
    ) as c:
        try:
            await c.execute("""CREATE TEMP TABLE accounts(id bigint PRIMARY KEY,discord_user_id bigint,genshin_uid text,
                nickname text,cyrene_nickname text,level int,genshin_server text)""")
            await c.execute("""CREATE TEMP TABLE reminders(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                discord_user_id bigint NOT NULL,reminder_type text,reminder_mode text DEFAULT 'automatic',genshin_uid text,
                enabled bool DEFAULT TRUE,delivery_type text DEFAULT 'dm',config jsonb DEFAULT '{}',
                next_trigger_at timestamptz,last_triggered_at timestamptz,
                created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW())""")
            await c.execute(
                "INSERT INTO accounts(id,discord_user_id,genshin_uid,nickname) VALUES(1,10,'777000001','First'),(2,20,'777000001','Shared'),(3,30,'777000003','Other')"
            )
            await c.execute("""INSERT INTO reminders(discord_user_id,reminder_type,genshin_uid,enabled,config,next_trigger_at,updated_at)
                VALUES(10,'resin','777000001',true,'{"amount":150}',NOW(),'2026-10-31T00:00:00Z'),
                      (20,'resin','777000001',false,'{"amount":180}',NOW(),'2026-11-01T00:00:00Z'),
                      (30,'resin','777000003',true,'{"amount":160}',NOW(),'2026-11-01T00:00:00Z'),
                      (10,'custom',NULL,true,'{"message":"Personal"}',NOW(),NOW())""")
            await migrate_reminder(Migration(c))
            pool = Pool(c)
            assert [r["id"] for r in await store.get_reminders(pool, 20)] == [2]
            assert (await store.get_reminder(pool, 10, 1))["id"] == 2
            assert (await store.get_reminder(pool, 10, 2))["enabled"] is False
            assert await store.get_reminder(pool, 30, 2) is None
            assert await store.update_reminder(pool, 30, 2, enabled=True) is False
            assert await store.delete_reminder(pool, 30, 2) is False
            assert not await store.get_reminders(pool, 20, enabled_only=True)
            canonical = await store.create_reminder(
                pool, 10, "resin", genshin_uid="777000001", config={"amount": 170}
            )
            assert canonical == 2
            assert (
                await store.create_reminder(
                    pool, 20, "resin", genshin_uid="777000001", config={"amount": 180}
                )
                == 2
            )
            assert (await store.get_reminder(pool, 10, 2))["config"]["amount"] == 180
            manual = await store.create_reminder(
                pool,
                20,
                "resin",
                genshin_uid="777000001",
                reminder_mode="manual",
                config={"amount": 190},
            )
            assert manual != canonical
            future = datetime.now(timezone.utc) + timedelta(hours=1)
            assert await store.update_reminder(
                pool, 20, 1, config={"amount": 175}, next_trigger_at=future
            )
            assert (await store.get_reminder(pool, 10, 2))["next_trigger_at"] == future
            await store.update_reminder(pool, 10, 2, enabled=False, next_trigger_at=None)
            await store.update_reminder(pool, 20, 2, enabled=True)
            due = await store.get_due_reminders(pool)
            assert sum(r["id"] == 2 for r in due) == 1 and not any(r["id"] == 1 for r in due)
            assert await store.get_reminder_recipients(pool, "777000001") == [10, 20]
            await c.execute("DELETE FROM accounts WHERE id=1")
            assert [r["id"] for r in await store.get_reminders(pool, 10)] == [4]
            assert await store.get_reminder_recipients(pool, "777000001") == [20]
            with pytest.raises(ValueError):
                await store.create_reminder(pool, 10, "resin", genshin_uid="777000001")
            await c.execute(
                "INSERT INTO accounts(id,discord_user_id,genshin_uid,nickname) VALUES(4,40,'777000001','Relinked')"
            )
            assert (await store.get_reminder(pool, 40, 2))["config"]["amount"] == 175
            await c.execute("DELETE FROM accounts WHERE genshin_uid='777000001'")
            assert not any(
                r["genshin_uid"] == "777000001" for r in await store.get_due_reminders(pool)
            )
            await c.execute(
                "INSERT INTO accounts(id,discord_user_id,genshin_uid) VALUES(5,50,'777000001')"
            )
            assert any(r["id"] == 2 for r in await store.get_due_reminders(pool))
            await store.update_reminder(pool, 50, 2, enabled=False)
            await migrate_reminder(Migration(c))
            assert (await store.get_reminder(pool, 50, 2))["enabled"] is False
            assert await store.delete_reminder(pool, 50, 1)
            assert await store.get_reminder(pool, 50, 2) is None
            cursor = await c.execute("SELECT COUNT(*) AS count FROM reminder_uid_legacy_archive")
            assert (await cursor.fetchone())["count"] == 4
        finally:
            await c.rollback()
