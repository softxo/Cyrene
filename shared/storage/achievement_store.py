from datetime import datetime, timezone

UNSET = object()

IMPORT_BATCH_SIZE = 100


async def migrate(connection):
    await connection.execute(
        """
        CREATE TABLE IF NOT EXISTS achievement_uid_progress (
            genshin_uid TEXT NOT NULL,
            achievement_id TEXT NOT NULL,
            tier INTEGER NOT NULL,
            completed BOOLEAN NOT NULL DEFAULT FALSE,
            current INTEGER NOT NULL DEFAULT 0,
            completed_at TIMESTAMPTZ,
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (genshin_uid, achievement_id, tier)
        )
        """
    )


async def uid(connection, user, account):
    result = await connection.execute(
        "SELECT genshin_uid FROM accounts WHERE id = %s AND discord_user_id = %s",
        (account, user),
    )
    row = await result.fetchone()

    return row["genshin_uid"] if row else None


async def get_progress(pool, user, account):
    async with pool.connection() as connection:
        identity = await uid(connection, user, account)

        if identity is None:
            return []

        result = await connection.execute(
            """
            SELECT achievement_id, tier, completed, current, completed_at, note
            FROM achievement_uid_progress
            WHERE genshin_uid = %s
            ORDER BY achievement_id, tier
            """,
            (identity,),
        )

        return await result.fetchall()


async def get_tier(pool, user, account, achievement, tier):
    async with pool.connection() as connection:
        identity = await uid(connection, user, account)

        if identity is None:
            return None

        result = await connection.execute(
            """
            SELECT achievement_id, tier, completed, current, completed_at, note
            FROM achievement_uid_progress
            WHERE genshin_uid = %s AND achievement_id = %s AND tier = %s
            """,
            (identity, achievement, tier),
        )

        return await result.fetchone()


def _completion_time(completed, completed_at, has_time):
    if has_time:
        return completed_at

    if completed:
        return datetime.now(timezone.utc)

    return None


async def update_tier(
    pool,
    user,
    account,
    achievement,
    tier,
    *,
    completed=None,
    current=None,
    completed_at=UNSET,
    note=UNSET,
):
    has_note = note is not UNSET and (note is None or isinstance(note, str))
    has_time = completed_at is not UNSET and (
        completed_at is None or isinstance(completed_at, datetime)
    )

    if completed is None and current is None and not has_note and not has_time:
        return False

    timestamp = _completion_time(completed, completed_at, has_time)

    async with pool.connection() as connection:
        identity = await uid(connection, user, account)

        if identity is None:
            return False

        result = await connection.execute(
            """
            INSERT INTO achievement_uid_progress (
                genshin_uid,
                achievement_id,
                tier,
                completed,
                current,
                completed_at,
                note
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (genshin_uid, achievement_id, tier) DO UPDATE SET
                completed = CASE
                    WHEN %s THEN EXCLUDED.completed
                    ELSE achievement_uid_progress.completed
                END,
                current = CASE
                    WHEN %s THEN EXCLUDED.current
                    ELSE achievement_uid_progress.current
                END,
                completed_at = CASE
                    WHEN %s THEN EXCLUDED.completed_at
                    ELSE achievement_uid_progress.completed_at
                END,
                note = CASE
                    WHEN %s THEN EXCLUDED.note
                    ELSE achievement_uid_progress.note
                END,
                updated_at = NOW()
            """,
            (
                identity,
                achievement,
                tier,
                completed if completed is not None else False,
                current if current is not None else 0,
                timestamp,
                note if has_note else None,
                completed is not None,
                current is not None,
                has_time or completed is not None,
                has_note,
            ),
        )

        return result.rowcount > 0


def _progress_rows(identity, data):
    rows = []

    for achievement, entry in data.items():
        for tier, state in entry.get("tiers", {}).items():
            timestamp = state.get("timestamp")
            completed_at = datetime.fromtimestamp(timestamp, tz=timezone.utc) if timestamp else None

            rows.append(
                (
                    identity,
                    achievement,
                    int(tier),
                    bool(state.get("completed", False)),
                    int(state.get("current", 0)),
                    completed_at,
                )
            )

    return rows


async def _save_progress_batch(connection, batch):
    placeholders = ",".join(["(%s,%s,%s,%s,%s,%s)"] * len(batch))
    values = tuple(value for row in batch for value in row)

    await connection.execute(
        "INSERT INTO achievement_uid_progress "
        "(genshin_uid,achievement_id,tier,completed,current,completed_at) VALUES "
        + placeholders
        + " ON CONFLICT (genshin_uid,achievement_id,tier) DO UPDATE SET "
        "completed=EXCLUDED.completed,current=EXCLUDED.current,"
        "completed_at=EXCLUDED.completed_at,updated_at=NOW()",
        values,
    )


async def import_progress(pool, user, account, data, progress=None):
    from shared.storage.import_store import record

    async with pool.connection() as connection:
        identity = await uid(connection, user, account)

        if identity is None:
            raise ValueError("Genshin account not found for this user.")

        rows = _progress_rows(identity, data)

        for start in range(0, len(rows), IMPORT_BATCH_SIZE):
            batch = rows[start : start + IMPORT_BATCH_SIZE]

            await _save_progress_batch(connection, batch)

            if progress:
                await progress({"type": "progress", "imported": start + len(batch)})

        await record(connection, identity, "achievements")
