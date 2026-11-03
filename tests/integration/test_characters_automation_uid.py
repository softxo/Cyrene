"""UID migration, shared claims and unlinking against rollback-only temporary tables."""

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import date
from unittest.mock import patch

import psycopg
import pytest
from psycopg.rows import dict_row

from tests.integration.legacy_uid_fixtures import migrate_automation, migrate_character
from utils.hoyolab import database


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
async def test_shared_plans_automation_history_and_unlink_relink():
    async with await psycopg.AsyncConnection.connect(
        os.environ["CYRENE_TEST_POSTGRES_URL"], row_factory=dict_row
    ) as c:
        try:
            await c.execute("SET LOCAL statement_timeout='15s'")
            await c.execute("""CREATE TEMP TABLE accounts(id int PRIMARY KEY,discord_user_id bigint,
                genshin_uid text,genshin_server text DEFAULT 'os_euro',nickname text,cyrene_nickname text)""")
            await c.execute("""INSERT INTO accounts(id,discord_user_id,genshin_uid) VALUES
                (1,10,'777000001'),(2,20,'777000001'),(3,30,'777000003')""")
            await c.execute("""CREATE TEMP TABLE character_plan_snapshots(discord_user_id bigint,
                genshin_uid text,plans jsonb,updated_at timestamptz,PRIMARY KEY(discord_user_id,genshin_uid))""")
            await c.execute("""INSERT INTO character_plan_snapshots VALUES
                (10,'777000001','[{"id":1}]','2026-10-01'),
                (20,'777000001','[]','2026-10-02'),
                (99,'777000099','[{"id":99}]','2026-10-01')""")
            await c.execute("""CREATE TEMP TABLE gift_code_settings(account_id int PRIMARY KEY
                REFERENCES accounts(id) ON DELETE CASCADE,auto_claim_enabled bool,updated_at timestamptz)""")
            await c.execute("""INSERT INTO gift_code_settings VALUES
                (1,true,'2026-10-01'),(2,false,'2026-10-02'),(3,true,'2026-10-01')""")
            await c.execute("""CREATE TEMP TABLE gift_code_redemptions(id int PRIMARY KEY,
                account_id int REFERENCES accounts(id) ON DELETE CASCADE,code text,status text,
                message text,attempted_at timestamptz)""")
            await c.execute("""INSERT INTO gift_code_redemptions VALUES
                (1,1,' done ','submitted','Submitted','2026-10-01'),
                (2,2,'DONE','cooldown','Temporary error','2026-10-02'),
                (3,1,'CLAIMED','failed','Already redeemed','2026-10-01'),
                (4,2,'claimed','cooldown','Retry','2026-10-02'),
                (5,3,'OTHER','submitted','Other UID','2026-10-01')""")
            await c.execute("""CREATE TEMP TABLE daily_checkin_settings(account_id int PRIMARY KEY
                REFERENCES accounts(id) ON DELETE CASCADE,auto_checkin_enabled bool,last_claimed_date date,
                last_status text,last_message text,updated_at timestamptz)""")
            await c.execute("""INSERT INTO daily_checkin_settings VALUES
                (1,true,'2026-11-02','claimed','Claimed','2026-10-01'),
                (2,false,NULL,'error','Error','2026-10-02')""")
            migration, pool = Migration(c), Pool(c)
            await migrate_character(migration)
            await migrate_automation(migration)
            with patch.object(database, "get_pool", return_value=pool):
                # Latest complete snapshot wins, including explicit deletion.
                assert await database.get_character_plans(10, 1) == []
                plans = [{"id": 2, "notes": "Shared notes", "level": 90}]
                await database.replace_character_plans(10, 1, plans)
                assert await database.get_character_plans(20, 2) == plans
                assert await database.get_character_plans(30, 3) == []
                assert (await database.get_character_plan_snapshot(30, 3))[
                    "snapshot_exists"
                ] is False
                recovered = await database.recover_character_plans(30, 3, [{"id": 3}])
                assert recovered == {"plans": [{"id": 3}], "snapshot_exists": True}
                # A recovery racing an ordinary save must not replace that save.
                recovered = await database.recover_character_plans(30, 3, [{"id": 4}])
                assert recovered["plans"] == [{"id": 3}]
                await database.replace_character_plans(30, 3, [])
                recovered = await database.recover_character_plans(30, 3, [{"id": 4}])
                assert recovered == {"plans": [], "snapshot_exists": True}
                assert await database.get_character_plans(20, 1) == []
                with pytest.raises(ValueError):
                    await database.replace_character_plans(20, 1, [])
                assert not (await database.get_gift_code_settings(1))["auto_claim_enabled"]
                assert not (await database.get_daily_checkin_settings(1))["auto_checkin_enabled"]
                assert (await database.get_daily_checkin_settings(2))[
                    "last_claimed_date"
                ] == "2026-11-02"
                history = await database.get_gift_code_redemptions(2)
                assert history["DONE"]["status"] == "submitted"
                assert history["CLAIMED"]["status"] == "failed"
                assert "OTHER" not in history
                assert not await database.reserve_gift_code_redemption(1, "NEW")
                await database.set_gift_code_auto_claim(1, True)
                await database.set_daily_checkin_enabled(1, True)
                assert (await database.get_gift_code_settings(2))["auto_claim_enabled"]
                assert (await database.get_daily_checkin_settings(2))["auto_checkin_enabled"]
                # One worker candidate per UID; reservations gate duplicate candidates.
                assert len(await database.get_gift_code_auto_claim_accounts()) == 2
                assert len(await database.get_daily_checkin_accounts()) == 1
                assert not await database.reserve_gift_code_redemption(2, "done")
                assert not await database.reserve_gift_code_redemption(2, "claimed")
                assert await database.reserve_gift_code_redemption(1, "new")
                assert not await database.reserve_gift_code_redemption(2, "NEW")
                assert not await database.reserve_gift_code_redemption(2, "NEW", automatic=False)
                await database.update_gift_code_redemption(1, "NEW", "submitted", "Done")
                await database.update_gift_code_redemption(2, "NEW", "cooldown", "Late error")
                assert (await database.get_gift_code_redemptions(2))["NEW"]["status"] == "submitted"
                await database.update_gift_code_redemption(1, "RETRY", "cooldown")
                assert await database.reserve_gift_code_redemption(2, "RETRY")
                await c.execute("""UPDATE gift_code_uid_redemptions SET attempted_at=NOW()-INTERVAL '31 minutes'
                    WHERE code='RETRY'""")
                assert await database.reserve_gift_code_redemption(1, "RETRY")
                assert not await database.reserve_daily_checkin(1, date(2026, 11, 2))
                assert await database.reserve_daily_checkin(1, date(2026, 11, 3))
                assert not await database.reserve_daily_checkin(2, date(2026, 11, 3))
                # Credentials may disappear while an external request is in flight.
                await c.execute("DELETE FROM accounts WHERE genshin_uid='777000001'")
                await database.update_daily_checkin_status(
                    1,
                    status="claimed",
                    message="Claimed",
                    claimed_date=date(2026, 11, 3),
                    genshin_uid="777000001",
                )
                await database.update_gift_code_redemption(
                    2,
                    "RETRY",
                    "submitted",
                    "Done",
                    genshin_uid="777000001",
                )
                await c.execute("""INSERT INTO accounts(id,discord_user_id,genshin_uid) VALUES
                    (4,40,'777000001'),(5,50,'777000099')""")
                assert await database.get_character_plans(40, 4) == plans
                assert await database.get_character_plans(50, 5) == [{"id": 99}]
                assert (await database.get_gift_code_settings(4))["auto_claim_enabled"]
                assert (await database.get_daily_checkin_settings(4))[
                    "last_claimed_date"
                ] == "2026-11-03"
                assert not await database.reserve_gift_code_redemption(4, "RETRY")
                assert not await database.reserve_daily_checkin(4, date(2026, 11, 3))
                await database.replace_character_plans(40, 4, [])
                await database.set_gift_code_auto_claim(4, False)
                await database.set_daily_checkin_enabled(4, False)
                await migrate_character(migration)
                await migrate_automation(migration)
                assert await database.get_character_plans(40, 4) == []
                assert not (await database.get_gift_code_settings(4))["auto_claim_enabled"]
                assert not (await database.get_daily_checkin_settings(4))["auto_checkin_enabled"]
                with pytest.raises(ValueError):
                    await database.set_gift_code_auto_claim(1, True)
                assert len(await database.get_gift_code_redemptions(3)) == 1
        finally:
            await c.rollback()
