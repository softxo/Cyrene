from psycopg.types.json import Jsonb

ACTIVITY_TYPES = ("daily_commissions", "trounce_domains", "temper_thyself")


async def migrate(connection):
    await connection.execute(
        """
        CREATE TABLE IF NOT EXISTS event_uid_checks (
            genshin_uid TEXT NOT NULL,
            activity_type TEXT NOT NULL,
            period_key TEXT NOT NULL,
            checked BOOLEAN NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (genshin_uid, activity_type, period_key)
        )
        """
    )

    await connection.execute(
        """
        CREATE TABLE IF NOT EXISTS custom_event_accounts (
            event_id BIGINT NOT NULL REFERENCES custom_events(id) ON DELETE CASCADE,
            genshin_uid TEXT NOT NULL,
            genshin_server TEXT NOT NULL,
            sort_order BIGINT NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (event_id, genshin_uid, genshin_server)
        )
        """
    )

    await connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_custom_event_accounts_uid
        ON custom_event_accounts (genshin_uid, genshin_server, sort_order)
        """
    )

    await connection.execute(
        """
        CREATE TABLE IF NOT EXISTS custom_event_copy_groups (
            event_id BIGINT PRIMARY KEY REFERENCES custom_events(id) ON DELETE CASCADE,
            group_key BIGINT NOT NULL
        )
        """
    )

    await connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_custom_event_copy_groups_key
        ON custom_event_copy_groups(group_key)
        """
    )


async def identity(connection, user, account):
    result = await connection.execute(
        """
        SELECT genshin_uid, genshin_server
        FROM accounts
        WHERE id = %s AND discord_user_id = %s
        """,
        (account, user),
    )

    return await result.fetchone()


def _apply_viewer_account(event):
    if event["account_scope"] == "account":
        event["account_id"] = event["viewer_account_id"]


async def visible(connection, user, event, account=None, *, lock=False):
    lock_clause = " FOR UPDATE OF e" if lock else ""

    result = await connection.execute(
        """
        SELECT e.*, a.id AS viewer_account_id
        FROM custom_events e
        JOIN custom_event_accounts s ON s.event_id = e.id
        JOIN accounts a
            ON a.genshin_uid = s.genshin_uid
            AND a.genshin_server = s.genshin_server
        WHERE e.id = %s
            AND a.discord_user_id = %s
            AND (%s::bigint IS NULL OR a.id = %s)
        ORDER BY a.id
        LIMIT 1
        """
        + lock_clause,
        (event, user, account, account),
    )
    found = await result.fetchone()

    if found:
        _apply_viewer_account(found)

    return found


async def get_event_activity_check(pool, user, uid, activity, period):
    async with pool.connection() as connection:
        result = await connection.execute(
            """
            SELECT checked
            FROM event_uid_checks
            WHERE genshin_uid = %s AND activity_type = %s AND period_key = %s
            """,
            (uid, activity, period),
        )
        row = await result.fetchone()

        return row["checked"] if row else None


async def set_event_activity_check(pool, user, uid, activity, period, checked):
    async with pool.connection() as connection:
        await connection.execute(
            """
            INSERT INTO event_uid_checks (genshin_uid, activity_type, period_key, checked)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (genshin_uid, activity_type, period_key)
            DO UPDATE SET checked = EXCLUDED.checked, updated_at = NOW()
            """,
            (uid, activity, period, checked),
        )

    return True


async def get_limited_event_checks(pool, user, uid):
    async with pool.connection() as connection:
        result = await connection.execute(
            """
            SELECT period_key, checked
            FROM event_uid_checks
            WHERE genshin_uid = %s AND activity_type = 'limited_event'
            """,
            (uid,),
        )

        return {row["period_key"]: row["checked"] for row in await result.fetchall()}


async def get_event_activity_checks(pool, user, uid, daily, weekly):
    async with pool.connection() as connection:
        result = await connection.execute(
            """
            SELECT activity_type, checked
            FROM event_uid_checks
            WHERE genshin_uid = %s
                AND (
                    (activity_type = 'daily_commissions' AND period_key = %s)
                    OR (activity_type IN ('trounce_domains', 'temper_thyself') AND period_key = %s)
                )
            """,
            (uid, daily, weekly),
        )
        saved = {row["activity_type"]: row["checked"] for row in await result.fetchall()}

        return dict.fromkeys(ACTIVITY_TYPES) | saved


def _event_order(event):
    return (event["account_sort_order"], event["start_at"], event["id"])


async def get_custom_events(pool, user, account_id=None):
    async with pool.connection() as connection:
        result = await connection.execute(
            """
            SELECT DISTINCT ON (e.id)
                e.*,
                a.id AS viewer_account_id,
                s.sort_order AS account_sort_order
            FROM custom_events e
            JOIN custom_event_accounts s ON s.event_id = e.id
            JOIN accounts a
                ON a.genshin_uid = s.genshin_uid
                AND a.genshin_server = s.genshin_server
            WHERE a.discord_user_id = %s
                AND (%s::bigint IS NULL OR a.id = %s)
            ORDER BY e.id, a.id
            """,
            (user, account_id, account_id),
        )
        events = await result.fetchall()

        for event in events:
            _apply_viewer_account(event)

        return sorted(events, key=_event_order)


async def get_visible_custom_event(pool, user, event_id, account_id):
    async with pool.connection() as connection:
        return await visible(connection, user, event_id, account_id)


async def get_custom_event(pool, user, event_id):
    async with pool.connection() as connection:
        return await visible(connection, user, event_id)


async def targets(connection, user, scope, account_id):
    if scope not in ("all", "account") or (scope == "account" and account_id is None):
        raise ValueError("Select a valid Genshin account.")

    selected_account = account_id if scope == "account" else None

    result = await connection.execute(
        """
        SELECT genshin_uid, genshin_server, MIN(id) AS account_id
        FROM accounts
        WHERE discord_user_id = %s
            AND (%s::bigint IS NULL OR id = %s)
        GROUP BY genshin_uid, genshin_server
        ORDER BY genshin_uid, genshin_server
        """,
        (user, selected_account, account_id),
    )
    accounts = await result.fetchall()

    if not accounts:
        raise ValueError("Account not found.")

    return accounts


async def associate(connection, event, accounts):
    for account in accounts:
        await connection.execute(
            """
            INSERT INTO custom_event_accounts (event_id, genshin_uid, genshin_server, sort_order)
            SELECT %s, %s, %s, COALESCE(MAX(sort_order), 0) + 1
            FROM custom_event_accounts
            WHERE genshin_uid = %s AND genshin_server = %s
            ON CONFLICT DO NOTHING
            """,
            (
                event,
                account["genshin_uid"],
                account["genshin_server"],
                account["genshin_uid"],
                account["genshin_server"],
            ),
        )


async def _insert_event_copy(
    connection,
    user,
    account,
    title,
    description,
    start,
    end,
    recurrence,
    colour,
    reminder,
    progress,
    icon,
):
    result = await connection.execute(
        """
        INSERT INTO custom_events (
            discord_user_id,
            title,
            description,
            account_scope,
            account_id,
            genshin_uid,
            genshin_server,
            start_at,
            end_at,
            recurrence,
            colour,
            reminder_minutes,
            progress,
            icon_url
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING *
        """,
        (
            user,
            title,
            description,
            "account",
            account["account_id"],
            account["genshin_uid"],
            account["genshin_server"],
            start,
            end,
            Jsonb(recurrence),
            colour,
            reminder,
            Jsonb(progress),
            icon,
        ),
    )

    return await result.fetchone()


async def _add_to_copy_group(connection, event_id, group_key):
    await connection.execute(
        "INSERT INTO custom_event_copy_groups(event_id, group_key) VALUES (%s, %s)",
        (event_id, group_key),
    )


async def create_custom_event(
    pool,
    user,
    title,
    description,
    scope,
    account_id,
    start,
    end,
    recurrence,
    colour,
    reminder,
    progress,
    icon=None,
):
    async with pool.connection() as connection:
        async with connection.transaction():
            accounts = await targets(connection, user, scope, account_id)
            first = None

            for account in accounts:
                event = await _insert_event_copy(
                    connection,
                    user,
                    account,
                    title,
                    description,
                    start,
                    end,
                    recurrence,
                    colour,
                    reminder,
                    progress,
                    icon,
                )

                await associate(connection, event["id"], [account])

                if first is None:
                    first = event

                await _add_to_copy_group(connection, event["id"], first["id"])

            return first


async def _copy_group_key(connection, event_id):
    result = await connection.execute(
        "SELECT group_key FROM custom_event_copy_groups WHERE event_id = %s",
        (event_id,),
    )
    row = await result.fetchone()

    return row["group_key"] if row else event_id


async def _lock_copy_group(connection, group_key, user):
    result = await connection.execute(
        """
        SELECT e.*
        FROM custom_events e
        JOIN custom_event_copy_groups g ON g.event_id = e.id
        WHERE g.group_key = %s
            AND EXISTS (
                SELECT 1
                FROM custom_event_accounts s
                JOIN accounts a
                    ON a.genshin_uid = s.genshin_uid
                    AND a.genshin_server = s.genshin_server
                WHERE s.event_id = e.id AND a.discord_user_id = %s
            )
        ORDER BY e.id FOR UPDATE OF e
        """,
        (group_key, user),
    )

    return await result.fetchall()


def _changed_shared_fields(source, title, description, icon, shared_fields):
    shared_values = {"title": title, "description": description, "icon_url": icon}

    if shared_fields is not None:
        return set(shared_fields) & shared_values.keys()

    return {field for field, value in shared_values.items() if source.get(field) != value}


async def _update_shared_fields(connection, event_id, changed, title, description, icon):
    await connection.execute(
        """
        UPDATE custom_events
        SET
            title = CASE WHEN %s THEN %s ELSE title END,
            description = CASE WHEN %s THEN %s ELSE description END,
            icon_url = CASE WHEN %s THEN %s ELSE icon_url END,
            updated_at = NOW()
        WHERE id = %s
        """,
        (
            "title" in changed,
            title,
            "description" in changed,
            description,
            "icon_url" in changed,
            icon,
            event_id,
        ),
    )


async def _update_full_event(
    connection,
    event_id,
    title,
    description,
    start,
    end,
    recurrence,
    colour,
    reminder,
    progress,
    icon,
):
    result = await connection.execute(
        """
        UPDATE custom_events
        SET
            title = %s,
            description = %s,
            start_at = %s,
            end_at = %s,
            recurrence = %s,
            colour = %s,
            reminder_minutes = %s,
            progress = %s,
            icon_url = %s,
            updated_at = NOW()
        WHERE id = %s
        RETURNING *
        """,
        (
            title,
            description,
            start,
            end,
            Jsonb(recurrence),
            colour,
            reminder,
            Jsonb(progress),
            icon,
            event_id,
        ),
    )

    return await result.fetchone()


async def _reset_progress(connection, event_id):
    await connection.execute(
        "DELETE FROM custom_event_progress WHERE event_id = %s",
        (event_id,),
    )


async def update_custom_event(
    pool,
    user,
    event_id,
    title,
    description,
    scope,
    account_id,
    start,
    end,
    recurrence,
    colour,
    reminder,
    progress,
    icon=None,
    shared_fields=None,
):
    async with pool.connection() as connection:
        async with connection.transaction():
            source = await visible(connection, user, event_id, account_id, lock=scope != "all")

            if not source:
                return None

            copies = [source]

            if scope == "all":
                group_key = await _copy_group_key(connection, event_id)
                copies = await _lock_copy_group(connection, group_key, user) or [source]

                if not any(copy["id"] == event_id for copy in copies):
                    return None

            changed = _changed_shared_fields(source, title, description, icon, shared_fields)
            saved = None

            for copy in copies:
                if copy["id"] != event_id:
                    if changed:
                        await _update_shared_fields(
                            connection,
                            copy["id"],
                            changed,
                            title,
                            description,
                            icon,
                        )

                    continue

                updated = await _update_full_event(
                    connection,
                    copy["id"],
                    title,
                    description,
                    start,
                    end,
                    recurrence,
                    colour,
                    reminder,
                    progress,
                    icon,
                )

                await _reset_progress(connection, copy["id"])

                updated["account_id"] = source["viewer_account_id"]
                saved = updated

            return saved


async def delete_custom_event(pool, user, event_id, account_id=None):
    async with pool.connection() as connection:
        async with connection.transaction():
            if not await visible(connection, user, event_id, account_id, lock=True):
                return False

            result = await connection.execute(
                "DELETE FROM custom_events WHERE id = %s RETURNING id",
                (event_id,),
            )

            return await result.fetchone() is not None


async def _locked_event_order(connection, account):
    result = await connection.execute(
        """
        SELECT event_id
        FROM custom_event_accounts
        WHERE genshin_uid = %s AND genshin_server = %s
        ORDER BY sort_order, event_id FOR UPDATE
        """,
        (account["genshin_uid"], account["genshin_server"]),
    )

    return [row["event_id"] for row in await result.fetchall()]


def _merge_order(existing, requested):
    merged = list(existing)
    positions = [index for index, event_id in enumerate(existing) if event_id in requested]

    for position, event_id in zip(positions, requested):
        merged[position] = event_id

    return merged


async def _save_sort_order(connection, account, ordered_ids):
    for order, event_id in enumerate(ordered_ids):
        await connection.execute(
            """
            UPDATE custom_event_accounts
            SET sort_order = %s, updated_at = NOW()
            WHERE event_id = %s AND genshin_uid = %s AND genshin_server = %s
            """,
            (order, event_id, account["genshin_uid"], account["genshin_server"]),
        )


async def reorder_custom_events(pool, user, account_id, ids):
    if not ids or len(ids) != len(set(ids)):
        return False

    async with pool.connection() as connection:
        async with connection.transaction():
            account = await identity(connection, user, account_id)

            if not account:
                return False

            existing = await _locked_event_order(connection, account)

            if not set(ids) <= set(existing):
                return False

            await _save_sort_order(connection, account, _merge_order(existing, ids))

    return True


async def get_custom_event_account_progress(pool, user, event, account):
    async with pool.connection() as connection:
        if not await visible(connection, user, event, account):
            return {}

        owner = await identity(connection, user, account)

        result = await connection.execute(
            """
            SELECT objective_index, current
            FROM custom_event_progress
            WHERE event_id = %s AND genshin_uid = %s AND genshin_server = %s
            """,
            (event, owner["genshin_uid"], owner["genshin_server"]),
        )

        return {row["objective_index"]: row["current"] for row in await result.fetchall()}


def _is_valid_objective(event, index, target):
    if not event or index >= len(event["progress"]):
        return False

    return event["progress"][index]["target"] == target


async def change_custom_event_account_progress(pool, user, event, account, index, amount, target):
    if amount not in (-1, 1) or index < 0 or target < 1:
        raise ValueError("Invalid objective change.")

    async with pool.connection() as connection:
        async with connection.transaction():
            found = await visible(connection, user, event, account, lock=True)

            if not _is_valid_objective(found, index, target):
                return None

            owner = await identity(connection, user, account)
            starting_current = int(found["progress"][index].get("current", 0))
            initial_current = max(0, min(target, starting_current + amount))

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
                VALUES (%s, %s, NULL, %s, %s, %s, %s)
                ON CONFLICT (event_id, genshin_uid, genshin_server, objective_index)
                WHERE genshin_uid IS NOT NULL AND genshin_server IS NOT NULL
                DO UPDATE SET
                    current = GREATEST(0, LEAST(%s, custom_event_progress.current + %s)),
                    updated_at = NOW()
                RETURNING current
                """,
                (
                    event,
                    user,
                    owner["genshin_uid"],
                    owner["genshin_server"],
                    index,
                    initial_current,
                    target,
                    amount,
                ),
            )
            row = await result.fetchone()

            return row["current"]


async def set_custom_event_completion(pool, user, event, occurrence, completed, account_id=None):
    async with pool.connection() as connection:
        found = await visible(connection, user, event, account_id)

        if not found:
            return False

        owner = await identity(connection, user, account_id or found["viewer_account_id"])

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
            VALUES (%s, %s, NULL, %s, %s, %s, %s, NOW())
            ON CONFLICT (event_id, genshin_uid, genshin_server, occurrence_start)
            WHERE genshin_uid IS NOT NULL AND genshin_server IS NOT NULL
            DO UPDATE SET completed = EXCLUDED.completed, completed_at = NOW()
            RETURNING id
            """,
            (event, user, owner["genshin_uid"], owner["genshin_server"], occurrence, completed),
        )

        return await result.fetchone() is not None


async def get_custom_event_completions(pool, user, event, account_id=None):
    async with pool.connection() as connection:
        found = await visible(connection, user, event, account_id)

        if not found:
            return []

        owner = await identity(connection, user, account_id or found["viewer_account_id"])

        result = await connection.execute(
            """
            SELECT occurrence_start, completed, completed_at
            FROM custom_event_completions
            WHERE event_id = %s AND genshin_uid = %s AND genshin_server = %s
            ORDER BY occurrence_start
            """,
            (event, owner["genshin_uid"], owner["genshin_server"]),
        )

        return await result.fetchall()
