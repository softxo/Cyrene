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
            CREATE INDEX IF NOT EXISTS idx_accounts_discord_user
                ON accounts(discord_user_id)
            """
        )

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

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS achievement_progress (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

                discord_user_id BIGINT NOT NULL,

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
                ON achievement_progress(
                    discord_user_id,
                    achievement_id
                )
            """
        )
        
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
                ON event_activity_checks(
                    discord_user_id,
                    genshin_uid
                )
            """
        )

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
        # CUSTOM EVENT COMPLETIONS
        # =========================================

        await connection.execute(
            """
            CREATE TABLE IF NOT EXISTS custom_event_completions (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

                event_id BIGINT NOT NULL
                    REFERENCES custom_events(id) ON DELETE CASCADE,

                discord_user_id BIGINT NOT NULL,
                occurrence_start TIMESTAMPTZ NOT NULL,

                completed BOOLEAN NOT NULL DEFAULT TRUE,
                completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

                UNIQUE(event_id, occurrence_start)
            )
            """
        )

        await connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_custom_event_completions_user
            ON custom_event_completions(discord_user_id)
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
                ltoken
            )
            VALUES (
                %s, %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s,
                %s, %s, %s,
                %s, %s, %s,
                %s, %s
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
                ltoken = EXCLUDED.ltoken
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
                encrypted_ltoken
            )
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
            )
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
        )
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
    discord_user_id: int
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
            ORDER BY achievement_id, tier
            """,
            (discord_user_id,)
        )

        return await result.fetchall()


async def get_achievement_tier_progress(
    discord_user_id: int,
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
            AND achievement_id = %s
            AND tier = %s
            LIMIT 1
            """,
            (
                discord_user_id,
                achievement_id,
                tier
            )
        )

        return await result.fetchone()


async def update_achievement_tier(
    discord_user_id: int,
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
                    achievement_id,
                    tier,
                    completed,
                    current,
                    completed_at,
                    note
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    discord_user_id,
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
        achievement_id,
        tier
    ])


    async with get_pool().connection() as connection:

        result = await connection.execute(
            f"""
            UPDATE achievement_progress
            SET {", ".join(updates)}
            WHERE discord_user_id = %s
            AND achievement_id = %s
            AND tier = %s
            """,
            tuple(values)
        )


    return result.rowcount > 0


async def update_achievement_tier_note(
    discord_user_id: int,
    achievement_id: str,
    tier: int,
    note: str | None,
) -> bool:

    existing = await get_achievement_tier_progress(
        discord_user_id,
        achievement_id,
        tier
    )

    if existing is None:

        await update_achievement_tier(
            discord_user_id=discord_user_id,
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
            AND achievement_id = %s
            AND tier = %s
            """,
            (
                note,
                discord_user_id,
                achievement_id,
                tier
            )
        )

    return result.rowcount > 0


async def import_achievement_progress(
    discord_user_id: int,
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
                        achievement_id,
                        tier,
                        completed,
                        current,
                        completed_at
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s
                    )

                    ON CONFLICT (
                        discord_user_id,
                        achievement_id,
                        tier
                    )
                    DO UPDATE SET
                        completed = EXCLUDED.completed,
                        current = EXCLUDED.current,
                        completed_at = EXCLUDED.completed_at,
                        updated_at = NOW()
                    """,
                    (
                        discord_user_id,
                        achievement_id,
                        tier,
                        completed,
                        current,
                        completed_at
                    )
                )
                
                
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
) -> dict:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            INSERT INTO custom_events (
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
                progress
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
            )
            RETURNING *
            """,
            (
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
            ),
        )

        return await result.fetchone()
    
    
async def get_custom_events(
    discord_user_id: int,
    account_id: int | None = None,
) -> list[dict]:
    async with get_pool().connection() as connection:
        if account_id is None:
            result = await connection.execute(
                """
                SELECT *
                FROM custom_events
                WHERE discord_user_id = %s
                ORDER BY start_at ASC, id ASC
                """,
                (discord_user_id,),
            )
        else:
            result = await connection.execute(
                """
                SELECT *
                FROM custom_events
                WHERE discord_user_id = %s
                  AND (
                      account_scope = 'all'
                      OR account_id = %s
                  )
                ORDER BY start_at ASC, id ASC
                """,
                (discord_user_id, account_id),
            )

        return await result.fetchall()
    

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
    occurrence_start: datetime,
    completed: bool,
) -> bool:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            INSERT INTO custom_event_completions (
                event_id,
                discord_user_id,
                occurrence_start,
                completed,
                completed_at
            )
            SELECT
                id,
                discord_user_id,
                %s,
                %s,
                CASE WHEN %s THEN NOW() ELSE NOW() END
            FROM custom_events
            WHERE id = %s
              AND discord_user_id = %s
            ON CONFLICT (event_id, occurrence_start)
            DO UPDATE SET
                completed = EXCLUDED.completed,
                completed_at = NOW(),
                discord_user_id = EXCLUDED.discord_user_id
            RETURNING id
            """,
            (
                occurrence_start,
                completed,
                completed,
                event_id,
                discord_user_id,
            ),
        )

        return await result.fetchone() is not None
    

async def get_custom_event_completions(
    discord_user_id: int,
    event_id: int,
) -> list[dict]:
    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT
                occurrence_start,
                completed,
                completed_at
            FROM custom_event_completions
            WHERE discord_user_id = %s
              AND event_id = %s
            ORDER BY occurrence_start ASC
            """,
            (discord_user_id, event_id),
        )

        return await result.fetchall()