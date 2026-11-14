"""Wish history belongs to a Genshin UID, independent of Discord or link IDs."""


async def migrate(connection):
    """Ensure the active UID schema exists; retired tables are never recreated."""
    from shared.storage.import_store import migrate as migrate_import_dates

    await migrate_import_dates(connection)
    await connection.execute("""CREATE TABLE IF NOT EXISTS wish_uid_history (
            genshin_uid TEXT NOT NULL, wish_id TEXT NOT NULL, gacha_type TEXT NOT NULL,
            item_name TEXT NOT NULL, item_type TEXT NOT NULL, rank_type INTEGER NOT NULL,
            icon_url TEXT, pulled_at TIMESTAMP NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (genshin_uid,wish_id))""")
    await connection.execute("""CREATE INDEX IF NOT EXISTS idx_wish_uid_history_time
            ON wish_uid_history(genshin_uid,pulled_at DESC,wish_id DESC)""")


async def uid(connection, account):
    result = await connection.execute("SELECT genshin_uid FROM accounts WHERE id=%s", (account,))
    row = await result.fetchone()
    if row is None:
        raise ValueError("Genshin account not found.")
    return str(row["genshin_uid"])


async def get_history(pool, account):
    async with pool.connection() as connection:
        identity = await uid(connection, account)
        result = await connection.execute(
            """SELECT wish_id,genshin_uid,gacha_type,item_name,item_type,rank_type,icon_url,pulled_at
            FROM wish_uid_history WHERE genshin_uid=%s ORDER BY pulled_at DESC,wish_id DESC""",
            (identity,),
        )
        return await result.fetchall()


async def import_history(pool, account, wishes):
    async with pool.connection() as connection:
        identity = await uid(connection, account)
        if any(str(wish["uid"]) != identity for wish in wishes):
            raise ValueError("This wish history belongs to a different Genshin account.")
        imported = 0
        for wish in wishes:
            result = await connection.execute(
                """INSERT INTO wish_uid_history
                (genshin_uid,wish_id,gacha_type,item_name,item_type,rank_type,icon_url,pulled_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (genshin_uid,wish_id) DO UPDATE SET
                    icon_url=COALESCE(EXCLUDED.icon_url,wish_uid_history.icon_url)
                RETURNING (xmax=0) AS inserted""",
                (
                    identity,
                    wish["id"],
                    wish["gacha_type"],
                    wish["name"],
                    wish["item_type"],
                    wish["rank_type"],
                    wish.get("icon_url"),
                    wish["pulled_at"],
                ),
            )
            saved = await result.fetchone()
            imported += int(bool(saved and saved["inserted"]))
        from shared.storage.import_store import record

        await record(connection, identity, "wishes")
        return imported
