import os
from datetime import datetime, timezone

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from . import (
    achievement_store,
    automation_store,
    character_store,
    events_store,
    reminder_store,
    weapon_plan_store,
    wish_store,
)
from .auth import HoYoLABCredentials
from .crypto import HoYoLABCrypto

_pool: AsyncConnectionPool | None = None


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        raise RuntimeError("DATABASE_URL is not configured.")

    return database_url


async def initialise_database() -> None:
    global _pool

    if _pool is None:
        _pool = AsyncConnectionPool(
            conninfo=get_database_url(),
            min_size=1,
            max_size=10,
            open=False,
            kwargs={"row_factory": dict_row},
        )

        await _pool.open()

    async with _pool.connection() as connection:
        await connection.execute(
            """CREATE TABLE IF NOT EXISTS web_discord_oauth (
                discord_user_id BIGINT PRIMARY KEY,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
            )"""
        )
        await connection.execute(
            """CREATE TABLE IF NOT EXISTS web_discord_profiles (
                discord_user_id BIGINT PRIMARY KEY,
                username TEXT,
                display_name TEXT,
                avatar_hash TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"""
        )
        await connection.execute(
            """CREATE TABLE IF NOT EXISTS site_changelog (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                entry_date DATE NOT NULL,
                content TEXT NOT NULL,
                author_id BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"""
        )
        await connection.execute(
            "ALTER TABLE site_changelog ADD COLUMN IF NOT EXISTS pill_colour TEXT NOT NULL DEFAULT '#8f9cff'"
        )
        await connection.execute(
            "ALTER TABLE site_changelog ADD COLUMN IF NOT EXISTS pill_colour_end TEXT"
        )
        await connection.execute(
            "ALTER TABLE site_changelog ADD COLUMN IF NOT EXISTS entry_time TIME"
        )
        await connection.execute(
            "UPDATE site_changelog SET entry_time = (created_at AT TIME ZONE 'Europe/London')::time WHERE entry_time IS NULL"
        )
        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS manual_weapons (
                copy_id TEXT PRIMARY KEY,
                discord_user_id BIGINT NOT NULL,
                genshin_uid TEXT NOT NULL,
                weapon JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        await connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_manual_weapons_owner "
            "ON manual_weapons(discord_user_id, genshin_uid)"
        )

        await connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_manual_weapons_uid ON manual_weapons(genshin_uid)"
        )
        await _initialise_shared_weapon_scans(connection)
        await weapon_plan_store.migrate(connection)

        # =========================================
        # ACCOUNTS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

                discord_user_id BIGINT NOT NULL,
                discord_username TEXT,
                discord_display_name TEXT,

                discord_guild_id BIGINT,
                discord_guild_name TEXT,

                nickname TEXT,
                cyrene_nickname TEXT,
                level INTEGER,

                genshin_uid TEXT NOT NULL,
                genshin_server TEXT NOT NULL,

                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,

                ltuid_v2 TEXT,
                ltoken_v2 TEXT,
                ltmid_v2 TEXT,

                cookie_token_v2 TEXT,
                account_mid_v2 TEXT,
                account_id_v2 TEXT,

                ltuid TEXT,
                ltoken TEXT,

                UNIQUE(discord_user_id, genshin_uid)
            )
            """
        )

        await connection.execute(
            """
            ALTER TABLE accounts
                ADD COLUMN IF NOT EXISTS cookie_token TEXT,
                ADD COLUMN IF NOT EXISTS account_id TEXT,
                ADD COLUMN IF NOT EXISTS stoken TEXT,
                ADD COLUMN IF NOT EXISTS profile_checked_at TIMESTAMPTZ
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_accounts_discord_user
            ON accounts(discord_user_id)
            """
        )

        # =========================================
        # REMINDERS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS reminders (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

                discord_user_id BIGINT NOT NULL,
                reminder_type TEXT NOT NULL,
                reminder_mode TEXT NOT NULL DEFAULT 'automatic',

                genshin_uid TEXT,

                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                delivery_type TEXT NOT NULL DEFAULT 'dm',

                config JSONB NOT NULL DEFAULT '{}'::jsonb,

                next_trigger_at TIMESTAMPTZ,
                last_triggered_at TIMESTAMPTZ,

                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_reminders_user
            ON reminders(discord_user_id)
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_reminders_due
            ON reminders(next_trigger_at)
            WHERE enabled = TRUE
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_reminders_user_type
            ON reminders(discord_user_id, reminder_type)
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_reminders_account
            ON reminders(discord_user_id, genshin_uid)
            """
        )

        # =========================================
        # WEB SESSIONS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS web_sessions (
                token TEXT PRIMARY KEY,

                discord_user_id BIGINT NOT NULL,

                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL
            )
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_web_sessions_user
            ON web_sessions(discord_user_id)
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_web_sessions_expires
            ON web_sessions(expires_at)
            """
        )

        # =========================================
        # CUSTOM EVENTS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS custom_events (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                discord_user_id BIGINT NOT NULL,

                title TEXT NOT NULL,
                description TEXT,

                account_scope TEXT NOT NULL DEFAULT 'all'
                    CHECK (account_scope IN ('all', 'account')),

                account_id INTEGER
                    REFERENCES accounts(id) ON DELETE SET NULL,

                genshin_uid TEXT,
                genshin_server TEXT,

                start_at TIMESTAMPTZ NOT NULL,
                end_at TIMESTAMPTZ,

                recurrence JSONB NOT NULL DEFAULT
                    '{"type": "none"}'::jsonb,

                colour TEXT NOT NULL DEFAULT '#7c83ff',
                reminder_minutes INTEGER,

                progress JSONB NOT NULL DEFAULT '[]'::jsonb,

                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                CHECK (
                    (account_scope = 'all' AND account_id IS NULL)
                    OR
                    (account_scope = 'account' AND (account_id IS NOT NULL
                        OR (genshin_uid IS NOT NULL AND genshin_server IS NOT NULL)))
                ),

                CHECK (
                    end_at IS NULL OR end_at > start_at
                ),

                CHECK (
                    reminder_minutes IS NULL
                    OR reminder_minutes >= 0
                )
            )
            """
        )

        # Keep the event itself after unlinking; its objectives and completions
        # already follow UID + server, but cascade through their parent event.
        await connection.execute(
            """
            ALTER TABLE custom_events
                ADD COLUMN IF NOT EXISTS genshin_uid TEXT,
                ADD COLUMN IF NOT EXISTS genshin_server TEXT
            """
        )
        await connection.execute(
            """
            UPDATE custom_events AS e
            SET genshin_uid = a.genshin_uid, genshin_server = a.genshin_server
            FROM accounts AS a
            WHERE e.account_id = a.id
              AND (e.genshin_uid IS NULL OR e.genshin_server IS NULL)
            """
        )
        constraints = await connection.execute(
            """
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'custom_events'::regclass AND contype = 'c'
              AND pg_get_constraintdef(oid) LIKE '%account_scope%'
              AND pg_get_constraintdef(oid) LIKE '%account_id%'
            """
        )
        for row in await constraints.fetchall():
            name = row["conname"].replace('"', '""')
            await connection.execute(f'ALTER TABLE custom_events DROP CONSTRAINT "{name}"')
        await connection.execute(
            """
            ALTER TABLE custom_events ADD CONSTRAINT custom_events_account_identity_check
            CHECK (
                (account_scope = 'all' AND account_id IS NULL)
                OR (account_scope = 'account' AND (
                    account_id IS NOT NULL OR
                    (genshin_uid IS NOT NULL AND genshin_server IS NOT NULL)
                ))
            )
            """
        )
        constraints = await connection.execute(
            """
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'custom_events'::regclass AND contype = 'f'
              AND confrelid = 'accounts'::regclass
            """
        )
        for row in await constraints.fetchall():
            name = row["conname"].replace('"', '""')
            await connection.execute(f'ALTER TABLE custom_events DROP CONSTRAINT "{name}"')
            await connection.execute(
                "ALTER TABLE custom_events ADD FOREIGN KEY (account_id) "
                "REFERENCES accounts(id) ON DELETE SET NULL"
            )

        await connection.execute(
            """
            ALTER TABLE custom_events
            ADD COLUMN IF NOT EXISTS icon_url TEXT
            """
        )

        await connection.execute(
            """
            ALTER TABLE custom_events
            ADD COLUMN IF NOT EXISTS sort_order BIGINT
            """
        )

        await connection.execute(
            """
            WITH ordered_events AS (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY discord_user_id
                        ORDER BY start_at ASC, id ASC
                    ) AS initial_order
                FROM custom_events
                WHERE sort_order IS NULL
            )
            UPDATE custom_events AS event
            SET sort_order = ordered_events.initial_order
            FROM ordered_events
            WHERE event.id = ordered_events.id
            """
        )

        await connection.execute(
            """
            ALTER TABLE custom_events
                ALTER COLUMN sort_order SET DEFAULT 0,
                ALTER COLUMN sort_order SET NOT NULL
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_custom_events_user
            ON custom_events(discord_user_id)
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_custom_events_account
            ON custom_events(account_id)
            """
        )

        # =========================================
        # CUSTOM EVENTS — ACCOUNT-SPECIFIC ORDER
        # =========================================

        # =========================================
        # CUSTOM EVENT COMPLETIONS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS custom_event_completions (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

                event_id BIGINT NOT NULL
                    REFERENCES custom_events(id) ON DELETE CASCADE,

                discord_user_id BIGINT NOT NULL,

                account_id INTEGER
                    REFERENCES accounts(id) ON DELETE CASCADE,

                occurrence_start TIMESTAMPTZ NOT NULL,

                completed BOOLEAN NOT NULL DEFAULT TRUE,

                completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )

        await connection.execute(
            """
            ALTER TABLE custom_event_completions
            ADD COLUMN IF NOT EXISTS account_id INTEGER
                REFERENCES accounts(id) ON DELETE CASCADE
            """
        )

        await connection.execute(
            """
            ALTER TABLE custom_event_completions
            DROP CONSTRAINT IF EXISTS
                custom_event_completions_event_id_occurrence_start_key
            """
        )

        await connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS
                idx_custom_event_completions_shared_unique
            ON custom_event_completions (
                event_id,
                occurrence_start
            )
            WHERE account_id IS NULL
            """
        )

        await connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS
                idx_custom_event_completions_account_unique
            ON custom_event_completions (
                event_id,
                account_id,
                occurrence_start
            )
            WHERE account_id IS NOT NULL
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_custom_event_completions_user
            ON custom_event_completions(discord_user_id)
            """
        )

        # =========================================
        # CUSTOM EVENT PROGRESS
        # IMPORTANT: CREATE THIS BEFORE ITS MIGRATION
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS custom_event_progress (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

                event_id BIGINT NOT NULL
                    REFERENCES custom_events(id) ON DELETE CASCADE,

                discord_user_id BIGINT NOT NULL,

                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,

                objective_index INTEGER NOT NULL
                    CHECK (objective_index >= 0),

                current INTEGER NOT NULL DEFAULT 0
                    CHECK (current >= 0),

                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                UNIQUE (event_id, account_id, objective_index)
            )
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_custom_event_progress_account
            ON custom_event_progress (
                discord_user_id,
                event_id,
                account_id
            )
            """
        )

        # =========================================
        # CUSTOM EVENTS — SHARED GENSHIN IDENTITY
        # Run only after BOTH completion and progress
        # tables have been created.
        # =========================================

        # Add Genshin identity columns to progress.
        await connection.execute(
            """
            ALTER TABLE custom_event_progress
                ADD COLUMN IF NOT EXISTS genshin_uid TEXT,
                ADD COLUMN IF NOT EXISTS genshin_server TEXT
            """
        )

        # Migrate existing progress records to their
        # actual Genshin UID and server.
        await connection.execute(
            """
            UPDATE custom_event_progress AS p
            SET
                genshin_uid = a.genshin_uid,
                genshin_server = a.genshin_server
            FROM accounts AS a
            WHERE p.account_id = a.id
              AND (
                  p.genshin_uid IS NULL
                  OR p.genshin_server IS NULL
              )
            """
        )

        # Allow shared progress records without a
        # Discord-specific local account ID.
        await connection.execute(
            """
            ALTER TABLE custom_event_progress
            ALTER COLUMN account_id DROP NOT NULL
            """
        )

        # Detach migrated records from local account IDs.
        # Their Genshin UID and server now identify them.
        await connection.execute(
            """
            UPDATE custom_event_progress
            SET account_id = NULL
            WHERE genshin_uid IS NOT NULL
              AND genshin_server IS NOT NULL
            """
        )

        await connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS
                idx_custom_event_progress_genshin_unique
            ON custom_event_progress (
                event_id,
                genshin_uid,
                genshin_server,
                objective_index
            )
            WHERE genshin_uid IS NOT NULL
              AND genshin_server IS NOT NULL
            """
        )

        # Add Genshin identity columns to completions.
        await connection.execute(
            """
            ALTER TABLE custom_event_completions
                ADD COLUMN IF NOT EXISTS genshin_uid TEXT,
                ADD COLUMN IF NOT EXISTS genshin_server TEXT
            """
        )

        # Migrate existing account-specific completions.
        await connection.execute(
            """
            UPDATE custom_event_completions AS c
            SET
                genshin_uid = a.genshin_uid,
                genshin_server = a.genshin_server
            FROM accounts AS a
            WHERE c.account_id = a.id
              AND (
                  c.genshin_uid IS NULL
                  OR c.genshin_server IS NULL
              )
            """
        )

        # Enforce uniqueness per Genshin account and
        # event occurrence, regardless of Discord user.
        await connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS
                idx_custom_event_completions_genshin_unique
            ON custom_event_completions (
                event_id,
                genshin_uid,
                genshin_server,
                occurrence_start
            )
            WHERE genshin_uid IS NOT NULL
              AND genshin_server IS NOT NULL
            """
        )

        # Overview-level completions have no Genshin
        # identity. Keep their uniqueness separate from
        # account-specific completions.
        await connection.execute(
            """
            DROP INDEX IF EXISTS
                idx_custom_event_completions_shared_unique
            """
        )

        await connection.execute(
            """
            CREATE UNIQUE INDEX
                idx_custom_event_completions_shared_unique
            ON custom_event_completions (
                event_id,
                occurrence_start
            )
            WHERE account_id IS NULL
              AND genshin_uid IS NULL
              AND genshin_server IS NULL
            """
        )

        await events_store.migrate(connection)
        await achievement_store.migrate(connection)
        await wish_store.migrate(connection)
        await reminder_store.migrate(connection)
        await character_store.migrate(connection)
        await automation_store.migrate(connection)


def get_pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("HoYoLAB database pool has not been initialised.")

    return _pool


async def close_database() -> None:
    global _pool

    if _pool is not None:
        await _pool.close()
        _pool = None


async def save_account(
    discord_user_id: int,
    credentials: HoYoLABCredentials,
    *,
    discord_username: str | None = None,
    discord_display_name: str | None = None,
    discord_guild_id: int | None = None,
    discord_guild_name: str | None = None,
    genshin_uid: str,
    genshin_server: str,
    nickname: str | None = None,
    cyrene_nickname: str | None = None,
    level: int | None = None,
) -> None:
    crypto = HoYoLABCrypto()

    encrypted_stoken = crypto.encrypt(credentials.stoken) if credentials.stoken else None

    encrypted_ltuid_v2 = crypto.encrypt(credentials.ltuid_v2) if credentials.ltuid_v2 else None

    encrypted_ltoken_v2 = crypto.encrypt(credentials.ltoken_v2) if credentials.ltoken_v2 else None

    encrypted_ltmid_v2 = crypto.encrypt(credentials.ltmid_v2) if credentials.ltmid_v2 else None

    encrypted_cookie_token_v2 = (
        crypto.encrypt(credentials.cookie_token_v2) if credentials.cookie_token_v2 else None
    )

    encrypted_account_mid_v2 = (
        crypto.encrypt(credentials.account_mid_v2) if credentials.account_mid_v2 else None
    )

    encrypted_account_id_v2 = (
        crypto.encrypt(credentials.account_id_v2) if credentials.account_id_v2 else None
    )

    encrypted_ltuid = crypto.encrypt(credentials.ltuid) if credentials.ltuid else None

    encrypted_ltoken = crypto.encrypt(credentials.ltoken) if credentials.ltoken else None

    encrypted_cookie_token = (
        crypto.encrypt(credentials.cookie_token) if credentials.cookie_token else None
    )

    encrypted_account_id = (
        crypto.encrypt(credentials.account_id) if credentials.account_id else None
    )

    now = datetime.now(timezone.utc).isoformat()

    async with get_pool().connection() as connection:
        await connection.execute(
            """
            INSERT INTO accounts (
                discord_user_id,
                discord_username,
                discord_display_name,
                discord_guild_id,
                discord_guild_name,
                nickname,
                cyrene_nickname,
                level,
                genshin_uid,
                genshin_server,
                created_at,
                updated_at,
                ltuid_v2,
                ltoken_v2,
                ltmid_v2,
                cookie_token_v2,
                account_mid_v2,
                account_id_v2,
                ltuid,
                ltoken,
                cookie_token,
                account_id,
                stoken
            )
            VALUES (
                %s, %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s,
                %s
            )
            ON CONFLICT (discord_user_id, genshin_uid)
            DO UPDATE SET
                discord_username = EXCLUDED.discord_username,
                discord_display_name = EXCLUDED.discord_display_name,
                discord_guild_id = EXCLUDED.discord_guild_id,
                discord_guild_name = EXCLUDED.discord_guild_name,
                nickname = EXCLUDED.nickname,
                cyrene_nickname = EXCLUDED.cyrene_nickname,
                level = EXCLUDED.level,
                genshin_server = EXCLUDED.genshin_server,
                updated_at = EXCLUDED.updated_at,
                ltuid_v2 = EXCLUDED.ltuid_v2,
                ltoken_v2 = EXCLUDED.ltoken_v2,
                ltmid_v2 = EXCLUDED.ltmid_v2,
                cookie_token_v2 = EXCLUDED.cookie_token_v2,
                account_mid_v2 = EXCLUDED.account_mid_v2,
                account_id_v2 = EXCLUDED.account_id_v2,
                ltuid = EXCLUDED.ltuid,
                ltoken = EXCLUDED.ltoken,
                cookie_token = EXCLUDED.cookie_token,
                account_id = EXCLUDED.account_id,
                stoken = EXCLUDED.stoken
            """,
            (
                discord_user_id,
                discord_username,
                discord_display_name,
                discord_guild_id,
                discord_guild_name,
                nickname,
                cyrene_nickname,
                level,
                genshin_uid,
                genshin_server,
                now,
                now,
                encrypted_ltuid_v2,
                encrypted_ltoken_v2,
                encrypted_ltmid_v2,
                encrypted_cookie_token_v2,
                encrypted_account_mid_v2,
                encrypted_account_id_v2,
                encrypted_ltuid,
                encrypted_ltoken,
                encrypted_cookie_token,
                encrypted_account_id,
                encrypted_stoken,
            ),
        )

        # Attach existing all-account events directly to the newly linked UID.
        # Existing associations and ordering survive reconnects and are left intact.
        await connection.execute(
            """INSERT INTO custom_event_accounts(event_id,genshin_uid,genshin_server,sort_order)
            SELECT e.id,%s,%s,COALESCE((SELECT MAX(sort_order) FROM custom_event_accounts
                WHERE genshin_uid=%s AND genshin_server=%s),0)
                + ROW_NUMBER() OVER(ORDER BY e.sort_order,e.start_at,e.id)
            FROM custom_events e WHERE e.discord_user_id=%s AND e.account_scope='all'
            ON CONFLICT DO NOTHING""",
            (genshin_uid, genshin_server, genshin_uid, genshin_server, discord_user_id),
        )


async def update_account_cookie_token(
    discord_user_id: int,
    genshin_uid: str,
    cookie_token_v2: str,
) -> None:
    """Persist a refreshed HoYoLAB cookie token."""
    encrypted_cookie_token = HoYoLABCrypto().encrypt(cookie_token_v2)

    async with get_pool().connection() as connection:
        await connection.execute(
            """
            UPDATE accounts
            SET cookie_token_v2 = %s,
                updated_at = %s
            WHERE discord_user_id = %s
              AND genshin_uid = %s
            """,
            (
                encrypted_cookie_token,
                datetime.now(timezone.utc).isoformat(),
                discord_user_id,
                genshin_uid,
            ),
        )


async def get_account_count(discord_user_id: int) -> int:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM accounts
            WHERE discord_user_id = %s
            """,
            (discord_user_id,),
        )

        row = await result.fetchone()

    return row["count"]


async def account_exists(discord_user_id: int, genshin_uid: str) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT 1
            FROM accounts
            WHERE discord_user_id = %s
            AND genshin_uid = %s
            LIMIT 1
            """,
            (discord_user_id, genshin_uid),
        )

        row = await result.fetchone()

    return row is not None


async def get_character_plans(discord_user_id: int, account_id: int) -> list[dict]:
    return await character_store.get_plans(get_pool(), discord_user_id, account_id)


async def get_character_plan_snapshot(discord_user_id: int, account_id: int) -> dict:
    return await character_store.get_snapshot(get_pool(), discord_user_id, account_id)


async def recover_character_plans(discord_user_id: int, account_id: int, plans: list[dict]) -> dict:
    return await character_store.recover_plans(get_pool(), discord_user_id, account_id, plans)


async def replace_character_plans(discord_user_id: int, account_id: int, plans: list[dict]) -> None:
    await character_store.replace_plans(get_pool(), discord_user_id, account_id, plans)


async def delete_account(discord_user_id: int, genshin_uid: str) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            DELETE FROM accounts
            WHERE discord_user_id = %s
            AND genshin_uid = %s
            """,
            (discord_user_id, genshin_uid),
        )

    return result.rowcount > 0


async def update_discord_user(
    discord_user_id: int,
    discord_username: str,
    discord_display_name: str,
) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            UPDATE accounts
            SET
                discord_username = %s,
                discord_display_name = %s
            WHERE discord_user_id = %s
            AND (
                discord_username IS DISTINCT FROM %s
                OR discord_display_name IS DISTINCT FROM %s
            )
            """,
            (
                discord_username,
                discord_display_name,
                discord_user_id,
                discord_username,
                discord_display_name,
            ),
        )

    return result.rowcount > 0


async def update_discord_server(
    discord_user_id: int,
    discord_guild_id: int,
    discord_guild_name: str,
) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            UPDATE accounts
            SET
                discord_guild_id = %s,
                discord_guild_name = %s
            WHERE discord_user_id = %s
            AND (
                discord_guild_id IS DISTINCT FROM %s
                OR discord_guild_name IS DISTINCT FROM %s
            )
            """,
            (
                discord_guild_id,
                discord_guild_name,
                discord_user_id,
                discord_guild_id,
                discord_guild_name,
            ),
        )

    return result.rowcount > 0


async def update_account_nickname(
    discord_user_id: int, genshin_uid: str, cyrene_nickname: str | None
) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            UPDATE accounts
            SET cyrene_nickname = %s
            WHERE discord_user_id = %s
            AND genshin_uid = %s
            """,
            (cyrene_nickname, discord_user_id, genshin_uid),
        )

    return result.rowcount > 0


async def get_accounts(discord_user_id: int) -> list[dict]:
    crypto = HoYoLABCrypto()

    async with get_pool().connection() as connection:
        rows = await connection.execute(
            """
            SELECT *
            FROM accounts
            WHERE discord_user_id = %s
            ORDER BY created_at ASC
            """,
            (discord_user_id,),
        )

        rows = await rows.fetchall()

    accounts = []

    for row in rows:
        credentials = HoYoLABCredentials(
            stoken=(crypto.decrypt(row["stoken"]) if row["stoken"] else None),
            ltuid_v2=(crypto.decrypt(row["ltuid_v2"]) if row["ltuid_v2"] else None),
            ltoken_v2=(crypto.decrypt(row["ltoken_v2"]) if row["ltoken_v2"] else None),
            ltmid_v2=(crypto.decrypt(row["ltmid_v2"]) if row["ltmid_v2"] else None),
            cookie_token_v2=(
                crypto.decrypt(row["cookie_token_v2"]) if row["cookie_token_v2"] else None
            ),
            account_mid_v2=(
                crypto.decrypt(row["account_mid_v2"]) if row["account_mid_v2"] else None
            ),
            account_id_v2=(crypto.decrypt(row["account_id_v2"]) if row["account_id_v2"] else None),
            ltuid=(crypto.decrypt(row["ltuid"]) if row["ltuid"] else None),
            ltoken=(crypto.decrypt(row["ltoken"]) if row["ltoken"] else None),
            cookie_token=(crypto.decrypt(row["cookie_token"]) if row["cookie_token"] else None),
            account_id=(crypto.decrypt(row["account_id"]) if row["account_id"] else None),
        )

        accounts.append(
            {
                "id": row["id"],
                "discord_user_id": row["discord_user_id"],
                "discord_username": row["discord_username"],
                "discord_display_name": row["discord_display_name"],
                "discord_guild_id": row["discord_guild_id"],
                "discord_guild_name": row["discord_guild_name"],
                "credentials": credentials,
                "genshin_uid": row["genshin_uid"],
                "genshin_server": row["genshin_server"],
                "nickname": row["nickname"],
                "cyrene_nickname": row["cyrene_nickname"],
                "level": row["level"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "profile_checked_at": row.get("profile_checked_at"),
            }
        )

    from .account_profiles import refresh_account_profiles

    await refresh_account_profiles(accounts)
    return accounts


async def get_account(discord_user_id: int, genshin_uid: str) -> dict | None:
    crypto = HoYoLABCrypto()

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT *
            FROM accounts
            WHERE discord_user_id = %s
            AND genshin_uid = %s
            LIMIT 1
            """,
            (discord_user_id, genshin_uid),
        )

        row = await result.fetchone()

    if row is None:
        return None

    credentials = HoYoLABCredentials(
        stoken=(crypto.decrypt(row["stoken"]) if row["stoken"] else None),
        ltuid_v2=(crypto.decrypt(row["ltuid_v2"]) if row["ltuid_v2"] else None),
        ltoken_v2=(crypto.decrypt(row["ltoken_v2"]) if row["ltoken_v2"] else None),
        ltmid_v2=(crypto.decrypt(row["ltmid_v2"]) if row["ltmid_v2"] else None),
        cookie_token_v2=(
            crypto.decrypt(row["cookie_token_v2"]) if row["cookie_token_v2"] else None
        ),
        account_mid_v2=(crypto.decrypt(row["account_mid_v2"]) if row["account_mid_v2"] else None),
        account_id_v2=(crypto.decrypt(row["account_id_v2"]) if row["account_id_v2"] else None),
        ltuid=(crypto.decrypt(row["ltuid"]) if row["ltuid"] else None),
        ltoken=(crypto.decrypt(row["ltoken"]) if row["ltoken"] else None),
        cookie_token=(crypto.decrypt(row["cookie_token"]) if row["cookie_token"] else None),
        account_id=(crypto.decrypt(row["account_id"]) if row["account_id"] else None),
    )

    account = {
        "id": row["id"],
        "discord_user_id": row["discord_user_id"],
        "discord_username": row["discord_username"],
        "discord_display_name": row["discord_display_name"],
        "discord_guild_id": row["discord_guild_id"],
        "discord_guild_name": row["discord_guild_name"],
        "credentials": credentials,
        "genshin_uid": row["genshin_uid"],
        "genshin_server": row["genshin_server"],
        "nickname": row["nickname"],
        "cyrene_nickname": row["cyrene_nickname"],
        "level": row["level"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "profile_checked_at": row.get("profile_checked_at"),
    }

    from .account_profiles import refresh_account_profiles

    await refresh_account_profiles([account])
    return account


async def get_event_activity_check(
    discord_user_id: int,
    genshin_uid: str,
    activity_type: str,
    period_key: str,
) -> bool | None:

    return await events_store.get_event_activity_check(
        get_pool(), discord_user_id, genshin_uid, activity_type, period_key
    )


async def set_event_activity_check(
    discord_user_id: int,
    genshin_uid: str,
    activity_type: str,
    period_key: str,
    checked: bool,
) -> bool:

    return await events_store.set_event_activity_check(
        get_pool(), discord_user_id, genshin_uid, activity_type, period_key, checked
    )


async def get_limited_event_checks(discord_user_id: int, genshin_uid: str) -> dict[str, bool]:
    return await events_store.get_limited_event_checks(get_pool(), discord_user_id, genshin_uid)


async def get_event_activity_checks(
    discord_user_id: int,
    genshin_uid: str,
    daily_period_key: str,
    trounce_period_key: str,
) -> dict[str, bool | None]:

    return await events_store.get_event_activity_checks(
        get_pool(), discord_user_id, genshin_uid, daily_period_key, trounce_period_key
    )


async def create_reminder(
    discord_user_id: int,
    reminder_type: str,
    *,
    genshin_uid: str | None = None,
    config: dict | None = None,
    delivery_type: str = "dm",
    reminder_mode: str = "automatic",
    next_trigger_at: datetime | None = None,
) -> int:

    return await reminder_store.create_reminder(
        get_pool(),
        discord_user_id,
        reminder_type,
        genshin_uid=genshin_uid,
        config=config,
        delivery_type=delivery_type,
        reminder_mode=reminder_mode,
        next_trigger_at=next_trigger_at,
    )


async def get_reminders(discord_user_id: int, *, enabled_only: bool = False) -> list[dict]:
    return await reminder_store.get_reminders(
        get_pool(), discord_user_id, enabled_only=enabled_only
    )


async def get_reminder(discord_user_id: int, reminder_id: int) -> dict | None:
    return await reminder_store.get_reminder(get_pool(), discord_user_id, reminder_id)


_UNSET = achievement_store.UNSET


async def update_reminder(
    discord_user_id: int,
    reminder_id: int,
    *,
    enabled: bool | None = None,
    config: dict | None = None,
    reminder_mode: str | None = None,
    next_trigger_at: datetime | None | object = _UNSET,
    last_triggered_at: datetime | None = None,
) -> bool:
    return await reminder_store.update_reminder(
        get_pool(),
        discord_user_id,
        reminder_id,
        enabled=enabled,
        config=config,
        reminder_mode=reminder_mode,
        next_trigger_at=next_trigger_at,
        last_triggered_at=last_triggered_at,
    )


async def delete_reminder(discord_user_id: int, reminder_id: int) -> bool:
    return await reminder_store.delete_reminder(get_pool(), discord_user_id, reminder_id)


async def get_due_reminders() -> list[dict]:
    return await reminder_store.get_due_reminders(get_pool())


async def get_achievement_progress(
    discord_user_id: int,
    account_id: int,
) -> list[dict]:
    return await achievement_store.get_progress(get_pool(), discord_user_id, account_id)


async def get_achievement_tier_progress(
    discord_user_id: int, account_id: int, achievement_id: str, tier: int
) -> dict | None:

    return await achievement_store.get_tier(
        get_pool(), discord_user_id, account_id, achievement_id, tier
    )


async def update_achievement_tier(
    discord_user_id: int,
    account_id: int,
    achievement_id: str,
    tier: int,
    *,
    completed: bool | None = None,
    current: int | None = None,
    completed_at: datetime | None | object = _UNSET,
    note: str | None | object = _UNSET,
) -> bool:

    return await achievement_store.update_tier(
        get_pool(),
        discord_user_id,
        account_id,
        achievement_id,
        tier,
        completed=completed,
        current=current,
        completed_at=completed_at,
        note=note,
    )


async def update_achievement_tier_note(
    discord_user_id: int,
    account_id: int,
    achievement_id: str,
    tier: int,
    note: str | None,
) -> bool:

    return await achievement_store.update_tier(
        get_pool(), discord_user_id, account_id, achievement_id, tier, note=note
    )


async def import_achievement_progress(
    discord_user_id: int, account_id: int, progress_data: dict
) -> None:
    return await achievement_store.import_progress(
        get_pool(), discord_user_id, account_id, progress_data
    )


async def get_wish_history(
    account_id: int,
) -> list[dict]:
    return await wish_store.get_history(get_pool(), account_id)


async def import_wish_history(
    account_id: int,
    wishes: list[dict],
) -> int:
    return await wish_store.import_history(get_pool(), account_id, wishes)


async def create_custom_event(
    discord_user_id: int,
    title: str,
    description: str | None,
    account_scope: str,
    account_id: int | None,
    start_at: datetime,
    end_at: datetime | None,
    recurrence: dict,
    colour: str,
    reminder_minutes: int | None,
    progress: list,
    icon_url: str | None = None,
) -> dict:
    return await events_store.create_custom_event(
        get_pool(),
        discord_user_id,
        title,
        description,
        account_scope,
        account_id,
        start_at,
        end_at,
        recurrence,
        colour,
        reminder_minutes,
        progress,
        icon_url,
    )


async def get_custom_events(
    discord_user_id: int,
    account_id: int | None = None,
) -> list[dict]:
    return await events_store.get_custom_events(get_pool(), discord_user_id, account_id)


async def get_visible_custom_event(
    discord_user_id: int,
    event_id: int,
    account_id: int,
) -> dict | None:
    return await events_store.get_visible_custom_event(
        get_pool(), discord_user_id, event_id, account_id
    )


async def reorder_custom_events(
    discord_user_id: int,
    account_id: int,
    ordered_event_ids: list[int],
) -> bool:
    return await events_store.reorder_custom_events(
        get_pool(), discord_user_id, account_id, ordered_event_ids
    )


async def get_custom_event(
    discord_user_id: int,
    event_id: int,
) -> dict | None:
    return await events_store.get_custom_event(get_pool(), discord_user_id, event_id)


async def get_custom_event_account_progress(
    discord_user_id: int,
    event_id: int,
    account_id: int,
) -> dict[int, int]:
    return await events_store.get_custom_event_account_progress(
        get_pool(), discord_user_id, event_id, account_id
    )


async def change_custom_event_account_progress(
    discord_user_id: int,
    event_id: int,
    account_id: int,
    objective_index: int,
    amount: int,
    target: int,
) -> int | None:
    return await events_store.change_custom_event_account_progress(
        get_pool(), discord_user_id, event_id, account_id, objective_index, amount, target
    )


async def update_custom_event(
    discord_user_id: int,
    event_id: int,
    title: str,
    description: str | None,
    account_scope: str,
    account_id: int | None,
    start_at: datetime,
    end_at: datetime | None,
    recurrence: dict,
    colour: str,
    reminder_minutes: int | None,
    progress: list,
    icon_url: str | None = None,
) -> dict | None:
    return await events_store.update_custom_event(
        get_pool(),
        discord_user_id,
        event_id,
        title,
        description,
        account_scope,
        account_id,
        start_at,
        end_at,
        recurrence,
        colour,
        reminder_minutes,
        progress,
        icon_url,
    )


async def delete_custom_event(
    discord_user_id: int,
    event_id: int,
) -> bool:
    return await events_store.delete_custom_event(get_pool(), discord_user_id, event_id)


async def set_custom_event_completion(
    discord_user_id: int,
    event_id: int,
    occurrence_start,
    completed: bool,
    account_id: int | None = None,
) -> bool:
    return await events_store.set_custom_event_completion(
        get_pool(), discord_user_id, event_id, occurrence_start, completed, account_id
    )


async def get_custom_event_completions(
    discord_user_id: int,
    event_id: int,
    account_id: int | None = None,
) -> list[dict]:
    return await events_store.get_custom_event_completions(
        get_pool(), discord_user_id, event_id, account_id
    )


async def get_gift_code_settings(account_id: int) -> dict:
    return await automation_store.get_gift_settings(get_pool(), account_id)


async def set_gift_code_auto_claim(account_id: int, enabled: bool) -> None:
    await automation_store.set_enabled(get_pool(), account_id, enabled)


async def get_gift_code_redemptions(account_id: int) -> dict[str, dict]:
    return await automation_store.get_redemptions(get_pool(), account_id)


async def reserve_gift_code_redemption(account_id: int, code: str, *, automatic=True) -> bool:
    return await automation_store.reserve_code(get_pool(), account_id, code, automatic=automatic)


async def update_gift_code_redemption(
    account_id: int,
    code: str,
    status: str,
    message: str | None = None,
    *,
    genshin_uid: str | None = None,
) -> None:
    await automation_store.update_redemption(
        get_pool(),
        account_id,
        code,
        status,
        message,
        genshin_uid=genshin_uid,
    )


async def get_gift_code_auto_claim_accounts() -> list[dict]:
    return await automation_store.get_enabled_accounts(get_pool())


async def get_daily_checkin_settings(account_id: int) -> dict:
    return await automation_store.get_checkin_settings(get_pool(), account_id)


async def set_daily_checkin_enabled(account_id: int, enabled: bool) -> None:
    await automation_store.set_enabled(get_pool(), account_id, enabled, daily=True)


async def get_daily_checkin_accounts() -> list[dict]:
    return await automation_store.get_enabled_accounts(get_pool(), daily=True)


async def reserve_daily_checkin(account_id: int, today) -> bool:
    return await automation_store.reserve_checkin(get_pool(), account_id, today)


async def update_daily_checkin_status(
    account_id: int,
    *,
    status: str,
    message: str,
    claimed_date=None,
    genshin_uid: str | None = None,
) -> None:
    await automation_store.update_checkin(
        get_pool(),
        account_id,
        status,
        message,
        claimed_date,
        genshin_uid=genshin_uid,
    )


async def _initialise_shared_weapon_scans(connection):
    """Ensure UID-owned scanner storage exists."""
    await connection.execute(
        """CREATE TABLE IF NOT EXISTS weapon_account_scan_snapshots (
                genshin_uid TEXT PRIMARY KEY,
                scan_id TEXT NOT NULL,
                weapons JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"""
    )


async def get_manual_weapons(user_id: int, account_id: int) -> list[dict]:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """SELECT m.copy_id, m.weapon FROM manual_weapons m
            JOIN accounts a ON a.genshin_uid::text = m.genshin_uid
            WHERE a.discord_user_id = %s AND a.id = %s
            ORDER BY m.created_at, m.copy_id""",
            (user_id, account_id),
        )
        return [dict(row["weapon"], copy_id=row["copy_id"]) for row in await result.fetchall()]


async def add_manual_weapon(user_id: int, account_id: int, copy_id: str, weapon: dict):
    # Keep the creator as provenance only; access is shared through the linked UID.
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """INSERT INTO manual_weapons (copy_id, discord_user_id, genshin_uid, weapon)
            SELECT %s, discord_user_id, genshin_uid::text, %s FROM accounts
            WHERE discord_user_id = %s AND id = %s""",
            (copy_id, Jsonb(weapon), user_id, account_id),
        )
        if result.rowcount != 1:
            raise ValueError("Account no longer linked.")


async def remove_manual_weapon(user_id: int, account_id: int, copy_id: str) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """DELETE FROM manual_weapons
            WHERE EXISTS (SELECT 1 FROM accounts a
                WHERE a.discord_user_id = %s AND a.id = %s
                  AND manual_weapons.genshin_uid = a.genshin_uid::text)
              AND copy_id = %s""",
            (user_id, account_id, copy_id),
        )
        return result.rowcount == 1


async def get_weapon_scan(user_id: int, account_id: int):
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """SELECT s.scan_id, s.weapons FROM weapon_account_scan_snapshots s
            JOIN accounts a ON a.genshin_uid::text = s.genshin_uid
            WHERE a.discord_user_id = %s AND a.id = %s""",
            (user_id, account_id),
        )
        row = await result.fetchone()
        return dict(row) if row else {"weapons": [], "scan_id": None}


async def replace_weapon_scan(user_id: int, account_id: int, scan_id: str, weapons: list[dict]):
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """INSERT INTO weapon_account_scan_snapshots (genshin_uid, scan_id, weapons)
            SELECT genshin_uid::text, %s, %s FROM accounts
            WHERE discord_user_id = %s AND id = %s
            ON CONFLICT (genshin_uid) DO UPDATE
              SET scan_id = EXCLUDED.scan_id, weapons = EXCLUDED.weapons, updated_at = NOW()""",
            (scan_id, Jsonb(weapons), user_id, account_id),
        )
        if result.rowcount != 1:
            raise ValueError("The scan account is no longer linked.")


async def remove_scanned_weapon(user_id: int, account_id: int, copy_id: str) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """UPDATE weapon_account_scan_snapshots s
            SET weapons = COALESCE((SELECT jsonb_agg(item ORDER BY ordinal)
                FROM jsonb_array_elements(s.weapons) WITH ORDINALITY AS entries(item, ordinal)
                WHERE item->>'scan_copy_id' IS DISTINCT FROM %s), '[]'::jsonb), updated_at = NOW()
            WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.id = %s
                AND a.discord_user_id = %s
                AND a.genshin_uid::text = s.genshin_uid)
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(s.weapons) item
                WHERE item->>'scan_copy_id' = %s)""",
            (copy_id, account_id, user_id, copy_id),
        )
        return result.rowcount == 1


async def get_reminder_recipients(genshin_uid: str) -> list[int]:
    return await reminder_store.get_reminder_recipients(get_pool(), genshin_uid)
