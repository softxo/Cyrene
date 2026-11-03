"""Character Planner snapshots belong to a Genshin UID, including empty plans."""

from psycopg.types.json import Jsonb


async def migrate(c):
    """Ensure the active UID schema exists; retired tables are never recreated."""
    await c.execute("""CREATE TABLE IF NOT EXISTS character_uid_snapshots (
            genshin_uid TEXT PRIMARY KEY, plans JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")


async def get_plans(pool, user_id, account_id):
    snapshot = await get_snapshot(pool, user_id, account_id)
    return snapshot["plans"]


async def get_snapshot(pool, user_id, account_id):
    async with pool.connection() as c:
        result = await c.execute(
            """SELECT s.plans FROM accounts a JOIN character_uid_snapshots s
            ON s.genshin_uid=a.genshin_uid
            WHERE a.discord_user_id=%s AND a.id=%s""",
            (user_id, account_id),
        )
        row = await result.fetchone()
        return {"plans": row["plans"] if row else [], "snapshot_exists": row is not None}


async def replace_plans(pool, user_id, account_id, plans):
    async with pool.connection() as c:
        result = await c.execute(
            """INSERT INTO character_uid_snapshots(genshin_uid,plans,updated_at)
            SELECT genshin_uid,%s,NOW() FROM accounts WHERE discord_user_id=%s AND id=%s
            ON CONFLICT (genshin_uid) DO UPDATE SET plans=EXCLUDED.plans,updated_at=NOW()""",
            (Jsonb(plans), user_id, account_id),
        )
        if result.rowcount != 1:
            raise ValueError("Planner account is no longer linked.")


async def recover_plans(pool, user_id, account_id, plans):
    """Recover browser-only plans without overwriting a concurrent save or deletion."""
    async with pool.connection() as c:
        await c.execute(
            """INSERT INTO character_uid_snapshots(genshin_uid,plans,updated_at)
            SELECT genshin_uid,%s,NOW() FROM accounts WHERE discord_user_id=%s AND id=%s
            ON CONFLICT (genshin_uid) DO NOTHING""",
            (Jsonb(plans), user_id, account_id),
        )
    return await get_snapshot(pool, user_id, account_id)
