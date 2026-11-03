"""Rollback-only PostgreSQL integration check using temporary tables."""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import psycopg
import pytest
from psycopg.rows import dict_row

from tests.integration.legacy_uid_fixtures import migrate_events
from utils.hoyolab import events_store as store


@pytest.fixture
def event_loop_policy():
    if os.name == "nt":
        return asyncio.WindowsSelectorEventLoopPolicy()
    return asyncio.DefaultEventLoopPolicy()


class Pool:
    def __init__(self, c):
        self.c = c

    @asynccontextmanager
    async def connection(self):
        yield self.c


class Migration:
    def __init__(self, c):
        self.c = c

    async def execute(self, sql, args=None):
        return await self.c.execute(
            sql.replace("CREATE TABLE IF NOT EXISTS", "CREATE TEMP TABLE IF NOT EXISTS"), args
        )


@pytest.mark.asyncio
@pytest.mark.skipif(
    not os.getenv("CYRENE_TEST_POSTGRES_URL"),
    reason="PostgreSQL integration connection not configured",
)
async def test_uid_events_survive_discord_changes_and_relinking():
    async with await psycopg.AsyncConnection.connect(
        os.environ["CYRENE_TEST_POSTGRES_URL"], row_factory=dict_row
    ) as c:
        try:
            await c.execute(
                "CREATE TEMP TABLE accounts(id bigint PRIMARY KEY,discord_user_id bigint,genshin_uid text,genshin_server text)"
            )
            await c.execute("""CREATE TEMP TABLE custom_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    discord_user_id bigint,title text,description text,account_scope text,account_id bigint REFERENCES accounts(id) ON DELETE SET NULL,
    genshin_uid text,genshin_server text,start_at timestamptz,end_at timestamptz,recurrence jsonb,colour text,reminder_minutes int,
    progress jsonb,icon_url text,sort_order bigint DEFAULT 0,created_at timestamptz DEFAULT NOW(),updated_at timestamptz DEFAULT NOW())""")
            await c.execute(
                """CREATE TEMP TABLE event_activity_checks(id bigint GENERATED ALWAYS AS IDENTITY,discord_user_id bigint,genshin_uid text,activity_type text,period_key text,checked bool,updated_at timestamptz DEFAULT NOW())"""
            )
            await c.execute(
                "CREATE TEMP TABLE custom_event_account_order(discord_user_id bigint,account_id bigint,event_id bigint,sort_order bigint)"
            )
            await c.execute(
                """CREATE TEMP TABLE custom_event_progress(id bigint GENERATED ALWAYS AS IDENTITY,event_id bigint REFERENCES custom_events(id) ON DELETE CASCADE,discord_user_id bigint,account_id bigint,genshin_uid text,genshin_server text,objective_index int,current int,updated_at timestamptz DEFAULT NOW())"""
            )
            await c.execute(
                """CREATE UNIQUE INDEX temp_progress_unique ON custom_event_progress(event_id,genshin_uid,genshin_server,objective_index) WHERE genshin_uid IS NOT NULL AND genshin_server IS NOT NULL"""
            )
            await c.execute(
                """CREATE TEMP TABLE custom_event_completions(id bigint GENERATED ALWAYS AS IDENTITY,event_id bigint REFERENCES custom_events(id) ON DELETE CASCADE,discord_user_id bigint,account_id bigint,genshin_uid text,genshin_server text,occurrence_start timestamptz,completed bool,completed_at timestamptz)"""
            )
            await c.execute(
                """CREATE UNIQUE INDEX temp_completion_unique ON custom_event_completions(event_id,genshin_uid,genshin_server,occurrence_start) WHERE genshin_uid IS NOT NULL AND genshin_server IS NOT NULL"""
            )
            await c.execute(
                "INSERT INTO accounts VALUES(1,10,'777000001','os_euro'),(2,20,'777000001','os_euro'),(3,30,'777000003','os_euro'),(4,10,'777000004','os_euro')"
            )
            await c.execute(
                "INSERT INTO event_activity_checks(discord_user_id,genshin_uid,activity_type,period_key,checked) VALUES(10,'777000001','limited_event','test',true),(20,'777000001','limited_event','test',false)"
            )
            await c.execute(
                "INSERT INTO custom_events(discord_user_id,title,account_scope,genshin_uid,genshin_server,start_at,progress) VALUES(99,'Legacy linked event','account','777000001','os_euro',NOW(),'[]')"
            )
            await c.execute("""INSERT INTO custom_event_completions
                (event_id,discord_user_id,account_id,genshin_uid,genshin_server,occurrence_start,completed,completed_at)
                VALUES (1,10,1,'777000001','os_euro','2026-11-01T00:00:00Z',false,NOW()),
                       (1,99,NULL,NULL,NULL,'2026-11-01T00:00:00Z',true,NOW())""")
            await migrate_events(Migration(c))
            pool = Pool(c)
            assert (
                await store.get_event_activity_check(pool, 10, "777000001", "limited_event", "test")
                is False
            )
            await store.set_event_activity_check(
                pool, 10, "777000001", "limited_event", "test", True
            )
            assert (
                await store.get_event_activity_check(pool, 20, "777000001", "limited_event", "test")
                is True
            )
            assert (
                await store.get_event_activity_check(pool, 30, "777000003", "limited_event", "test")
                is None
            )
            old = (await store.get_custom_events(pool, 20, 2))[0]
            assert old["account_id"] == 2
            now = datetime.now(timezone.utc)
            event = await store.create_custom_event(
                pool,
                10,
                "With Objectives",
                None,
                "account",
                1,
                now,
                None,
                {"type": "none"},
                "#ff88aa",
                None,
                [{"title": "Reputation", "target": 5, "current": 0}],
            )
            eid = event["id"]
            assert (await store.get_custom_events(pool, 20, 2))[-1]["account_id"] == 2
            assert not await store.get_custom_events(pool, 30, 3)
            assert await store.change_custom_event_account_progress(pool, 20, eid, 2, 0, 1, 5) == 1
            assert (await store.get_custom_event_account_progress(pool, 10, eid, 1)) == {0: 1}
            assert (
                await store.change_custom_event_account_progress(pool, 30, eid, 3, 0, 1, 5) is None
            )
            assert await store.set_custom_event_completion(pool, 20, eid, now, True, 2)
            assert (await store.get_custom_event_completions(pool, 10, eid, 1))[0]["completed"]
            assert await store.reorder_custom_events(pool, 20, 2, [eid, old["id"]])
            assert [e["id"] for e in await store.get_custom_events(pool, 10, 1)] == [eid, old["id"]]
            await c.execute("DELETE FROM accounts WHERE id=1")
            await c.execute("INSERT INTO accounts VALUES(5,40,'777000001','os_euro')")
            assert (
                await store.get_event_activity_check(pool, 40, "777000001", "limited_event", "test")
                is True
            )
            assert (await store.get_custom_event_account_progress(pool, 40, eid, 5)) == {0: 1}
            assert (await store.get_custom_events(pool, 40, 5))[0]["account_id"] == 5
            assert (await store.get_custom_event_completions(pool, 40, old["id"], 5))[0][
                "completed"
            ] is False
            cursor = await c.execute(
                "SELECT account_id FROM custom_event_completions WHERE event_id=1 AND genshin_uid='777000001'"
            )
            assert (await cursor.fetchone())["account_id"] is None
            shared = await store.create_custom_event(
                pool,
                40,
                "All linked",
                None,
                "all",
                None,
                now,
                None,
                {"type": "none"},
                "#ff88aa",
                None,
                [],
            )
            assert await store.get_visible_custom_event(pool, 20, shared["id"], 2)
            assert not await store.get_visible_custom_event(pool, 30, shared["id"], 3)
            assert (
                await store.update_custom_event(
                    pool,
                    20,
                    eid,
                    "Edited by shared UID",
                    None,
                    "account",
                    2,
                    now,
                    None,
                    {"type": "none"},
                    "#ff88aa",
                    None,
                    [],
                )
                is not None
            )
            assert await store.delete_custom_event(pool, 30, eid) is False
            await migrate_events(Migration(c))
            assert (
                await store.get_event_activity_check(pool, 40, "777000001", "limited_event", "test")
                is True
            )
            assert await store.delete_custom_event(pool, 20, eid)
            print(
                "PASS: migration, checkmarks, objectives, completion, ordering, unlink/relink, shared UID access, isolation, editing, deletion and repeated migration."
            )
        finally:
            await c.rollback()
