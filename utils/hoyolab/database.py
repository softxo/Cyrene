import os
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool
from datetime import datetime, timezone
from .auth import HoYoLABCredentials
from .crypto import HoYoLABCrypto
from psycopg.types.json import Jsonb


_pool: AsyncConnectionPool | None = None


def get_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")

    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not configured."
        )

    return database_url


async def initialise_database() -> None:
    global _pool

    if _pool is None:
        _pool = AsyncConnectionPool(
            conninfo=get_database_url(),
            min_size=1,
            max_size=10,
            open=False,
            kwargs={
                "row_factory": dict_row
            }
        )

        await _pool.open()

    async with _pool.connection() as connection:

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
                ADD COLUMN IF NOT EXISTS stoken TEXT
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_accounts_discord_user
            ON accounts(discord_user_id)
            """
        )

        # =========================================
        # CHARACTER PLANNER
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS character_plans (
                discord_user_id BIGINT NOT NULL,
                account_id INTEGER NOT NULL REFERENCES accounts(id)
                    ON DELETE CASCADE,
                character_id BIGINT NOT NULL,
                plan JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                PRIMARY KEY (
                    discord_user_id,
                    account_id,
                    character_id
                )
            )
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_character_plans_account
            ON character_plans(discord_user_id, account_id)
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
        # ACHIEVEMENTS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS achievement_progress (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

                discord_user_id BIGINT NOT NULL,
                account_id INTEGER REFERENCES accounts(id)
                    ON DELETE CASCADE,
                achievement_id TEXT NOT NULL,
                tier INTEGER NOT NULL,

                completed BOOLEAN NOT NULL DEFAULT FALSE,
                current INTEGER NOT NULL DEFAULT 0,
                completed_at TIMESTAMPTZ,

                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                UNIQUE(discord_user_id, achievement_id, tier)
            )
            """
        )

        await connection.execute(
            """
            ALTER TABLE achievement_progress
            ADD COLUMN IF NOT EXISTS account_id INTEGER
                REFERENCES accounts(id) ON DELETE CASCADE
            """
        )

        await connection.execute(
            """
            ALTER TABLE achievement_progress
            DROP CONSTRAINT IF EXISTS
                achievement_progress_discord_user_id_achievement_id_tier_key
            """
        )

        # Existing user-wide progress belongs to the user's first linked
        # account. Rows without a linked account remain available for a later
        # migration instead of being discarded.
        await connection.execute(
            """
            UPDATE achievement_progress AS progress
            SET account_id = (
                SELECT id
                FROM accounts
                WHERE discord_user_id = progress.discord_user_id
                ORDER BY id
                LIMIT 1
            )
            WHERE progress.account_id IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM accounts
                  WHERE discord_user_id = progress.discord_user_id
              )
            """
        )

        await connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS
                idx_achievement_progress_account_unique
            ON achievement_progress (
                discord_user_id,
                account_id,
                achievement_id,
                tier
            )
            WHERE account_id IS NOT NULL
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_achievement_progress_user
            ON achievement_progress(discord_user_id)
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_achievement_progress_user_completed
            ON achievement_progress(discord_user_id, completed)
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_achievement_progress_achievement
            ON achievement_progress(discord_user_id, achievement_id)
            """
        )

        # =========================================
        # WISH HISTORY
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS wish_history (
                account_id INTEGER NOT NULL REFERENCES accounts(id)
                    ON DELETE CASCADE,
                wish_id TEXT NOT NULL,
                genshin_uid TEXT NOT NULL,
                gacha_type TEXT NOT NULL,
                item_name TEXT NOT NULL,
                item_type TEXT NOT NULL,
                rank_type INTEGER NOT NULL,
                icon_url TEXT,
                pulled_at TIMESTAMP NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (account_id, wish_id)
            )
            """
        )

        await connection.execute(
            """
            ALTER TABLE wish_history
            ADD COLUMN IF NOT EXISTS icon_url TEXT
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_wish_history_account_time
            ON wish_history(account_id, pulled_at DESC, wish_id DESC)
            """
        )

        # =========================================
        # EVENT ACTIVITY CHECKS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS event_activity_checks (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

                discord_user_id BIGINT NOT NULL,
                genshin_uid TEXT NOT NULL,
                activity_type TEXT NOT NULL,
                period_key TEXT NOT NULL,

                checked BOOLEAN NOT NULL DEFAULT FALSE,

                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                UNIQUE(
                    discord_user_id,
                    genshin_uid,
                    activity_type,
                    period_key
                )
            )
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_event_activity_checks_user
            ON event_activity_checks(discord_user_id)
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_event_activity_checks_account
            ON event_activity_checks(discord_user_id, genshin_uid)
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
                    REFERENCES accounts(id) ON DELETE CASCADE,

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
                    (account_scope = 'account' AND account_id IS NOT NULL)
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

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS custom_event_account_order (
                discord_user_id BIGINT NOT NULL,

                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,

                event_id BIGINT NOT NULL
                    REFERENCES custom_events(id) ON DELETE CASCADE,

                sort_order BIGINT NOT NULL DEFAULT 0,

                PRIMARY KEY (
                    discord_user_id,
                    account_id,
                    event_id
                )
            )
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS
                idx_custom_event_account_order_order
            ON custom_event_account_order (
                discord_user_id,
                account_id,
                sort_order
            )
            """
        )

        await connection.execute(
            """
            INSERT INTO custom_event_account_order (
                discord_user_id,
                account_id,
                event_id,
                sort_order
            )
            SELECT
                e.discord_user_id,
                a.id,
                e.id,
                e.sort_order
            FROM custom_events AS e
            INNER JOIN accounts AS a
                ON a.discord_user_id = e.discord_user_id
            WHERE
                e.account_scope = 'all'
                OR e.account_id = a.id
            ON CONFLICT (
                discord_user_id,
                account_id,
                event_id
            )
            DO NOTHING
            """
        )

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
        # GIFT CODE SETTINGS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS gift_code_settings (
                account_id INTEGER PRIMARY KEY
                    REFERENCES accounts(id) ON DELETE CASCADE,

                auto_claim_enabled BOOLEAN NOT NULL DEFAULT FALSE,

                updated_at TIMESTAMPTZ NOT NULL
                    DEFAULT CURRENT_TIMESTAMP
            )
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

        # =========================================
        # GIFT CODE REDEMPTIONS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS gift_code_redemptions (
                id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

                account_id INTEGER NOT NULL
                    REFERENCES accounts(id) ON DELETE CASCADE,

                code TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'failed',
                message TEXT,

                attempted_at TIMESTAMPTZ NOT NULL
                    DEFAULT CURRENT_TIMESTAMP,

                UNIQUE (account_id, code)
            )
            """
        )

        # =========================================
        # DAILY HOYOLAB CHECK-IN SETTINGS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_checkin_settings (
                account_id INTEGER PRIMARY KEY
                    REFERENCES accounts(id) ON DELETE CASCADE,

                auto_checkin_enabled BOOLEAN NOT NULL DEFAULT FALSE,

                last_claimed_date DATE,
                last_status TEXT,
                last_message TEXT,

                updated_at TIMESTAMPTZ NOT NULL
                    DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def get_pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError(
            "HoYoLAB database pool has not been initialised."
        )

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
    level: int | None = None
) -> None:
    crypto = HoYoLABCrypto()

    encrypted_stoken = (
        crypto.encrypt(credentials.stoken)
        if credentials.stoken
        else None
    )

    encrypted_ltuid_v2 = (
        crypto.encrypt(credentials.ltuid_v2)
        if credentials.ltuid_v2
        else None
    )

    encrypted_ltoken_v2 = (
        crypto.encrypt(credentials.ltoken_v2)
        if credentials.ltoken_v2
        else None
    )

    encrypted_ltmid_v2 = (
        crypto.encrypt(credentials.ltmid_v2)
        if credentials.ltmid_v2
        else None
    )

    encrypted_cookie_token_v2 = (
        crypto.encrypt(credentials.cookie_token_v2)
        if credentials.cookie_token_v2
        else None
    )

    encrypted_account_mid_v2 = (
        crypto.encrypt(credentials.account_mid_v2)
        if credentials.account_mid_v2
        else None
    )

    encrypted_account_id_v2 = (
        crypto.encrypt(credentials.account_id_v2)
        if credentials.account_id_v2
        else None
    )

    encrypted_ltuid = (
        crypto.encrypt(credentials.ltuid)
        if credentials.ltuid
        else None
    )

    encrypted_ltoken = (
        crypto.encrypt(credentials.ltoken)
        if credentials.ltoken
        else None
    )
    
    encrypted_cookie_token = (
        crypto.encrypt(credentials.cookie_token)
        if credentials.cookie_token
        else None
    )

    encrypted_account_id = (
        crypto.encrypt(credentials.account_id)
        if credentials.account_id
        else None
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

        # Retrieve the account ID, whether it was newly inserted or updated by the upsert.
        account_result = await connection.execute(
            """
            SELECT id
            FROM accounts
            WHERE discord_user_id = %s
              AND genshin_uid = %s
            """,
            (discord_user_id, genshin_uid),
        )

        account_row = await account_result.fetchone()
        saved_account_id = int(account_row["id"])

        # Initialise missing order entries for events visible to this account. Existing custom ordering is preserved.
        await connection.execute(
            """
            INSERT INTO custom_event_account_order (
                discord_user_id,
                account_id,
                event_id,
                sort_order
            )
            SELECT
                e.discord_user_id,
                %s,
                e.id,
                COALESCE(
                    (
                        SELECT MAX(o.sort_order)
                        FROM custom_event_account_order o
                        WHERE o.discord_user_id = e.discord_user_id
                          AND o.account_id = %s
                    ),
                    0
                ) + ROW_NUMBER() OVER (
                    ORDER BY e.sort_order ASC, e.start_at ASC, e.id ASC
                )
            FROM custom_events e
            WHERE e.discord_user_id = %s
              AND (
                  e.account_scope = 'all'
                  OR e.account_id = %s
              )
              AND NOT EXISTS (
                  SELECT 1
                  FROM custom_event_account_order existing
                  WHERE existing.discord_user_id = e.discord_user_id
                    AND existing.account_id = %s
                    AND existing.event_id = e.id
              )
            ON CONFLICT (
                discord_user_id,
                account_id,
                event_id
            )
            DO NOTHING
            """,
            (
                saved_account_id,
                saved_account_id,
                discord_user_id,
                saved_account_id,
                saved_account_id,
            ),
        )


async def update_account_cookie_token(
    discord_user_id: int,
    genshin_uid: str,
    cookie_token_v2: str,
) -> None:
    """Persist a refreshed HoYoLAB cookie token."""
    encrypted_cookie_token = HoYoLABCrypto().encrypt(
        cookie_token_v2
    )

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


async def get_account_count(
    discord_user_id: int
) -> int:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM accounts
            WHERE discord_user_id = %s
            """,
            (discord_user_id,)
        )

        row = await result.fetchone()

    return row["count"]


async def account_exists(
    discord_user_id: int,
    genshin_uid: str
) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT 1
            FROM accounts
            WHERE discord_user_id = %s
            AND genshin_uid = %s
            LIMIT 1
            """,
            (
                discord_user_id,
                genshin_uid
            )
        )

        row = await result.fetchone()

    return row is not None


async def get_character_plans(
    discord_user_id: int,
    account_id: int,
) -> list[dict]:
    """Return the saved Character Planner entries for an account."""

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT plan
            FROM character_plans
            WHERE discord_user_id = %s
              AND account_id = %s
            ORDER BY updated_at ASC, character_id ASC
            """,
            (discord_user_id, account_id),
        )
        rows = await result.fetchall()

    return [row["plan"] for row in rows]


async def replace_character_plans(
    discord_user_id: int,
    account_id: int,
    plans: list[dict],
) -> None:
    """Replace all Character Planner entries for one account."""

    async with get_pool().connection() as connection:
        await connection.execute(
            """
            DELETE FROM character_plans
            WHERE discord_user_id = %s
              AND account_id = %s
            """,
            (discord_user_id, account_id),
        )

        for plan in plans:
            await connection.execute(
                """
                INSERT INTO character_plans (
                    discord_user_id,
                    account_id,
                    character_id,
                    plan,
                    updated_at
                )
                VALUES (%s, %s, %s, %s, NOW())
                """,
                (
                    discord_user_id,
                    account_id,
                    int(plan["id"]),
                    Jsonb(plan),
                ),
            )


async def delete_account(
    discord_user_id: int,
    genshin_uid: str
) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            DELETE FROM accounts
            WHERE discord_user_id = %s
            AND genshin_uid = %s
            """,
            (
                discord_user_id,
                genshin_uid
            )
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
                discord_display_name
            )
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
                discord_guild_name
            )
        )

    return result.rowcount > 0


async def update_account_nickname(
    discord_user_id: int,
    genshin_uid: str,
    cyrene_nickname: str | None
) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            UPDATE accounts
            SET cyrene_nickname = %s
            WHERE discord_user_id = %s
            AND genshin_uid = %s
            """,
            (
                cyrene_nickname,
                discord_user_id,
                genshin_uid
            )
        )

    return result.rowcount > 0


async def get_accounts(
    discord_user_id: int
) -> list[dict]:
    crypto = HoYoLABCrypto()

    async with get_pool().connection() as connection:
        rows = await connection.execute(
            """
            SELECT *
            FROM accounts
            WHERE discord_user_id = %s
            ORDER BY created_at ASC
            """,
            (discord_user_id,)
        )

        rows = await rows.fetchall()

    accounts = []

    for row in rows:
        credentials = HoYoLABCredentials(
            stoken=(
                crypto.decrypt(row["stoken"])
                if row["stoken"]
                else None
            ),
            ltuid_v2=(
                crypto.decrypt(row["ltuid_v2"])
                if row["ltuid_v2"]
                else None
            ),
            ltoken_v2=(
                crypto.decrypt(row["ltoken_v2"])
                if row["ltoken_v2"]
                else None
            ),
            ltmid_v2=(
                crypto.decrypt(row["ltmid_v2"])
                if row["ltmid_v2"]
                else None
            ),
            cookie_token_v2=(
                crypto.decrypt(row["cookie_token_v2"])
                if row["cookie_token_v2"]
                else None
            ),
            account_mid_v2=(
                crypto.decrypt(row["account_mid_v2"])
                if row["account_mid_v2"]
                else None
            ),
            account_id_v2=(
                crypto.decrypt(row["account_id_v2"])
                if row["account_id_v2"]
                else None
            ),
            ltuid=(
                crypto.decrypt(row["ltuid"])
                if row["ltuid"]
                else None
            ),
            ltoken=(
                crypto.decrypt(row["ltoken"])
                if row["ltoken"]
                else None
            ),
            cookie_token=(
                crypto.decrypt(row["cookie_token"])
                if row["cookie_token"]
                else None
            ),
            account_id=(
                crypto.decrypt(row["account_id"])
                if row["account_id"]
                else None
            ),
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
                "updated_at": row["updated_at"]
            }
        )

    return accounts


async def get_account(
    discord_user_id: int,
    genshin_uid: str
) -> dict | None:
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
            (
                discord_user_id,
                genshin_uid
            )
        )

        row = await result.fetchone()

    if row is None:
        return None

    credentials = HoYoLABCredentials(
        stoken=(
            crypto.decrypt(row["stoken"])
            if row["stoken"]
            else None
        ),
        ltuid_v2=(
            crypto.decrypt(row["ltuid_v2"])
            if row["ltuid_v2"]
            else None
        ),
        ltoken_v2=(
            crypto.decrypt(row["ltoken_v2"])
            if row["ltoken_v2"]
            else None
        ),
        ltmid_v2=(
            crypto.decrypt(row["ltmid_v2"])
            if row["ltmid_v2"]
            else None
        ),
        cookie_token_v2=(
            crypto.decrypt(row["cookie_token_v2"])
            if row["cookie_token_v2"]
            else None
        ),
        account_mid_v2=(
            crypto.decrypt(row["account_mid_v2"])
            if row["account_mid_v2"]
            else None
        ),
        account_id_v2=(
            crypto.decrypt(row["account_id_v2"])
            if row["account_id_v2"]
            else None
        ),
        ltuid=(
            crypto.decrypt(row["ltuid"])
            if row["ltuid"]
            else None
        ),
        ltoken=(
            crypto.decrypt(row["ltoken"])
            if row["ltoken"]
            else None
        ),
        cookie_token=(
            crypto.decrypt(row["cookie_token"])
            if row["cookie_token"]
            else None
        ),
        account_id=(
            crypto.decrypt(row["account_id"])
            if row["account_id"]
            else None
        ),
)

    return {
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
        "updated_at": row["updated_at"]
    }
    

async def get_event_activity_check(
    discord_user_id: int,
    genshin_uid: str,
    activity_type: str,
    period_key: str,
) -> bool | None:

    async with get_pool().connection() as connection:

        result = await connection.execute(
            """
            SELECT checked
            FROM event_activity_checks
            WHERE discord_user_id = %s
            AND genshin_uid = %s
            AND activity_type = %s
            AND period_key = %s
            LIMIT 1
            """,
            (
                discord_user_id,
                genshin_uid,
                activity_type,
                period_key,
            )
        )

        row = await result.fetchone()

    if row is None:
        return None

    return bool(row["checked"])


async def set_event_activity_check(
    discord_user_id: int,
    genshin_uid: str,
    activity_type: str,
    period_key: str,
    checked: bool,
) -> bool:

    async with get_pool().connection() as connection:

        await connection.execute(
            """
            INSERT INTO event_activity_checks (
                discord_user_id,
                genshin_uid,
                activity_type,
                period_key,
                checked
            )
            VALUES (
                %s, %s, %s, %s, %s
            )

            ON CONFLICT (
                discord_user_id,
                genshin_uid,
                activity_type,
                period_key
            )

            DO UPDATE SET
                checked = EXCLUDED.checked,
                updated_at = NOW()
            """,
            (
                discord_user_id,
                genshin_uid,
                activity_type,
                period_key,
                checked,
            )
        )

    return True


async def get_event_activity_checks(
    discord_user_id: int,
    genshin_uid: str,
    daily_period_key: str,
    trounce_period_key: str,
) -> dict[str, bool | None]:

    async with get_pool().connection() as connection:

        result = await connection.execute(
            """
            SELECT activity_type, checked
            FROM event_activity_checks
            WHERE discord_user_id = %s
            AND genshin_uid = %s
            AND (
                (activity_type = 'daily_commissions' AND period_key = %s)
                OR
                (activity_type = 'trounce_domains' AND period_key = %s)
            )
            """,
            (
                discord_user_id,
                genshin_uid,
                daily_period_key,
                trounce_period_key,
            )
        )

        rows = await result.fetchall()

    checks = {
        "daily_commissions": None,
        "trounce_domains": None,
    }

    for row in rows:
        checks[row["activity_type"]] = bool(row["checked"])

    return checks


async def create_reminder(
    discord_user_id: int,
    reminder_type: str,
    *,
    genshin_uid: str | None = None,
    config: dict | None = None,
    delivery_type: str = "dm",
    reminder_mode: str = "automatic",
    next_trigger_at: datetime | None = None
) -> int:

    if reminder_mode not in {
        "automatic",
        "manual"
    }:
        raise ValueError(
            "Invalid reminder mode."
        )

    if (
        reminder_mode == "automatic"
        and next_trigger_at is None
    ):
        next_trigger_at = datetime.now(timezone.utc)

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT id
            FROM reminders
            WHERE discord_user_id = %s
            AND reminder_type = %s
            AND reminder_mode = %s
            AND genshin_uid IS NOT DISTINCT FROM %s
            LIMIT 1
            """,
            (
                discord_user_id,
                reminder_type,
                reminder_mode,
                genshin_uid
            )
        )

        existing = await result.fetchone()

        if existing is not None:
            reminder_id = existing["id"]

            await connection.execute(
                """
                UPDATE reminders
                SET
                    enabled = TRUE,
                    delivery_type = %s,
                    config = %s,
                    next_trigger_at = %s,
                    last_triggered_at = NULL,
                    updated_at = NOW()
                WHERE discord_user_id = %s
                AND id = %s
                """,
                (
                    delivery_type,
                    Jsonb(config or {}),
                    next_trigger_at,
                    discord_user_id,
                    reminder_id
                )
            )

            return reminder_id

        result = await connection.execute(
            """
            INSERT INTO reminders (
                discord_user_id,
                reminder_type,
                reminder_mode,
                genshin_uid,
                enabled,
                delivery_type,
                config,
                next_trigger_at
            )
            VALUES (
                %s, %s, %s, %s,
                TRUE,
                %s,
                %s,
                %s
            )
            RETURNING id
            """,
            (
                discord_user_id,
                reminder_type,
                reminder_mode,
                genshin_uid,
                delivery_type,
                Jsonb(config or {}),
                next_trigger_at
            )
        )

        row = await result.fetchone()

    return row["id"]


async def get_reminders(
    discord_user_id: int,
    *,
    enabled_only: bool = False
) -> list[dict]:
    async with get_pool().connection() as connection:
        query = """
            SELECT
                r.*,

                a.nickname AS account_nickname,
                a.cyrene_nickname AS account_cyrene_nickname,
                a.level AS account_level,
                a.genshin_server AS account_server

            FROM reminders r

            LEFT JOIN accounts a
                ON a.discord_user_id = r.discord_user_id
                AND a.genshin_uid = r.genshin_uid

            WHERE r.discord_user_id = %s
        """

        params = [discord_user_id]

        if enabled_only:
            query += """
                AND r.enabled = TRUE
            """

        query += """
            ORDER BY r.created_at ASC
        """

        result = await connection.execute(
            query,
            tuple(params)
        )

        return await result.fetchall()


async def get_reminder(
    discord_user_id: int,
    reminder_id: int
) -> dict | None:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT *
            FROM reminders
            WHERE discord_user_id = %s
            AND id = %s
            LIMIT 1
            """,
            (
                discord_user_id,
                reminder_id
            )
        )

        return await result.fetchone()


_UNSET = object()

async def update_reminder(
    discord_user_id: int,
    reminder_id: int,
    *,
    enabled: bool | None = None,
    config: dict | None = None,
    next_trigger_at: datetime | None | object = _UNSET,
    last_triggered_at: datetime | None = None
) -> bool:
    updates = []
    values = []

    if enabled is not None:
        updates.append("enabled = %s")
        values.append(enabled)

    if config is not None:
        updates.append("config = %s")
        values.append(Jsonb(config))

    if next_trigger_at is not _UNSET:
        updates.append("next_trigger_at = %s")
        values.append(next_trigger_at)

    if last_triggered_at is not None:
        updates.append("last_triggered_at = %s")
        values.append(last_triggered_at)

    if not updates:
        return False

    updates.append("updated_at = NOW()")

    values.extend([
        discord_user_id,
        reminder_id
    ])

    async with get_pool().connection() as connection:
        result = await connection.execute(
            f"""
            UPDATE reminders
            SET {", ".join(updates)}
            WHERE discord_user_id = %s
            AND id = %s
            """,
            tuple(values)
        )

    return result.rowcount > 0


async def delete_reminder(
    discord_user_id: int,
    reminder_id: int
) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            DELETE FROM reminders
            WHERE discord_user_id = %s
            AND id = %s
            """,
            (
                discord_user_id,
                reminder_id
            )
        )

    return result.rowcount > 0


async def get_due_reminders() -> list[dict]:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT *
            FROM reminders
            WHERE enabled = TRUE
            AND next_trigger_at IS NOT NULL
            AND next_trigger_at <= NOW()
            ORDER BY next_trigger_at ASC
            """
        )

        return await result.fetchall()


async def get_achievement_progress(
    discord_user_id: int,
    account_id: int,
) -> list[dict]:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT
                achievement_id,
                tier,
                completed,
                current,
                completed_at,
                note
            FROM achievement_progress
            WHERE discord_user_id = %s
            AND account_id = %s
            ORDER BY achievement_id, tier
            """,
            (discord_user_id, account_id)
        )

        return await result.fetchall()


async def get_achievement_tier_progress(
    discord_user_id: int,
    account_id: int,
    achievement_id: str,
    tier: int
) -> dict | None:

    async with get_pool().connection() as connection:

        result = await connection.execute(
            """
            SELECT
                achievement_id,
                tier,
                completed,
                current,
                completed_at,
                note
            FROM achievement_progress
            WHERE discord_user_id = %s
            AND account_id = %s
            AND achievement_id = %s
            AND tier = %s
            LIMIT 1
            """,
            (
                discord_user_id,
                account_id,
                achievement_id,
                tier
            )
        )

        return await result.fetchone()


async def update_achievement_tier(
    discord_user_id: int,
    account_id: int,
    achievement_id: str,
    tier: int,
    *,
    completed: bool | None = None,
    current: int | None = None,
    completed_at: datetime | None | object = _UNSET,
    note: str | None | object = _UNSET
) -> bool:

    existing = await get_achievement_tier_progress(
        discord_user_id,
        account_id,
        achievement_id,
        tier
    )

    # --------------------------------
    # CREATE NEW PROGRESS ROW
    # --------------------------------

    if existing is None:

        if completed is None:
            completed = False

        if current is None:
            current = 0

        if completed_at is _UNSET:
            completed_at = (
                datetime.now(timezone.utc)
                if completed
                else None
            )

        if note is _UNSET:
            note = None

        if not (
            completed_at is None
            or isinstance(completed_at, datetime)
        ):
            completed_at = (
                datetime.now(timezone.utc)
                if completed
                else None
            )

        if not (
            note is None
            or isinstance(note, str)
        ):
            note = None

        async with get_pool().connection() as connection:

            await connection.execute(
                """
                INSERT INTO achievement_progress (
                    discord_user_id,
                    account_id,
                    achievement_id,
                    tier,
                    completed,
                    current,
                    completed_at,
                    note
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    discord_user_id,
                    account_id,
                    achievement_id,
                    tier,
                    completed,
                    current,
                    completed_at,
                    note
                )
            )

        return True

    # --------------------------------
    # UPDATE EXISTING PROGRESS
    # --------------------------------

    updates = []
    values = []

    if completed is not None:

        updates.append(
            "completed = %s"
        )

        values.append(
            completed
        )


        if completed:

            completed_at = datetime.now(
                timezone.utc
            )

        else:

            completed_at = None


    if current is not None:

        updates.append(
            "current = %s"
        )

        values.append(
            current
        )


    if completed_at is not _UNSET:

        if (
            completed_at is None
            or isinstance(completed_at, datetime)
        ):

            updates.append(
                "completed_at = %s"
            )

            values.append(
                completed_at
            )


    if note is not _UNSET:

        if (
            note is None
            or isinstance(note, str)
        ):

            updates.append(
                "note = %s"
            )

            values.append(
                note
            )


    if not updates:
        return False


    updates.append(
        "updated_at = NOW()"
    )

    values.extend([
        discord_user_id,
        account_id,
        achievement_id,
        tier
    ])


    async with get_pool().connection() as connection:

        result = await connection.execute(
            f"""
            UPDATE achievement_progress
            SET {", ".join(updates)}
            WHERE discord_user_id = %s
            AND account_id = %s
            AND achievement_id = %s
            AND tier = %s
            """,
            tuple(values)
        )


    return result.rowcount > 0


async def update_achievement_tier_note(
    discord_user_id: int,
    account_id: int,
    achievement_id: str,
    tier: int,
    note: str | None,
) -> bool:

    existing = await get_achievement_tier_progress(
        discord_user_id,
        account_id,
        achievement_id,
        tier
    )

    if existing is None:

        await update_achievement_tier(
            discord_user_id=discord_user_id,
            account_id=account_id,
            achievement_id=achievement_id,
            tier=tier,
            completed=False,
            current=0,
        )

    async with get_pool().connection() as connection:

        result = await connection.execute(
            """
            UPDATE achievement_progress
            SET
                note = %s,
                updated_at = NOW()
            WHERE discord_user_id = %s
            AND account_id = %s
            AND achievement_id = %s
            AND tier = %s
            """,
            (
                note,
                discord_user_id,
                account_id,
                achievement_id,
                tier
            )
        )

    return result.rowcount > 0


async def import_achievement_progress(
    discord_user_id: int,
    account_id: int,
    progress_data: dict
) -> None:
    async with get_pool().connection() as connection:
        for achievement_id, achievement_data in progress_data.items():
            tiers = achievement_data.get("tiers", {})

            for tier_number, tier_data in tiers.items():
                tier = int(tier_number)

                completed = bool(
                    tier_data.get("completed", False)
                )

                current = int(
                    tier_data.get("current", 0)
                )

                timestamp = tier_data.get("timestamp")

                completed_at = None

                if timestamp:
                    completed_at = datetime.fromtimestamp(
                        timestamp,
                        tz=timezone.utc
                    )

                await connection.execute(
                    """
                    INSERT INTO achievement_progress (
                        discord_user_id,
                        account_id,
                        achievement_id,
                        tier,
                        completed,
                        current,
                        completed_at
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s
                    )

                    ON CONFLICT (
                        discord_user_id,
                        account_id,
                        achievement_id,
                        tier
                    )
                    WHERE account_id IS NOT NULL
                    DO UPDATE SET
                        completed = EXCLUDED.completed,
                        current = EXCLUDED.current,
                        completed_at = EXCLUDED.completed_at,
                        updated_at = NOW()
                    """,
                    (
                        discord_user_id,
                        account_id,
                        achievement_id,
                        tier,
                        completed,
                        current,
                        completed_at
                    )
                )


async def get_wish_history(
    account_id: int,
) -> list[dict]:
    async with get_pool().connection() as connection:
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
            FROM wish_history
            WHERE account_id = %s
            ORDER BY pulled_at DESC, wish_id DESC
            """,
            (account_id,),
        )
        return await result.fetchall()


async def import_wish_history(
    account_id: int,
    wishes: list[dict],
) -> int:
    if not wishes:
        return 0

    imported = 0
    async with get_pool().connection() as connection:
        for wish in wishes:
            result = await connection.execute(
                """
                INSERT INTO wish_history (
                    account_id,
                    wish_id,
                    genshin_uid,
                    gacha_type,
                    item_name,
                    item_type,
                    rank_type,
                    icon_url,
                    pulled_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (account_id, wish_id) DO UPDATE SET
                    icon_url = COALESCE(EXCLUDED.icon_url, wish_history.icon_url)
                RETURNING (xmax = 0) AS inserted
                """,
                (
                    account_id,
                    wish["id"],
                    wish["uid"],
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

    return imported
                
                
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
    async with get_pool().connection() as connection:
        # Validate the account assignment before creating the event.
        if account_scope == "account":
            if account_id is None:
                raise ValueError(
                    "An account must be selected for an account-specific event."
                )

            account_result = await connection.execute(
                """
                SELECT id
                FROM accounts
                WHERE id = %s
                  AND discord_user_id = %s
                """,
                (account_id, discord_user_id),
            )

            if await account_result.fetchone() is None:
                raise ValueError(
                    "The selected account does not belong to this user."
                )

        elif account_scope == "all":
            account_id = None

        else:
            raise ValueError("Invalid custom event account scope.")

        # Create the event, preserving the existing global order for compatibility with other callers.
        result = await connection.execute(
            """
            INSERT INTO custom_events (
                discord_user_id,
                sort_order,
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
                icon_url
            )
            VALUES (
                %s,
                COALESCE(
                    (
                        SELECT MAX(sort_order) + 1
                        FROM custom_events
                        WHERE discord_user_id = %s
                    ),
                    1
                ),
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s
            )
            RETURNING *
            """,
            (
                discord_user_id,
                discord_user_id,
                title,
                description,
                account_scope,
                account_id,
                start_at,
                end_at,
                Jsonb(recurrence),
                colour,
                reminder_minutes,
                Jsonb(progress),
                icon_url,
            ),
        )

        event = await result.fetchone()
        event_id = event["id"]

        # Give the new event its own position in each applicable account.
        # Shared events are inserted into every account's order.
        await connection.execute(
            """
            INSERT INTO custom_event_account_order (
                discord_user_id,
                account_id,
                event_id,
                sort_order
            )
            SELECT
                e.discord_user_id,
                a.id,
                e.id,
                COALESCE(
                    (
                        SELECT MAX(o.sort_order) + 1
                        FROM custom_event_account_order o
                        WHERE o.discord_user_id = e.discord_user_id
                          AND o.account_id = a.id
                    ),
                    1
                )
            FROM custom_events e
            INNER JOIN accounts a
                ON a.discord_user_id = e.discord_user_id
            WHERE e.id = %s
              AND (
                  e.account_scope = 'all'
                  OR e.account_id = a.id
              )
            ON CONFLICT (
                discord_user_id,
                account_id,
                event_id
            )
            DO NOTHING
            """,
            (event_id,),
        )

        return event
    
    
async def get_custom_events(
    discord_user_id: int,
    account_id: int | None = None,
) -> list[dict]:
    async with get_pool().connection() as connection:
        if account_id is not None:
            account_result = await connection.execute(
                """
                SELECT genshin_uid, genshin_server
                FROM accounts
                WHERE id = %s
                  AND discord_user_id = %s
                """,
                (account_id, discord_user_id),
            )

            account = await account_result.fetchone()

            if account is None:
                return []

            result = await connection.execute(
                """
                SELECT
                    e.*,
                    COALESCE(o.sort_order, e.sort_order)
                        AS account_sort_order
                FROM custom_events AS e

                LEFT JOIN accounts AS owner_account
                    ON owner_account.id = e.account_id

                LEFT JOIN custom_event_account_order AS o
                    ON o.event_id = e.id
                   AND o.discord_user_id = %s
                   AND o.account_id = %s

                WHERE
                    e.account_scope = 'all'
                    OR (
                        e.account_scope = 'account'
                        AND owner_account.genshin_uid = %s
                        AND owner_account.genshin_server = %s
                    )

                ORDER BY
                    COALESCE(o.sort_order, e.sort_order) ASC,
                    e.start_at ASC,
                    e.id ASC
                """,
                (
                    discord_user_id,
                    account_id,
                    account["genshin_uid"],
                    account["genshin_server"],
                ),
            )

            return await result.fetchall()

        # Without a selected Genshin account, retain the original
        # owner-only behaviour for compatibility with existing callers.
        result = await connection.execute(
            """
            SELECT *
            FROM custom_events
            WHERE discord_user_id = %s
            ORDER BY sort_order ASC, start_at ASC, id ASC
            """,
            (discord_user_id,),
        )

        return await result.fetchall()
    
    
async def get_visible_custom_event(
    discord_user_id: int,
    event_id: int,
    account_id: int,
) -> dict | None:
    """Return an event visible to this user's selected Genshin account."""

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT e.*
            FROM custom_events AS e

            INNER JOIN accounts AS viewer_account
                ON viewer_account.id = %s
               AND viewer_account.discord_user_id = %s

            LEFT JOIN accounts AS owner_account
                ON owner_account.id = e.account_id

            WHERE e.id = %s
              AND (
                  e.account_scope = 'all'
                  OR (
                      e.account_scope = 'account'
                      AND owner_account.genshin_uid =
                          viewer_account.genshin_uid
                      AND owner_account.genshin_server =
                          viewer_account.genshin_server
                  )
              )
            LIMIT 1
            """,
            (account_id, discord_user_id, event_id),
        )

        return await result.fetchone()
    
    
async def reorder_custom_events(
    discord_user_id: int,
    account_id: int,
    ordered_event_ids: list[int],
) -> bool:
    """
    Save the event order for one Discord user's selected account.

    Shared account-scoped events are identified by Genshin UID + server.
    Each Discord user retains an independent ordering.
    """
    if not ordered_event_ids:
        return False

    if len(ordered_event_ids) != len(set(ordered_event_ids)):
        return False

    async with get_pool().connection() as connection:
        async with connection.transaction():
            # Verify that the selected account belongs to this user
            # and retrieve its shared Genshin identity.
            account_result = await connection.execute(
                """
                SELECT
                    genshin_uid,
                    genshin_server
                FROM accounts
                WHERE id = %s
                  AND discord_user_id = %s
                FOR UPDATE
                """,
                (account_id, discord_user_id),
            )

            account = await account_result.fetchone()

            if account is None:
                return False

            genshin_uid = account["genshin_uid"]
            genshin_server = account["genshin_server"]

            # Add missing order rows for every event visible to this
            # Discord user's selected Genshin account.
            #
            # Existing order rows are preserved. Newly visible events
            # are appended after the user's current order.
            await connection.execute(
                """
                WITH visible_events AS (
                    SELECT
                        e.id,
                        e.sort_order,
                        e.start_at
                    FROM custom_events e
                    LEFT JOIN accounts owner_account
                        ON owner_account.id = e.account_id
                    WHERE
                        e.account_scope = 'all'
                        OR (
                            e.account_scope = 'account'
                            AND owner_account.genshin_uid = %s
                            AND owner_account.genshin_server = %s
                        )
                ),
                current_max AS (
                    SELECT COALESCE(MAX(sort_order), 0) AS max_order
                    FROM custom_event_account_order
                    WHERE discord_user_id = %s
                      AND account_id = %s
                )
                INSERT INTO custom_event_account_order (
                    discord_user_id,
                    account_id,
                    event_id,
                    sort_order
                )
                SELECT
                    %s,
                    %s,
                    visible_events.id,
                    current_max.max_order
                        + (
                            ROW_NUMBER() OVER (
                                ORDER BY
                                    visible_events.sort_order ASC,
                                    visible_events.start_at ASC,
                                    visible_events.id ASC
                            )
                        )::INTEGER
                FROM visible_events
                CROSS JOIN current_max
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM custom_event_account_order existing_order
                    WHERE existing_order.discord_user_id = %s
                      AND existing_order.account_id = %s
                      AND existing_order.event_id = visible_events.id
                )
                ON CONFLICT DO NOTHING
                """,
                (
                    genshin_uid,
                    genshin_server,
                    discord_user_id,
                    account_id,
                    discord_user_id,
                    account_id,
                    discord_user_id,
                    account_id,
                ),
            )

            # Lock this user's order rows for events currently visible
            # to their selected Genshin account.
            result = await connection.execute(
                """
                SELECT
                    o.event_id,
                    o.sort_order
                FROM custom_event_account_order o
                INNER JOIN custom_events e
                    ON e.id = o.event_id
                LEFT JOIN accounts owner_account
                    ON owner_account.id = e.account_id
                WHERE o.discord_user_id = %s
                  AND o.account_id = %s
                  AND (
                      e.account_scope = 'all'
                      OR (
                          e.account_scope = 'account'
                          AND owner_account.genshin_uid = %s
                          AND owner_account.genshin_server = %s
                      )
                  )
                ORDER BY
                    o.sort_order ASC,
                    e.start_at ASC,
                    e.id ASC
                FOR UPDATE OF o
                """,
                (
                    discord_user_id,
                    account_id,
                    genshin_uid,
                    genshin_server,
                ),
            )

            existing_ids = [
                int(row["event_id"])
                for row in await result.fetchall()
            ]

            existing_id_set = set(existing_ids)
            requested_ids = [
                int(event_id)
                for event_id in ordered_event_ids
            ]

            # Reject any event that is not visible to this account.
            if any(
                event_id not in existing_id_set
                for event_id in requested_ids
            ):
                return False

            # Preserve the positions of events omitted from a partial
            # reorder request.
            requested_id_set = set(requested_ids)

            visible_positions = [
                index
                for index, event_id in enumerate(existing_ids)
                if event_id in requested_id_set
            ]

            if len(visible_positions) != len(requested_ids):
                return False

            reordered_ids = existing_ids.copy()

            for position, event_id in zip(
                visible_positions,
                requested_ids,
            ):
                reordered_ids[position] = event_id

            # Update only this Discord user's selected account order.
            for sort_order, event_id in enumerate(
                reordered_ids,
                start=1,
            ):
                await connection.execute(
                    """
                    UPDATE custom_event_account_order
                    SET sort_order = %s
                    WHERE discord_user_id = %s
                      AND account_id = %s
                      AND event_id = %s
                    """,
                    (
                        sort_order,
                        discord_user_id,
                        account_id,
                        event_id,
                    ),
                )

    return True
    

async def get_custom_event(
    discord_user_id: int,
    event_id: int,
) -> dict | None:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT *
            FROM custom_events
            WHERE id = %s
              AND discord_user_id = %s
            LIMIT 1
            """,
            (event_id, discord_user_id),
        )

        return await result.fetchone()
    

async def get_custom_event_account_progress(
    discord_user_id: int,
    event_id: int,
    account_id: int,
) -> dict[int, int]:
    """Return objective progress for the selected Genshin account."""

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT
                p.objective_index,
                p.current
            FROM custom_event_progress AS p

            INNER JOIN custom_events AS e
                ON e.id = p.event_id

            INNER JOIN accounts AS viewer_account
                ON viewer_account.id = %s
               AND viewer_account.discord_user_id = %s

            LEFT JOIN accounts AS owner_account
                ON owner_account.id = e.account_id

            WHERE p.event_id = %s
              AND p.genshin_uid = viewer_account.genshin_uid
              AND p.genshin_server = viewer_account.genshin_server
              AND (
                  e.account_scope = 'all'
                  OR (
                      e.account_scope = 'account'
                      AND owner_account.genshin_uid =
                          viewer_account.genshin_uid
                      AND owner_account.genshin_server =
                          viewer_account.genshin_server
                  )
              )
            """,
            (
                account_id,
                discord_user_id,
                event_id,
            ),
        )

        rows = await result.fetchall()

    return {
        int(row["objective_index"]): int(row["current"])
        for row in rows
    }


async def change_custom_event_account_progress(
    discord_user_id: int,
    event_id: int,
    account_id: int,
    objective_index: int,
    amount: int,
    target: int,
) -> int | None:
    """Change objective progress for a visible Genshin account."""

    if amount not in (-1, 1):
        raise ValueError("Progress amount must be -1 or 1.")

    if objective_index < 0 or target < 1:
        raise ValueError("Invalid objective index or target.")

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            INSERT INTO custom_event_progress (
                event_id,
                discord_user_id,
                account_id,
                genshin_uid,
                genshin_server,
                objective_index,
                current
            )
            SELECT
                e.id,
                %s,
                NULL,
                viewer_account.genshin_uid,
                viewer_account.genshin_server,
                %s,
                GREATEST(0, LEAST(%s, %s))

            FROM custom_events AS e

            INNER JOIN accounts AS viewer_account
                ON viewer_account.id = %s
               AND viewer_account.discord_user_id = %s

            LEFT JOIN accounts AS owner_account
                ON owner_account.id = e.account_id

            WHERE e.id = %s
              AND (
                  e.account_scope = 'all'
                  OR (
                      e.account_scope = 'account'
                      AND owner_account.genshin_uid =
                          viewer_account.genshin_uid
                      AND owner_account.genshin_server =
                          viewer_account.genshin_server
                  )
              )
              AND %s < jsonb_array_length(e.progress)
              AND %s = (
                  e.progress -> %s ->> 'target'
              )::integer

            ON CONFLICT (
                event_id,
                genshin_uid,
                genshin_server,
                objective_index
            )
            WHERE genshin_uid IS NOT NULL
              AND genshin_server IS NOT NULL

            DO UPDATE SET
                current = GREATEST(
                    0,
                    LEAST(
                        %s,
                        custom_event_progress.current + %s
                    )
                ),
                updated_at = NOW()

            RETURNING current
            """,
            (
                discord_user_id,
                objective_index,
                target,
                amount,
                account_id,
                discord_user_id,
                event_id,
                objective_index,
                target,
                objective_index,
                target,
                amount,
            ),
        )

        row = await result.fetchone()

    return int(row["current"]) if row else None
    

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
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            UPDATE custom_events
            SET
                title = %s,
                description = %s,
                account_scope = %s,
                account_id = %s,
                start_at = %s,
                end_at = %s,
                recurrence = %s,
                colour = %s,
                reminder_minutes = %s,
                progress = %s,
                icon_url = %s,
                updated_at = NOW()
            WHERE id = %s
              AND discord_user_id = %s
            RETURNING *
            """,
            (
                title,
                description,
                account_scope,
                account_id,
                start_at,
                end_at,
                Jsonb(recurrence),
                colour,
                reminder_minutes,
                Jsonb(progress),
                icon_url,
                event_id,
                discord_user_id,
            ),
        )

        return await result.fetchone()
    

async def delete_custom_event(
    discord_user_id: int,
    event_id: int,
) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            DELETE FROM custom_events
            WHERE id = %s
              AND discord_user_id = %s
            RETURNING id
            """,
            (event_id, discord_user_id),
        )

        return await result.fetchone() is not None
    

async def set_custom_event_completion(
    discord_user_id: int,
    event_id: int,
    occurrence_start,
    completed: bool,
    account_id: int | None = None,
) -> bool:
    """Set completion for a visible event occurrence."""

    async with get_pool().connection() as connection:
        if account_id is None:
            # Preserve the existing owner-level Overview behaviour.
            result = await connection.execute(
                """
                INSERT INTO custom_event_completions (
                    event_id,
                    discord_user_id,
                    account_id,
                    genshin_uid,
                    genshin_server,
                    occurrence_start,
                    completed,
                    completed_at
                )
                SELECT
                    e.id,
                    %s,
                    NULL,
                    NULL,
                    NULL,
                    %s,
                    %s,
                    NOW()
                FROM custom_events AS e
                WHERE e.id = %s
                  AND e.discord_user_id = %s

                ON CONFLICT (
                    event_id,
                    occurrence_start
                )
                WHERE account_id IS NULL
                  AND genshin_uid IS NULL
                  AND genshin_server IS NULL

                DO UPDATE SET
                    completed = EXCLUDED.completed,
                    completed_at = NOW()

                RETURNING id
                """,
                (
                    discord_user_id,
                    occurrence_start,
                    completed,
                    event_id,
                    discord_user_id,
                ),
            )
        else:
            # Save completion against the actual Genshin identity.
            result = await connection.execute(
                """
                INSERT INTO custom_event_completions (
                    event_id,
                    discord_user_id,
                    account_id,
                    genshin_uid,
                    genshin_server,
                    occurrence_start,
                    completed,
                    completed_at
                )
                SELECT
                    e.id,
                    %s,
                    NULL,
                    viewer_account.genshin_uid,
                    viewer_account.genshin_server,
                    %s,
                    %s,
                    NOW()

                FROM custom_events AS e

                INNER JOIN accounts AS viewer_account
                    ON viewer_account.id = %s
                   AND viewer_account.discord_user_id = %s

                LEFT JOIN accounts AS owner_account
                    ON owner_account.id = e.account_id

                WHERE e.id = %s
                  AND (
                      e.account_scope = 'all'
                      OR (
                          e.account_scope = 'account'
                          AND owner_account.genshin_uid =
                              viewer_account.genshin_uid
                          AND owner_account.genshin_server =
                              viewer_account.genshin_server
                      )
                  )

                ON CONFLICT (
                    event_id,
                    genshin_uid,
                    genshin_server,
                    occurrence_start
                )
                WHERE genshin_uid IS NOT NULL
                  AND genshin_server IS NOT NULL

                DO UPDATE SET
                    completed = EXCLUDED.completed,
                    completed_at = NOW()

                RETURNING id
                """,
                (
                    discord_user_id,
                    occurrence_start,
                    completed,
                    account_id,
                    discord_user_id,
                    event_id,
                ),
            )

        row = await result.fetchone()

    return row is not None


async def get_custom_event_completions(
    discord_user_id: int,
    event_id: int,
    account_id: int | None = None,
) -> list[dict]:
    """Get completion records for an event occurrence scope."""

    async with get_pool().connection() as connection:
        if account_id is None:
            # Retain owner-level Overview completion records.
            result = await connection.execute(
                """
                SELECT
                    occurrence_start,
                    completed,
                    completed_at
                FROM custom_event_completions
                WHERE event_id = %s
                  AND discord_user_id = %s
                  AND account_id IS NULL
                  AND genshin_uid IS NULL
                  AND genshin_server IS NULL
                ORDER BY occurrence_start ASC
                """,
                (
                    event_id,
                    discord_user_id,
                ),
            )
        else:
            result = await connection.execute(
                """
                SELECT
                    c.occurrence_start,
                    c.completed,
                    c.completed_at
                FROM custom_event_completions AS c

                INNER JOIN accounts AS viewer_account
                    ON viewer_account.id = %s
                   AND viewer_account.discord_user_id = %s

                WHERE c.event_id = %s
                  AND c.genshin_uid = viewer_account.genshin_uid
                  AND c.genshin_server = viewer_account.genshin_server

                ORDER BY c.occurrence_start ASC
                """,
                (
                    account_id,
                    discord_user_id,
                    event_id,
                ),
            )

        rows = await result.fetchall()

    return [dict(row) for row in rows]

    
async def get_gift_code_settings(account_id: int) -> dict:
    """Return gift-code settings for an account."""

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT auto_claim_enabled
            FROM gift_code_settings
            WHERE account_id = %s
            """,
            (account_id,),
        )

        row = await result.fetchone()

    return {
        "auto_claim_enabled": (
            row["auto_claim_enabled"] if row else False
        ),
    }


async def set_gift_code_auto_claim(
    account_id: int,
    enabled: bool,
) -> None:
    """Persist the automatic gift-code claiming setting."""

    async with get_pool().connection() as connection:
        await connection.execute(
            """
            INSERT INTO gift_code_settings (
                account_id,
                auto_claim_enabled,
                updated_at
            )
            VALUES (%s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (account_id)
            DO UPDATE SET
                auto_claim_enabled = EXCLUDED.auto_claim_enabled,
                updated_at = CURRENT_TIMESTAMP
            """,
            (account_id, enabled),
        )


async def get_gift_code_redemptions(
    account_id: int,
) -> dict[str, dict]:
    """Return saved redemption statuses keyed by normalised code."""

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT code, status, message, attempted_at
            FROM gift_code_redemptions
            WHERE account_id = %s
            """,
            (account_id,),
        )

        rows = await result.fetchall()

    return {
        row["code"]: {
            "status": row["status"],
            "message": row["message"],
            "attempted_at": (
                row["attempted_at"].isoformat()
                if row["attempted_at"]
                else None
            ),
        }
        for row in rows
    }


async def update_gift_code_redemption(
    account_id: int,
    code: str,
    status: str,
    message: str | None = None,
) -> None:
    """Insert or update the saved status for a code and account."""

    normalised_code = code.strip().upper()

    async with get_pool().connection() as connection:
        await connection.execute(
            """
            INSERT INTO gift_code_redemptions (
                account_id,
                code,
                status,
                message,
                attempted_at
            )
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (account_id, code)
            DO UPDATE SET
                status = EXCLUDED.status,
                message = EXCLUDED.message,
                attempted_at = CURRENT_TIMESTAMP
            """,
            (
                account_id,
                normalised_code,
                status,
                message,
            ),
        )
        
        
async def get_gift_code_auto_claim_accounts() -> list[dict]:
    """Return accounts that have enabled automatic gift-code claiming."""

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT
                a.id AS account_id,
                a.discord_user_id,
                a.genshin_uid
            FROM accounts a
            INNER JOIN gift_code_settings s
                ON s.account_id = a.id
            WHERE s.auto_claim_enabled = TRUE
            ORDER BY a.id ASC
            """
        )

        return await result.fetchall()
    

async def get_daily_checkin_settings(
    account_id: int,
) -> dict:
    """Return daily check-in settings for an account."""

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT
                auto_checkin_enabled,
                last_claimed_date,
                last_status,
                last_message
            FROM daily_checkin_settings
            WHERE account_id = %s
            """,
            (account_id,),
        )

        row = await result.fetchone()

    return {
        "auto_checkin_enabled": (
            row["auto_checkin_enabled"] if row else False
        ),
        "last_claimed_date": (
            row["last_claimed_date"].isoformat()
            if row and row["last_claimed_date"]
            else None
        ),
        "last_status": row["last_status"] if row else None,
        "last_message": row["last_message"] if row else None,
    }


async def set_daily_checkin_enabled(
    account_id: int,
    enabled: bool,
) -> None:
    """Save the automatic daily check-in setting."""

    async with get_pool().connection() as connection:
        await connection.execute(
            """
            INSERT INTO daily_checkin_settings (
                account_id,
                auto_checkin_enabled,
                updated_at
            )
            VALUES (%s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (account_id)
            DO UPDATE SET
                auto_checkin_enabled = EXCLUDED.auto_checkin_enabled,
                updated_at = CURRENT_TIMESTAMP
            """,
            (account_id, enabled),
        )


async def get_daily_checkin_accounts() -> list[dict]:
    """Return accounts with automatic daily check-in enabled."""

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT
                a.id AS account_id,
                a.discord_user_id,
                a.genshin_uid,
                a.genshin_server
            FROM accounts a
            INNER JOIN daily_checkin_settings s
                ON s.account_id = a.id
            WHERE s.auto_checkin_enabled = TRUE
            ORDER BY a.id ASC
            """
        )

        return await result.fetchall()


async def update_daily_checkin_status(
    account_id: int,
    *,
    status: str,
    message: str,
    claimed_date=None,
) -> None:
    """Save the latest daily check-in result."""

    async with get_pool().connection() as connection:
        await connection.execute(
            """
            INSERT INTO daily_checkin_settings (
                account_id,
                last_claimed_date,
                last_status,
                last_message,
                updated_at
            )
            VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (account_id)
            DO UPDATE SET
                last_claimed_date = COALESCE(
                    EXCLUDED.last_claimed_date,
                    daily_checkin_settings.last_claimed_date
                ),
                last_status = EXCLUDED.last_status,
                last_message = EXCLUDED.last_message,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                account_id,
                claimed_date,
                status,
                message,
            ),
        )
