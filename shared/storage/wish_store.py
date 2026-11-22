IMPORT_BATCH_SIZE = 1000


async def migrate(connection):
    from shared.storage.import_store import migrate as migrate_import_dates

    await migrate_import_dates(connection)

    await connection.execute(
        """
        CREATE TABLE IF NOT EXISTS wish_uid_history (
            genshin_uid TEXT NOT NULL,
            wish_id TEXT NOT NULL,
            gacha_type TEXT NOT NULL,
            item_name TEXT NOT NULL,
            item_type TEXT NOT NULL,
            rank_type INTEGER NOT NULL,
            icon_url TEXT,
            pulled_at TIMESTAMP NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (genshin_uid, wish_id)
        )
        """
    )

    await connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_wish_uid_history_time
        ON wish_uid_history(genshin_uid, pulled_at DESC, wish_id DESC)
        """
    )


async def uid(connection, account):
    result = await connection.execute(
        "SELECT genshin_uid FROM accounts WHERE id = %s",
        (account,),
    )
    row = await result.fetchone()

    if row is None:
        raise ValueError("Genshin account not found.")

    return str(row["genshin_uid"])


async def get_history(pool, account):
    async with pool.connection() as connection:
        identity = await uid(connection, account)

        result = await connection.execute(
            """
            SELECT
                wish_id,
                genshin_uid,
                gacha_type,
                item_name,
                item_type,
                rank_type,
                icon_url,
                pulled_at
            FROM wish_uid_history
            WHERE genshin_uid = %s
            ORDER BY pulled_at DESC, wish_id DESC
            """,
            (identity,),
        )

        return await result.fetchall()


def _unique_wishes(wishes):
    by_id = {}

    for wish in wishes:
        wish_id = str(wish["id"])

        if wish_id not in by_id:
            by_id[wish_id] = dict(wish)
        elif wish.get("icon_url"):
            by_id[wish_id]["icon_url"] = wish["icon_url"]

    return list(by_id.values())


def _batches(items, size):
    for start in range(0, len(items), size):
        yield items[start : start + size]


async def _save_batch(connection, identity, batch):
    result = await connection.execute(
        """
        WITH saved AS (
            INSERT INTO wish_uid_history (
                genshin_uid,
                wish_id,
                gacha_type,
                item_name,
                item_type,
                rank_type,
                icon_url,
                pulled_at
            )
            SELECT %s, batch.*
            FROM UNNEST(
                %s::text[],
                %s::text[],
                %s::text[],
                %s::text[],
                %s::integer[],
                %s::text[],
                %s::timestamp[]
            ) AS batch(wish_id, gacha_type, item_name, item_type, rank_type, icon_url, pulled_at)
            WHERE TRUE
            ON CONFLICT (genshin_uid, wish_id) DO UPDATE SET
                icon_url = COALESCE(EXCLUDED.icon_url, wish_uid_history.icon_url)
            WHERE EXCLUDED.icon_url IS NOT NULL
                AND wish_uid_history.icon_url IS DISTINCT FROM EXCLUDED.icon_url
            RETURNING (xmax = 0) AS inserted
        )
        SELECT COUNT(*) FILTER (WHERE inserted) AS imported
        FROM saved
        """,
        (
            identity,
            [str(wish["id"]) for wish in batch],
            [wish["gacha_type"] for wish in batch],
            [wish["name"] for wish in batch],
            [wish["item_type"] for wish in batch],
            [wish["rank_type"] for wish in batch],
            [wish.get("icon_url") for wish in batch],
            [wish["pulled_at"] for wish in batch],
        ),
    )
    saved = await result.fetchone()

    return saved["imported"]


async def import_history(pool, account, wishes):
    from shared.storage.import_store import record

    async with pool.connection() as connection:
        identity = await uid(connection, account)

        if any(str(wish["uid"]) != identity for wish in wishes):
            raise ValueError("This wish history belongs to a different Genshin account.")

        imported = 0

        for batch in _batches(_unique_wishes(wishes), IMPORT_BATCH_SIZE):
            imported += await _save_batch(connection, identity, batch)

        await record(connection, identity, "wishes")

        return imported
