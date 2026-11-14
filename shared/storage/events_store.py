"""Events persist against Genshin identities; Discord only authorises access."""

from psycopg.types.json import Jsonb


async def migrate(connection):
    """Ensure the active UID schema exists; retired tables are never recreated."""
    await connection.execute("""CREATE TABLE IF NOT EXISTS event_uid_checks (
            genshin_uid TEXT NOT NULL, activity_type TEXT NOT NULL, period_key TEXT NOT NULL,
            checked BOOLEAN NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (genshin_uid, activity_type, period_key))""")
    await connection.execute("""CREATE TABLE IF NOT EXISTS custom_event_accounts (
            event_id BIGINT NOT NULL REFERENCES custom_events(id) ON DELETE CASCADE,
            genshin_uid TEXT NOT NULL, genshin_server TEXT NOT NULL,
            sort_order BIGINT NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (event_id, genshin_uid, genshin_server))""")
    await connection.execute("""CREATE INDEX IF NOT EXISTS idx_custom_event_accounts_uid
            ON custom_event_accounts (genshin_uid, genshin_server, sort_order)""")

    await connection.execute("""CREATE TABLE IF NOT EXISTS custom_event_copy_groups (
        event_id BIGINT PRIMARY KEY REFERENCES custom_events(id) ON DELETE CASCADE,
        group_key BIGINT NOT NULL)""")
    await connection.execute("""CREATE INDEX IF NOT EXISTS idx_custom_event_copy_groups_key
        ON custom_event_copy_groups(group_key)""")


async def identity(c, user, account):
    r = await c.execute(
        "SELECT genshin_uid, genshin_server FROM accounts WHERE id=%s AND discord_user_id=%s",
        (account, user),
    )
    return await r.fetchone()


async def visible(c, user, event, account=None, *, lock=False):
    r = await c.execute(
        """SELECT e.*, a.id AS viewer_account_id FROM custom_events e
        JOIN custom_event_accounts s ON s.event_id=e.id
        JOIN accounts a ON a.genshin_uid=s.genshin_uid AND a.genshin_server=s.genshin_server
        WHERE e.id=%s AND a.discord_user_id=%s AND (%s::bigint IS NULL OR a.id=%s)
        ORDER BY a.id LIMIT 1"""
        + (" FOR UPDATE OF e" if lock else ""),
        (event, user, account, account),
    )
    e = await r.fetchone()
    if e and e["account_scope"] == "account":
        e["account_id"] = e["viewer_account_id"]
    return e


async def get_event_activity_check(pool, user, uid, activity, period):
    async with pool.connection() as c:
        r = await c.execute(
            "SELECT checked FROM event_uid_checks WHERE genshin_uid=%s AND activity_type=%s AND period_key=%s",
            (uid, activity, period),
        )
        row = await r.fetchone()
        return row["checked"] if row else None


async def set_event_activity_check(pool, user, uid, activity, period, checked):
    async with pool.connection() as c:
        await c.execute(
            """INSERT INTO event_uid_checks (genshin_uid,activity_type,period_key,checked)
            VALUES (%s,%s,%s,%s) ON CONFLICT (genshin_uid,activity_type,period_key)
            DO UPDATE SET checked=EXCLUDED.checked,updated_at=NOW()""",
            (uid, activity, period, checked),
        )
    return True


async def get_limited_event_checks(pool, user, uid):
    async with pool.connection() as c:
        r = await c.execute(
            "SELECT period_key,checked FROM event_uid_checks WHERE genshin_uid=%s AND activity_type='limited_event'",
            (uid,),
        )
        return {row["period_key"]: row["checked"] for row in await r.fetchall()}


async def get_event_activity_checks(pool, user, uid, daily, weekly):
    async with pool.connection() as c:
        r = await c.execute(
            """SELECT activity_type,checked FROM event_uid_checks WHERE genshin_uid=%s AND
            ((activity_type='daily_commissions' AND period_key=%s) OR
             (activity_type IN ('trounce_domains','temper_thyself') AND period_key=%s))""",
            (uid, daily, weekly),
        )
        return dict.fromkeys(("daily_commissions", "trounce_domains", "temper_thyself")) | {
            r["activity_type"]: r["checked"] for r in await r.fetchall()
        }


async def get_custom_events(pool, user, account_id=None):
    async with pool.connection() as c:
        r = await c.execute(
            """SELECT DISTINCT ON (e.id) e.*, a.id AS viewer_account_id, s.sort_order AS account_sort_order
            FROM custom_events e JOIN custom_event_accounts s ON s.event_id=e.id
            JOIN accounts a ON a.genshin_uid=s.genshin_uid AND a.genshin_server=s.genshin_server
            WHERE a.discord_user_id=%s AND (%s::bigint IS NULL OR a.id=%s)
            ORDER BY e.id,a.id""",
            (user, account_id, account_id),
        )
        rows = await r.fetchall()
        for e in rows:
            if e["account_scope"] == "account":
                e["account_id"] = e["viewer_account_id"]
        return sorted(rows, key=lambda e: (e["account_sort_order"], e["start_at"], e["id"]))


async def get_visible_custom_event(pool, user, event_id, account_id):
    async with pool.connection() as c:
        return await visible(c, user, event_id, account_id)


async def get_custom_event(pool, user, event_id):
    async with pool.connection() as c:
        return await visible(c, user, event_id)


async def targets(c, user, scope, account_id):
    if scope not in ("all", "account") or (scope == "account" and account_id is None):
        raise ValueError("Select a valid Genshin account.")
    r = await c.execute(
        """SELECT genshin_uid,genshin_server,MIN(id) AS account_id FROM accounts
        WHERE discord_user_id=%s AND (%s::bigint IS NULL OR id=%s)
        GROUP BY genshin_uid,genshin_server ORDER BY genshin_uid,genshin_server""",
        (user, account_id if scope == "account" else None, account_id),
    )
    rows = await r.fetchall()
    if not rows:
        raise ValueError("Account not found.")
    return rows


async def associate(c, event, accounts):
    for a in accounts:
        await c.execute(
            """INSERT INTO custom_event_accounts (event_id,genshin_uid,genshin_server,sort_order)
            SELECT %s,%s,%s,COALESCE(MAX(sort_order),0)+1 FROM custom_event_accounts
            WHERE genshin_uid=%s AND genshin_server=%s ON CONFLICT DO NOTHING""",
            (event, a["genshin_uid"], a["genshin_server"], a["genshin_uid"], a["genshin_server"]),
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
    async with pool.connection() as c:
        async with c.transaction():
            accounts = await targets(c, user, scope, account_id)
            first = None
            for account in accounts:
                uid, server = account["genshin_uid"], account["genshin_server"]
                r = await c.execute(
                    """INSERT INTO custom_events
                    (discord_user_id,title,description,account_scope,account_id,genshin_uid,genshin_server,
                     start_at,end_at,recurrence,colour,reminder_minutes,progress,icon_url)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                    (
                        user,
                        title,
                        description,
                        "account",
                        account["account_id"],
                        uid,
                        server,
                        start,
                        end,
                        Jsonb(recurrence),
                        colour,
                        reminder,
                        Jsonb(progress),
                        icon,
                    ),
                )
                e = await r.fetchone()
                await associate(c, e["id"], [account])
                if first is None:
                    first = e
                await c.execute(
                    "INSERT INTO custom_event_copy_groups(event_id,group_key) VALUES (%s,%s)",
                    (e["id"], first["id"]),
                )
            return first


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
    async with pool.connection() as c:
        async with c.transaction():
            source = await visible(c, user, event_id, account_id, lock=scope != "all")
            if not source:
                return None
            copies = [source]
            if scope == "all":
                group = await c.execute(
                    "SELECT group_key FROM custom_event_copy_groups WHERE event_id=%s", (event_id,)
                )
                row = await group.fetchone()
                group_key = row["group_key"] if row else event_id
                result = await c.execute(
                    """SELECT e.* FROM custom_events e
                    JOIN custom_event_copy_groups g ON g.event_id=e.id
                    WHERE g.group_key=%s AND EXISTS (
                        SELECT 1 FROM custom_event_accounts s JOIN accounts a
                        ON a.genshin_uid=s.genshin_uid AND a.genshin_server=s.genshin_server
                        WHERE s.event_id=e.id AND a.discord_user_id=%s)
                    ORDER BY e.id FOR UPDATE OF e""",
                    (group_key, user),
                )
                copies = await result.fetchall() or [source]
                if not any(copy["id"] == event_id for copy in copies):
                    return None
            shared_values = {"title": title, "description": description, "icon_url": icon}
            changed = {
                field for field, value in shared_values.items() if source.get(field) != value
            }
            if shared_fields is not None:
                changed = set(shared_fields) & shared_values.keys()
            saved = None
            for copy in copies:
                if copy["id"] != event_id:
                    if changed:
                        await c.execute(
                            """UPDATE custom_events SET
                            title=CASE WHEN %s THEN %s ELSE title END,
                            description=CASE WHEN %s THEN %s ELSE description END,
                            icon_url=CASE WHEN %s THEN %s ELSE icon_url END,
                            updated_at=NOW() WHERE id=%s""",
                            (
                                "title" in changed,
                                title,
                                "description" in changed,
                                description,
                                "icon_url" in changed,
                                icon,
                                copy["id"],
                            ),
                        )
                    continue
                result = await c.execute(
                    """UPDATE custom_events SET title=%s,description=%s,start_at=%s,end_at=%s,
                    recurrence=%s,colour=%s,reminder_minutes=%s,progress=%s,icon_url=%s,updated_at=NOW()
                    WHERE id=%s RETURNING *""",
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
                        copy["id"],
                    ),
                )
                updated = await result.fetchone()
                await c.execute(
                    "DELETE FROM custom_event_progress WHERE event_id=%s", (copy["id"],)
                )
                if copy["id"] == event_id:
                    updated["account_id"] = source["viewer_account_id"]
                    saved = updated
            return saved


async def delete_custom_event(pool, user, event_id, account_id=None):
    async with pool.connection() as c:
        async with c.transaction():
            if not await visible(c, user, event_id, account_id, lock=True):
                return False
            r = await c.execute("DELETE FROM custom_events WHERE id=%s RETURNING id", (event_id,))
            return await r.fetchone() is not None


async def reorder_custom_events(pool, user, account_id, ids):
    if not ids or len(ids) != len(set(ids)):
        return False
    async with pool.connection() as c:
        async with c.transaction():
            a = await identity(c, user, account_id)
            if not a:
                return False
            r = await c.execute(
                """SELECT event_id FROM custom_event_accounts WHERE genshin_uid=%s AND genshin_server=%s
                ORDER BY sort_order,event_id FOR UPDATE""",
                (a["genshin_uid"], a["genshin_server"]),
            )
            existing = [r["event_id"] for r in await r.fetchall()]
            if not set(ids) <= set(existing):
                return False
            positions = [i for i, e in enumerate(existing) if e in ids]
            for i, e in zip(positions, ids):
                existing[i] = e
            for order, e in enumerate(existing):
                await c.execute(
                    """UPDATE custom_event_accounts SET sort_order=%s,updated_at=NOW()
                    WHERE event_id=%s AND genshin_uid=%s AND genshin_server=%s""",
                    (order, e, a["genshin_uid"], a["genshin_server"]),
                )
    return True


async def get_custom_event_account_progress(pool, user, event, account):
    async with pool.connection() as c:
        if not await visible(c, user, event, account):
            return {}
        a = await identity(c, user, account)
        r = await c.execute(
            """SELECT objective_index,current FROM custom_event_progress WHERE event_id=%s
            AND genshin_uid=%s AND genshin_server=%s""",
            (event, a["genshin_uid"], a["genshin_server"]),
        )
        return {r["objective_index"]: r["current"] for r in await r.fetchall()}


async def change_custom_event_account_progress(pool, user, event, account, index, amount, target):
    if amount not in (-1, 1) or index < 0 or target < 1:
        raise ValueError("Invalid objective change.")
    async with pool.connection() as c:
        async with c.transaction():
            e = await visible(c, user, event, account, lock=True)
            if not e or index >= len(e["progress"]) or e["progress"][index]["target"] != target:
                return None
            a = await identity(c, user, account)
            r = await c.execute(
                """INSERT INTO custom_event_progress
                (event_id,discord_user_id,account_id,genshin_uid,genshin_server,objective_index,current)
                VALUES (%s,%s,NULL,%s,%s,%s,%s)
                ON CONFLICT (event_id,genshin_uid,genshin_server,objective_index)
                WHERE genshin_uid IS NOT NULL AND genshin_server IS NOT NULL
                DO UPDATE SET current=GREATEST(0,LEAST(%s,custom_event_progress.current+%s)),updated_at=NOW()
                RETURNING current""",
                (
                    event,
                    user,
                    a["genshin_uid"],
                    a["genshin_server"],
                    index,
                    max(0, min(target, int(e["progress"][index].get("current", 0)) + amount)),
                    target,
                    amount,
                ),
            )
            return (await r.fetchone())["current"]


async def set_custom_event_completion(pool, user, event, occurrence, completed, account_id=None):
    async with pool.connection() as c:
        e = await visible(c, user, event, account_id)
        if not e:
            return False
        a = await identity(c, user, account_id or e["viewer_account_id"])
        r = await c.execute(
            """INSERT INTO custom_event_completions
            (event_id,discord_user_id,account_id,genshin_uid,genshin_server,occurrence_start,completed,completed_at)
            VALUES (%s,%s,NULL,%s,%s,%s,%s,NOW())
            ON CONFLICT (event_id,genshin_uid,genshin_server,occurrence_start)
            WHERE genshin_uid IS NOT NULL AND genshin_server IS NOT NULL
            DO UPDATE SET completed=EXCLUDED.completed,completed_at=NOW() RETURNING id""",
            (event, user, a["genshin_uid"], a["genshin_server"], occurrence, completed),
        )
        return await r.fetchone() is not None


async def get_custom_event_completions(pool, user, event, account_id=None):
    async with pool.connection() as c:
        e = await visible(c, user, event, account_id)
        if not e:
            return []
        a = await identity(c, user, account_id or e["viewer_account_id"])
        r = await c.execute(
            """SELECT occurrence_start,completed,completed_at FROM custom_event_completions
            WHERE event_id=%s AND genshin_uid=%s AND genshin_server=%s ORDER BY occurrence_start""",
            (event, a["genshin_uid"], a["genshin_server"]),
        )
        return await r.fetchall()
