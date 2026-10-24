import os
from datetime import datetime, timezone
import psycopg
from psycopg.rows import dict_row


def get_connection():
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not configured."
        )

    return psycopg.connect(
        database_url,
        row_factory=dict_row
    )


def initialise_database() -> None:
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS errors (
                error_id TEXT PRIMARY KEY,

                code TEXT,

                type TEXT NOT NULL,
                message TEXT,

                command TEXT,

                user_id BIGINT,
                guild_id BIGINT,
                channel_id BIGINT,

                timestamp TEXT NOT NULL,

                traceback TEXT
            )
            """
        )

        connection.commit()


def save_error(
    error_id: str,
    error_type: str,
    message: str,
    traceback_text: str,
    *,
    code: str | None = None,
    command: str | None = None,
    user_id: int | None = None,
    guild_id: int | None = None,
    channel_id: int | None = None
) -> None:

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO errors (
                error_id,
                code,
                type,
                message,
                command,
                user_id,
                guild_id,
                channel_id,
                timestamp,
                traceback
            )
            VALUES (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s
            )

            ON CONFLICT (error_id)
            DO UPDATE SET
                code = EXCLUDED.code,
                type = EXCLUDED.type,
                message = EXCLUDED.message,
                command = EXCLUDED.command,
                user_id = EXCLUDED.user_id,
                guild_id = EXCLUDED.guild_id,
                channel_id = EXCLUDED.channel_id,
                timestamp = EXCLUDED.timestamp,
                traceback = EXCLUDED.traceback
            """,
            (
                error_id.upper(),
                code,
                error_type,
                message,
                command,
                user_id,
                guild_id,
                channel_id,
                datetime.now(timezone.utc).isoformat(),
                traceback_text
            )
        )

        connection.commit()


def get_error(
    error_id: str
) -> dict | None:

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT *
            FROM errors
            WHERE error_id = %s
            """,
            (
                error_id.upper(),
            )
        ).fetchone()

    if row is None:
        return None

    return dict(row)


def delete_error(
    error_id: str
) -> bool:

    with get_connection() as connection:
        cursor = connection.execute(
            """
            DELETE FROM errors
            WHERE error_id = %s
            """,
            (
                error_id.upper(),
            )
        )

        connection.commit()

    return cursor.rowcount > 0