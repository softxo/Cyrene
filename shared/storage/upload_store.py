"""Metadata for files special users host on the site to share past Discord's upload limit."""

from pathlib import Path

UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"

COLUMNS = "id, uploader_id, filename, content_type, size, width, height, has_thumbnail, status, created_at"


async def migrate(connection):
    await connection.execute("""CREATE TABLE IF NOT EXISTS shared_uploads (
            id TEXT PRIMARY KEY,
            uploader_id BIGINT NOT NULL,
            filename TEXT NOT NULL,
            content_type TEXT NOT NULL,
            size BIGINT NOT NULL,
            width INTEGER,
            height INTEGER,
            has_thumbnail BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    await connection.execute(
        "ALTER TABLE shared_uploads ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ready'"
    )
    await connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_shared_uploads_uploader ON shared_uploads(uploader_id, created_at DESC)"
    )


async def create(
    pool, upload_id, uploader_id, filename, content_type, size, width, height, status="ready"
):
    async with pool.connection() as connection:
        await connection.execute(
            """INSERT INTO shared_uploads
            (id, uploader_id, filename, content_type, size, width, height, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (upload_id, uploader_id, filename, content_type, size, width, height, status),
        )


async def get(pool, upload_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            f"SELECT {COLUMNS} FROM shared_uploads WHERE id=%s", (upload_id,)
        )
        return await result.fetchone()


async def list_for(pool, uploader_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            f"SELECT {COLUMNS} FROM shared_uploads WHERE uploader_id=%s ORDER BY created_at DESC",
            (uploader_id,),
        )
        return await result.fetchall()


async def list_processing(pool):
    async with pool.connection() as connection:
        result = await connection.execute(
            f"SELECT {COLUMNS} FROM shared_uploads WHERE status='processing' ORDER BY created_at"
        )
        return await result.fetchall()


async def finish_conversion(pool, upload_id, filename, size, width, height):
    async with pool.connection() as connection:
        await connection.execute(
            """UPDATE shared_uploads SET status='ready', filename=%s, content_type='video/mp4',
            size=%s, width=%s, height=%s WHERE id=%s""",
            (filename, size, width, height, upload_id),
        )


async def set_status(pool, upload_id, status):
    async with pool.connection() as connection:
        await connection.execute(
            "UPDATE shared_uploads SET status=%s WHERE id=%s", (status, upload_id)
        )


async def mark_thumbnail(pool, upload_id, uploader_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            "UPDATE shared_uploads SET has_thumbnail=TRUE WHERE id=%s AND uploader_id=%s",
            (upload_id, uploader_id),
        )
        return result.rowcount == 1


async def delete(pool, upload_id, uploader_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            "DELETE FROM shared_uploads WHERE id=%s AND uploader_id=%s",
            (upload_id, uploader_id),
        )
        return result.rowcount == 1
