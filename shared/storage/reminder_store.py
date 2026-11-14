"""Shared UID reminder settings; Discord users are current linked recipients."""

from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from shared.storage.achievement_store import UNSET


async def migrate(c):
    """Ensure the active UID schema exists; retired tables are never recreated."""
    await c.execute(
        """ALTER TABLE reminders ADD COLUMN IF NOT EXISTS superseded_by BIGINT REFERENCES reminders(id) ON DELETE CASCADE"""
    )
    await c.execute("""CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_uid_type_mode
            ON reminders(genshin_uid,reminder_type,reminder_mode)
            WHERE genshin_uid IS NOT NULL AND superseded_by IS NULL""")


async def get_reminder_recipients(pool, genshin_uid):
    async with pool.connection() as c:
        result = await c.execute(
            "SELECT DISTINCT discord_user_id FROM accounts WHERE genshin_uid=%s ORDER BY discord_user_id",
            (genshin_uid,),
        )
        return [row["discord_user_id"] for row in await result.fetchall()]


async def get_reminders(pool, discord_user_id, *, enabled_only=False):
    async with pool.connection() as c:
        result = await c.execute(
            """SELECT r.*,a.nickname AS account_nickname,
            a.cyrene_nickname AS account_cyrene_nickname,a.level AS account_level,a.genshin_server AS account_server
            FROM reminders r LEFT JOIN accounts a ON a.genshin_uid=r.genshin_uid AND a.discord_user_id=%s
            WHERE r.superseded_by IS NULL AND ((r.genshin_uid IS NULL AND r.discord_user_id=%s) OR a.id IS NOT NULL)
            AND (%s=FALSE OR r.enabled=TRUE) ORDER BY r.created_at,r.id""",
            (discord_user_id, discord_user_id, enabled_only),
        )
        return await result.fetchall()


async def get_reminder(pool, discord_user_id, reminder_id):
    async with pool.connection() as c:
        result = await c.execute(
            """SELECT r.* FROM reminders alias JOIN reminders r ON r.id=COALESCE(alias.superseded_by,alias.id)
            WHERE alias.id=%s AND ((r.genshin_uid IS NULL AND r.discord_user_id=%s) OR EXISTS (
                SELECT 1 FROM accounts a WHERE a.genshin_uid=r.genshin_uid AND a.discord_user_id=%s))""",
            (reminder_id, discord_user_id, discord_user_id),
        )
        return await result.fetchone()


async def create_reminder(
    pool,
    discord_user_id,
    reminder_type,
    *,
    genshin_uid=None,
    config=None,
    delivery_type="dm",
    reminder_mode="automatic",
    next_trigger_at=None,
):
    if reminder_mode not in {"automatic", "manual"}:
        raise ValueError("Invalid reminder mode.")
    if reminder_mode == "automatic" and next_trigger_at is None:
        next_trigger_at = datetime.now(timezone.utc)
    async with pool.connection() as c:
        if genshin_uid is not None:
            result = await c.execute(
                "SELECT 1 FROM accounts WHERE discord_user_id=%s AND genshin_uid=%s",
                (discord_user_id, genshin_uid),
            )
            if not await result.fetchone():
                raise ValueError("Genshin account not linked to this user.")
            result = await c.execute(
                """INSERT INTO reminders
                (discord_user_id,reminder_type,reminder_mode,genshin_uid,enabled,delivery_type,config,next_trigger_at)
                VALUES (%s,%s,%s,%s,TRUE,%s,%s,%s)
                ON CONFLICT(genshin_uid,reminder_type,reminder_mode)
                WHERE genshin_uid IS NOT NULL AND superseded_by IS NULL
                DO UPDATE SET discord_user_id=EXCLUDED.discord_user_id,enabled=TRUE,
                    delivery_type=EXCLUDED.delivery_type,config=EXCLUDED.config,next_trigger_at=EXCLUDED.next_trigger_at,
                    last_triggered_at=NULL,updated_at=NOW() RETURNING id""",
                (
                    discord_user_id,
                    reminder_type,
                    reminder_mode,
                    genshin_uid,
                    delivery_type,
                    Jsonb(config or {}),
                    next_trigger_at,
                ),
            )
        else:
            result = await c.execute(
                """SELECT id FROM reminders WHERE discord_user_id=%s AND reminder_type=%s
                AND reminder_mode=%s AND genshin_uid IS NULL LIMIT 1""",
                (discord_user_id, reminder_type, reminder_mode),
            )
            existing = await result.fetchone()
            if existing:
                result = await c.execute(
                    """UPDATE reminders SET enabled=TRUE,delivery_type=%s,config=%s,
                    next_trigger_at=%s,last_triggered_at=NULL,updated_at=NOW() WHERE id=%s RETURNING id""",
                    (delivery_type, Jsonb(config or {}), next_trigger_at, existing["id"]),
                )
            else:
                result = await c.execute(
                    """INSERT INTO reminders
                    (discord_user_id,reminder_type,reminder_mode,enabled,delivery_type,config,next_trigger_at)
                    VALUES (%s,%s,%s,TRUE,%s,%s,%s) RETURNING id""",
                    (
                        discord_user_id,
                        reminder_type,
                        reminder_mode,
                        delivery_type,
                        Jsonb(config or {}),
                        next_trigger_at,
                    ),
                )
        return (await result.fetchone())["id"]


async def update_reminder(
    pool,
    discord_user_id,
    reminder_id,
    *,
    enabled=None,
    config=None,
    reminder_mode=None,
    next_trigger_at=UNSET,
    last_triggered_at=None,
):
    updates = []
    values = []
    if enabled is not None:
        updates.append("enabled=%s")
        values.append(enabled)
    if config is not None:
        updates.append("config=%s")
        values.append(Jsonb(config))
    if reminder_mode is not None:
        if reminder_mode not in {"automatic", "manual"}:
            raise ValueError("Invalid reminder mode.")
        updates.append("reminder_mode=%s")
        values.append(reminder_mode)
    if next_trigger_at is not UNSET:
        updates.append("next_trigger_at=%s")
        values.append(next_trigger_at)
    elif config is not None or reminder_mode is not None:
        updates.append("next_trigger_at=NOW()")
    elif enabled is True:
        updates.append("next_trigger_at=COALESCE(next_trigger_at,NOW())")
    if last_triggered_at is not None:
        updates.append("last_triggered_at=%s")
        values.append(last_triggered_at)
    if not updates:
        return False
    updates.append("updated_at=NOW()")
    async with pool.connection() as c:
        result = await c.execute(
            """UPDATE reminders r SET """
            + ", ".join(updates)
            + """
            WHERE r.id=(SELECT COALESCE(superseded_by,id) FROM reminders WHERE id=%s)
            AND ((r.genshin_uid IS NULL AND r.discord_user_id=%s) OR EXISTS(
                SELECT 1 FROM accounts a WHERE a.genshin_uid=r.genshin_uid AND a.discord_user_id=%s))""",
            (*values, reminder_id, discord_user_id, discord_user_id),
        )
        return result.rowcount > 0


async def delete_reminder(pool, discord_user_id, reminder_id):
    async with pool.connection() as c:
        result = await c.execute(
            """DELETE FROM reminders r WHERE r.id=(SELECT COALESCE(superseded_by,id) FROM reminders WHERE id=%s)
            AND ((r.genshin_uid IS NULL AND r.discord_user_id=%s) OR EXISTS(
                SELECT 1 FROM accounts a WHERE a.genshin_uid=r.genshin_uid AND a.discord_user_id=%s))""",
            (reminder_id, discord_user_id, discord_user_id),
        )
        return result.rowcount > 0


async def get_due_reminders(pool):
    async with pool.connection() as c:
        result = await c.execute("""SELECT r.* FROM reminders r WHERE r.superseded_by IS NULL AND r.enabled=TRUE
            AND r.next_trigger_at IS NOT NULL AND r.next_trigger_at<=NOW()
            AND (r.genshin_uid IS NULL OR EXISTS (SELECT 1 FROM accounts a WHERE a.genshin_uid=r.genshin_uid))
            ORDER BY r.next_trigger_at,r.id""")
        return await result.fetchall()
