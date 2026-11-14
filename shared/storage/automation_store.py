"""UID-owned automatic claims and redemption history, independent of credentials."""


async def migrate(c):
    """Ensure the active UID schema exists; retired tables are never recreated."""
    await c.execute("""CREATE TABLE IF NOT EXISTS gift_code_uid_settings (
            genshin_uid TEXT PRIMARY KEY, auto_claim_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    await c.execute("""CREATE TABLE IF NOT EXISTS gift_code_uid_redemptions (
            genshin_uid TEXT NOT NULL, code TEXT NOT NULL, status TEXT NOT NULL,
            message TEXT, attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY(genshin_uid,code))""")
    await c.execute("""CREATE TABLE IF NOT EXISTS daily_checkin_uid_settings (
            genshin_uid TEXT PRIMARY KEY, auto_checkin_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            last_claimed_date DATE, last_status TEXT, last_message TEXT,
            processing_until TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")


async def get_gift_settings(pool, account_id):
    async with pool.connection() as c:
        result = await c.execute(
            """SELECT s.auto_claim_enabled FROM gift_code_uid_settings s
            JOIN accounts a ON a.genshin_uid=s.genshin_uid WHERE a.id=%s""",
            (account_id,),
        )
        row = await result.fetchone()
        return {"auto_claim_enabled": row["auto_claim_enabled"] if row else False}


async def set_enabled(pool, account_id, enabled, *, daily=False):
    table = "daily_checkin_uid_settings" if daily else "gift_code_uid_settings"
    column = "auto_checkin_enabled" if daily else "auto_claim_enabled"
    async with pool.connection() as c:
        result = await c.execute(
            f"""INSERT INTO {table}(genshin_uid,{column},updated_at)
            SELECT genshin_uid,%s,NOW() FROM accounts WHERE id=%s
            ON CONFLICT (genshin_uid) DO UPDATE SET {column}=EXCLUDED.{column},updated_at=NOW()""",
            (enabled, account_id),
        )
        if result.rowcount != 1:
            raise ValueError("The automation account is no longer linked.")


async def get_redemptions(pool, account_id):
    async with pool.connection() as c:
        result = await c.execute(
            """SELECT r.code,r.status,r.message,r.attempted_at FROM gift_code_uid_redemptions r
            JOIN accounts a ON a.genshin_uid=r.genshin_uid WHERE a.id=%s""",
            (account_id,),
        )
        rows = await result.fetchall()
        return {
            row["code"]: {
                "status": row["status"],
                "message": row["message"],
                "attempted_at": row["attempted_at"].isoformat() if row["attempted_at"] else None,
            }
            for row in rows
        }


async def reserve_code(pool, account_id, code, *, automatic=True):
    """Atomically reserve a UID/code before contacting HoYoLAB, across all workers."""
    async with pool.connection() as c:
        result = await c.execute(
            """INSERT INTO gift_code_uid_redemptions(genshin_uid,code,status,message,attempted_at)
            SELECT a.genshin_uid,%s,'processing','Redemption request in progress.',NOW()
            FROM accounts a WHERE a.id=%s AND (%s=FALSE OR EXISTS (
                SELECT 1 FROM gift_code_uid_settings s
                WHERE s.genshin_uid=a.genshin_uid AND s.auto_claim_enabled=TRUE))
            ON CONFLICT (genshin_uid,code) DO UPDATE SET
                status=EXCLUDED.status,message=EXCLUDED.message,attempted_at=NOW()
            WHERE gift_code_uid_redemptions.status='cooldown'
               OR (%s=FALSE AND gift_code_uid_redemptions.status='failed')
               OR (gift_code_uid_redemptions.status='processing'
                   AND gift_code_uid_redemptions.attempted_at < NOW()-INTERVAL '30 minutes')""",
            (code.strip().upper(), account_id, automatic, automatic),
        )
        return result.rowcount == 1


async def update_redemption(pool, account_id, code, status, message, *, genshin_uid=None):
    async with pool.connection() as c:
        result = await c.execute(
            """INSERT INTO gift_code_uid_redemptions(genshin_uid,code,status,message,attempted_at)
            SELECT COALESCE(%s::text,(SELECT genshin_uid FROM accounts WHERE id=%s)),%s,%s,%s,NOW()
            WHERE COALESCE(%s::text,(SELECT genshin_uid FROM accounts WHERE id=%s)) IS NOT NULL
            ON CONFLICT (genshin_uid,code) DO UPDATE SET
                status=EXCLUDED.status,message=EXCLUDED.message,attempted_at=NOW()
            WHERE gift_code_uid_redemptions.status<>'submitted'""",
            (
                genshin_uid,
                account_id,
                code.strip().upper(),
                status,
                message,
                genshin_uid,
                account_id,
            ),
        )
        return result.rowcount == 1


async def get_enabled_accounts(pool, *, daily=False):
    table = "daily_checkin_uid_settings" if daily else "gift_code_uid_settings"
    column = "auto_checkin_enabled" if daily else "auto_claim_enabled"
    async with pool.connection() as c:
        result = await c.execute(
            f"""SELECT DISTINCT ON (a.genshin_uid) a.id AS account_id,a.discord_user_id,
                a.genshin_uid,a.genshin_server,a.nickname,a.cyrene_nickname
            FROM accounts a JOIN {table} s ON s.genshin_uid=a.genshin_uid
            WHERE s.{column}=TRUE ORDER BY a.genshin_uid,a.id DESC"""
        )
        return await result.fetchall()


async def get_checkin_settings(pool, account_id):
    async with pool.connection() as c:
        result = await c.execute(
            """SELECT s.auto_checkin_enabled,s.last_claimed_date,s.last_status,s.last_message
            FROM daily_checkin_uid_settings s JOIN accounts a ON a.genshin_uid=s.genshin_uid
            WHERE a.id=%s""",
            (account_id,),
        )
        row = await result.fetchone()
        return {
            "auto_checkin_enabled": row["auto_checkin_enabled"] if row else False,
            "last_claimed_date": row["last_claimed_date"].isoformat()
            if row and row["last_claimed_date"]
            else None,
            "last_status": row["last_status"] if row else None,
            "last_message": row["last_message"] if row else None,
        }


async def reserve_checkin(pool, account_id, today):
    async with pool.connection() as c:
        result = await c.execute(
            """UPDATE daily_checkin_uid_settings s
            SET processing_until=NOW()+INTERVAL '5 minutes'
            FROM accounts a WHERE a.id=%s AND a.genshin_uid=s.genshin_uid
              AND s.auto_checkin_enabled=TRUE
              AND (s.last_claimed_date IS NULL OR s.last_claimed_date<%s)
              AND (s.processing_until IS NULL OR s.processing_until<NOW())""",
            (account_id, today),
        )
        return result.rowcount == 1


async def update_checkin(pool, account_id, status, message, claimed_date, *, genshin_uid=None):
    async with pool.connection() as c:
        await c.execute(
            """INSERT INTO daily_checkin_uid_settings
                (genshin_uid,last_claimed_date,last_status,last_message,updated_at)
            SELECT COALESCE(%s::text,(SELECT genshin_uid FROM accounts WHERE id=%s)),%s,%s,%s,NOW()
            WHERE COALESCE(%s::text,(SELECT genshin_uid FROM accounts WHERE id=%s)) IS NOT NULL
            ON CONFLICT (genshin_uid) DO UPDATE SET
                last_claimed_date=GREATEST(EXCLUDED.last_claimed_date,daily_checkin_uid_settings.last_claimed_date),
                last_status=EXCLUDED.last_status,last_message=EXCLUDED.last_message,
                processing_until=NULL,updated_at=NOW()""",
            (genshin_uid, account_id, claimed_date, status, message, genshin_uid, account_id),
        )
