"""Successful import dates belong to the Genshin UID."""


async def migrate(connection):
    await connection.execute("""CREATE TABLE IF NOT EXISTS uid_import_dates (
        genshin_uid TEXT NOT NULL, kind TEXT NOT NULL,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (genshin_uid, kind))""")


async def record(connection, identity, kind):
    await connection.execute(
        """INSERT INTO uid_import_dates (genshin_uid, kind)
        VALUES (%s, %s) ON CONFLICT (genshin_uid, kind)
        DO UPDATE SET imported_at = NOW()""",
        (str(identity), kind),
    )
