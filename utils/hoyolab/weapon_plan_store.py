"""Weapon plans belong to the linked Genshin UID."""

from psycopg.types.json import Jsonb


async def migrate(connection):
    await connection.execute("""CREATE TABLE IF NOT EXISTS weapon_uid_plans (
        genshin_uid TEXT PRIMARY KEY, plans JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")


async def get_plans(pool, user_id, account_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            """SELECT p.plans FROM weapon_uid_plans p JOIN accounts a
            ON a.genshin_uid::text=p.genshin_uid
            WHERE a.discord_user_id=%s AND a.id=%s""",
            (user_id, account_id),
        )
        row = await result.fetchone()
        return row["plans"] if row else []


async def replace_plans(pool, user_id, account_id, plans):
    async with pool.connection() as connection:
        result = await connection.execute(
            """INSERT INTO weapon_uid_plans(genshin_uid,plans)
            SELECT genshin_uid::text,%s FROM accounts WHERE discord_user_id=%s AND id=%s
            ON CONFLICT(genshin_uid) DO UPDATE SET plans=EXCLUDED.plans,updated_at=NOW()""",
            (Jsonb(plans), user_id, account_id),
        )
        if result.rowcount != 1:
            raise ValueError("Planner account is no longer linked.")


async def reset_inventory(pool, user_id, account_id):
    """Clear scan and manual copies atomically, leaving plans and live data intact."""
    async with pool.connection() as connection:
        async with connection.transaction():
            result = await connection.execute(
                "SELECT genshin_uid FROM accounts WHERE discord_user_id=%s AND id=%s FOR UPDATE",
                (user_id, account_id),
            )
            account = await result.fetchone()
            if not account:
                raise ValueError("Account no longer linked.")
            uid = str(account["genshin_uid"])
            await connection.execute("DELETE FROM manual_weapons WHERE genshin_uid=%s", (uid,))
            await connection.execute(
                "DELETE FROM weapon_account_scan_snapshots WHERE genshin_uid=%s", (uid,)
            )
