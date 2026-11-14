"""Support conversations shared by the website panel and staff threads in Discord."""

from shared import support_bridge
from shared.storage.account_limits import ASSIGNED_STAFF_IDS

TOPICS = {"bug": "Bug or error", "account": "My account", "question": "A question"}
STATUSES = ("open", "solved", "closed")

TICKET_COLUMNS = """t.id, t.discord_user_id, t.author_name, t.topic, t.status, t.discord_thread_id,
    t.created_at, t.updated_at, t.user_seen_at, t.visitor_hash, t.locked"""
STATES = {"open": ["open"], "done": ["solved", "closed"]}
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024


class TicketFinished(Exception):
    """Raised when someone writes in a solved or closed ticket; only staff can reopen it."""


def sniff_image(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif", "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


LAST_FROM_STAFF = """(SELECT from_staff FROM support_messages
    WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1)"""
UNSEEN_BY_STAFF = """NOT EXISTS (
    SELECT 1 FROM support_staff_seen AS seen
    WHERE seen.ticket_id = t.id AND seen.staff_id = %(staff)s
        AND seen.seen_at >= (SELECT created_at FROM support_messages
            WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1)
)"""

SUMMARY_QUERY = f"""SELECT {TICKET_COLUMNS},
    first_message.body AS preview,
    last_message.from_staff AS last_from_staff,
    last_message.author_name AS last_author,
    last_message.body AS last_body,
    last_message.author_avatar AS last_avatar,
    EXISTS (
        SELECT 1 FROM support_messages AS staff
        WHERE staff.ticket_id = t.id AND staff.from_staff AND staff.created_at > t.user_seen_at
    ) AS unread
FROM support_tickets AS t
JOIN LATERAL (
    SELECT body FROM support_messages WHERE ticket_id = t.id ORDER BY id LIMIT 1
) AS first_message ON TRUE
JOIN LATERAL (
    SELECT from_staff, author_name, body, author_avatar FROM support_messages
    WHERE ticket_id = t.id ORDER BY id DESC LIMIT 1
) AS last_message ON TRUE"""


async def migrate(connection):
    await connection.execute("""CREATE TABLE IF NOT EXISTS support_tickets (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            visitor_hash TEXT,
            discord_user_id BIGINT,
            author_name TEXT NOT NULL,
            topic TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            discord_thread_id BIGINT UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            user_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    await connection.execute("""CREATE TABLE IF NOT EXISTS support_messages (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
            from_staff BOOLEAN NOT NULL,
            author_name TEXT NOT NULL,
            body TEXT NOT NULL,
            source TEXT NOT NULL,
            discord_message_id BIGINT UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    await connection.execute(
        "ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS author_id BIGINT"
    )
    await connection.execute(
        "ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS author_avatar TEXT"
    )
    await connection.execute(
        """UPDATE support_messages AS m SET author_id = t.discord_user_id
        FROM support_tickets AS t
        WHERE m.ticket_id = t.id AND m.source = 'site' AND NOT m.from_staff
            AND m.author_id IS NULL AND t.discord_user_id IS NOT NULL"""
    )
    await connection.execute(
        "ALTER TABLE support_tickets DROP COLUMN IF EXISTS claimed_by, DROP COLUMN IF EXISTS claimed_name"
    )
    await connection.execute(
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE"
    )
    await connection.execute("""CREATE TABLE IF NOT EXISTS support_attachments (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
            message_id BIGINT NOT NULL REFERENCES support_messages(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            content_type TEXT NOT NULL,
            data BYTEA NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    await connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_support_attachments_ticket ON support_attachments(ticket_id, message_id)"
    )
    await connection.execute("""CREATE TABLE IF NOT EXISTS support_staff_seen (
            ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
            staff_id BIGINT NOT NULL,
            seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (ticket_id, staff_id))""")
    await connection.execute("""CREATE TABLE IF NOT EXISTS support_staff (
            discord_user_id BIGINT PRIMARY KEY,
            added_by BIGINT NOT NULL,
            added_at TIMESTAMPTZ NOT NULL DEFAULT NOW())""")
    result = await connection.execute("SELECT discord_user_id FROM support_staff")
    ASSIGNED_STAFF_IDS.clear()
    ASSIGNED_STAFF_IDS.update(row["discord_user_id"] for row in await result.fetchall())
    await connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_support_tickets_visitor ON support_tickets(visitor_hash)"
    )
    await connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(discord_user_id)"
    )
    await connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, updated_at DESC)"
    )
    await connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_support_messages_ticket ON support_messages(ticket_id, id)"
    )


def owner_filter(visitor_hash, discord_user_id):
    clauses, values = [], []
    if discord_user_id:
        clauses.append("t.discord_user_id = %s")
        values.append(discord_user_id)
    if visitor_hash:
        clauses.append("(t.discord_user_id IS NULL AND t.visitor_hash = %s)")
        values.append(visitor_hash)
    return " OR ".join(clauses) or "FALSE", values


def owns(ticket, visitor_hash, discord_user_id):
    if ticket["discord_user_id"] is not None:
        return bool(discord_user_id) and ticket["discord_user_id"] == discord_user_id
    return bool(visitor_hash) and ticket["visitor_hash"] == visitor_hash


async def save_attachments(connection, ticket_id, message_id, files):
    for file in files or ():
        await connection.execute(
            """INSERT INTO support_attachments (ticket_id, message_id, filename, content_type, data)
            VALUES (%s, %s, %s, %s, %s)""",
            (ticket_id, message_id, file["filename"], file["content_type"], file["data"]),
        )


async def create_ticket(
    pool, visitor_hash, discord_user_id, author_name, author_avatar, topic, body, files=None
):
    async with pool.connection() as connection:
        async with connection.transaction():
            result = await connection.execute(
                f"""INSERT INTO support_tickets AS t (visitor_hash, discord_user_id, author_name, topic)
                VALUES (%s, %s, %s, %s) RETURNING {TICKET_COLUMNS}""",
                (visitor_hash, discord_user_id, author_name, topic),
            )
            ticket = await result.fetchone()
            result = await connection.execute(
                """INSERT INTO support_messages
                (ticket_id, from_staff, author_name, body, source, author_id, author_avatar)
                VALUES (%s, FALSE, %s, %s, 'site', %s, %s) RETURNING *""",
                (ticket["id"], author_name, body, discord_user_id, author_avatar),
            )
            message = await result.fetchone()
            await save_attachments(connection, ticket["id"], message["id"], files)
    support_bridge.touch(ticket["id"])
    return ticket, message


async def list_attachments(pool, ticket_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            """SELECT id, message_id, filename, content_type FROM support_attachments
            WHERE ticket_id=%s ORDER BY id""",
            (ticket_id,),
        )
        return await result.fetchall()


async def get_attachment(pool, attachment_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            "SELECT id, ticket_id, filename, content_type, data FROM support_attachments WHERE id=%s",
            (attachment_id,),
        )
        return await result.fetchone()


async def add_message(
    pool,
    ticket_id,
    from_staff,
    author_name,
    body,
    source,
    discord_message_id=None,
    author_id=None,
    author_avatar=None,
    files=None,
):
    async with pool.connection() as connection:
        async with connection.transaction():
            result = await connection.execute(
                "SELECT status FROM support_tickets WHERE id=%s FOR UPDATE", (ticket_id,)
            )
            ticket = await result.fetchone()
            if ticket is None or ticket["status"] != "open":
                raise TicketFinished(ticket_id)
            result = await connection.execute(
                """INSERT INTO support_messages
                (ticket_id, from_staff, author_name, body, source, discord_message_id,
                    author_id, author_avatar)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (discord_message_id) DO NOTHING RETURNING *""",
                (
                    ticket_id,
                    from_staff,
                    author_name,
                    body,
                    source,
                    discord_message_id,
                    author_id,
                    author_avatar,
                ),
            )
            message = await result.fetchone()
            if message is not None:
                await connection.execute(
                    "UPDATE support_tickets SET updated_at=NOW() WHERE id=%s",
                    (ticket_id,),
                )
                await save_attachments(connection, ticket_id, message["id"], files)
    if message is not None:
        support_bridge.touch(ticket_id)
    return message


async def get_ticket(pool, ticket_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            f"SELECT {TICKET_COLUMNS} FROM support_tickets AS t WHERE t.id=%s", (ticket_id,)
        )
        return await result.fetchone()


async def ticket_by_thread(pool, thread_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            f"SELECT {TICKET_COLUMNS} FROM support_tickets AS t WHERE t.discord_thread_id=%s",
            (thread_id,),
        )
        return await result.fetchone()


async def get_messages(pool, ticket_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            """SELECT m.id, m.from_staff, m.author_name, m.author_id, m.author_avatar, m.body,
                m.source, m.created_at, profile.avatar_hash
            FROM support_messages AS m
            LEFT JOIN web_discord_profiles AS profile ON profile.discord_user_id = m.author_id
            WHERE m.ticket_id=%s ORDER BY m.id""",
            (ticket_id,),
        )
        return await result.fetchall()


async def discord_messages_missing_author(pool, limit=200):
    async with pool.connection() as connection:
        result = await connection.execute(
            """SELECT m.discord_message_id, t.discord_thread_id
            FROM support_messages AS m JOIN support_tickets AS t ON t.id = m.ticket_id
            WHERE m.source = 'discord' AND m.author_id IS NULL
                AND m.discord_message_id IS NOT NULL AND t.discord_thread_id IS NOT NULL
            ORDER BY m.id LIMIT %s""",
            (limit,),
        )
        return await result.fetchall()


async def update_discord_message(
    pool, discord_message_id, body, author_id=None, author_avatar=None
):
    async with pool.connection() as connection:
        result = await connection.execute(
            """UPDATE support_messages SET body=%s,
                author_id=COALESCE(%s, author_id), author_avatar=COALESCE(%s, author_avatar)
            WHERE discord_message_id=%s RETURNING ticket_id""",
            (body, author_id, author_avatar, discord_message_id),
        )
        row = await result.fetchone()
    if row is not None:
        support_bridge.touch(row["ticket_id"])
    return row is not None


async def list_owned(pool, visitor_hash, discord_user_id, state, limit=30):
    where, values = owner_filter(visitor_hash, discord_user_id)
    async with pool.connection() as connection:
        result = await connection.execute(
            f"""{SUMMARY_QUERY} WHERE ({where}) AND t.status = ANY(%s)
            ORDER BY t.updated_at DESC LIMIT %s""",
            (*values, STATES[state], limit),
        )
        return await result.fetchall()


async def list_staff(pool, staff_id, state, limit=50):
    async with pool.connection() as connection:
        result = await connection.execute(
            f"""{SUMMARY_QUERY}
            WHERE t.status = ANY(%(statuses)s) AND t.discord_user_id IS DISTINCT FROM %(staff)s
            ORDER BY t.updated_at DESC LIMIT %(limit)s""",
            {"statuses": STATES[state], "staff": staff_id, "limit": limit},
        )
        return await result.fetchall()


async def list_finished(pool, statuses, limit=200):
    async with pool.connection() as connection:
        result = await connection.execute(
            f"""SELECT {TICKET_COLUMNS}, first_message.body AS preview,
                (SELECT COUNT(*) FROM support_messages AS m WHERE m.ticket_id = t.id)
                    AS message_count,
                (SELECT string_agg(DISTINCT m.author_name, ', ') FROM support_messages AS m
                    WHERE m.ticket_id = t.id AND m.from_staff) AS staff_names
            FROM support_tickets AS t
            JOIN LATERAL (
                SELECT body FROM support_messages WHERE ticket_id = t.id ORDER BY id LIMIT 1
            ) AS first_message ON TRUE
            WHERE t.status = ANY(%s)
            ORDER BY t.updated_at DESC LIMIT %s""",
            (list(statuses), limit),
        )
        return await result.fetchall()


async def list_waiting(pool, staff_id, limit=20):
    async with pool.connection() as connection:
        result = await connection.execute(
            f"""{SUMMARY_QUERY}
            WHERE t.status = 'open' AND NOT last_message.from_staff
                AND t.discord_user_id IS DISTINCT FROM %(staff)s AND {UNSEEN_BY_STAFF}
            ORDER BY t.updated_at DESC LIMIT %(limit)s""",
            {"staff": staff_id, "limit": limit},
        )
        return await result.fetchall()


async def counts(pool, visitor_hash, discord_user_id, staff):
    where, values = owner_filter(visitor_hash, discord_user_id)
    async with pool.connection() as connection:
        result = await connection.execute(
            f"""SELECT COUNT(*) AS unread FROM support_tickets AS t
            WHERE ({where}) AND EXISTS (
                SELECT 1 FROM support_messages AS m
                WHERE m.ticket_id = t.id AND m.from_staff AND m.created_at > t.user_seen_at
            )""",
            values,
        )
        unread = (await result.fetchone())["unread"]
        waiting = 0
        if staff:
            result = await connection.execute(
                f"""SELECT COUNT(*) AS waiting FROM support_tickets AS t
                WHERE t.status='open' AND NOT {LAST_FROM_STAFF}
                    AND t.discord_user_id IS DISTINCT FROM %(staff)s AND {UNSEEN_BY_STAFF}""",
                {"staff": discord_user_id},
            )
            waiting = (await result.fetchone())["waiting"]
        return unread, waiting


async def mark_staff_seen(pool, ticket_id, staff_id):
    async with pool.connection() as connection:
        await connection.execute(
            """INSERT INTO support_staff_seen (ticket_id, staff_id) VALUES (%s, %s)
            ON CONFLICT (ticket_id, staff_id) DO UPDATE SET seen_at = NOW()""",
            (ticket_id, staff_id),
        )


async def mark_seen(pool, ticket_id):
    async with pool.connection() as connection:
        await connection.execute(
            "UPDATE support_tickets SET user_seen_at=NOW() WHERE id=%s", (ticket_id,)
        )


async def set_status(pool, ticket_id, status):
    async with pool.connection() as connection:
        await connection.execute(
            "UPDATE support_tickets SET status=%s, updated_at=NOW() WHERE id=%s AND status<>%s",
            (status, ticket_id, status),
        )
    support_bridge.touch(ticket_id)


async def set_locked(pool, ticket_id, locked):
    async with pool.connection() as connection:
        result = await connection.execute(
            "UPDATE support_tickets SET locked=%s, updated_at=NOW() WHERE id=%s AND locked<>%s",
            (locked, ticket_id, locked),
        )
    if result.rowcount == 1:
        support_bridge.touch(ticket_id)
        return True
    return False


async def assign_staff(pool, discord_user_id, added_by):
    async with pool.connection() as connection:
        result = await connection.execute(
            """INSERT INTO support_staff (discord_user_id, added_by) VALUES (%s, %s)
            ON CONFLICT (discord_user_id) DO NOTHING""",
            (discord_user_id, added_by),
        )
    ASSIGNED_STAFF_IDS.add(discord_user_id)
    return result.rowcount == 1


async def unassign_staff(pool, discord_user_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            "DELETE FROM support_staff WHERE discord_user_id=%s", (discord_user_id,)
        )
    ASSIGNED_STAFF_IDS.discard(discord_user_id)
    return result.rowcount == 1


async def tickets_with_threads(pool):
    async with pool.connection() as connection:
        result = await connection.execute(
            f"""SELECT {TICKET_COLUMNS} FROM support_tickets AS t
            WHERE t.discord_thread_id IS NOT NULL ORDER BY t.id"""
        )
        return await result.fetchall()


async def close_inactive(pool, hours):
    async with pool.connection() as connection:
        result = await connection.execute(
            f"""UPDATE support_tickets AS t SET status='closed', updated_at=NOW()
            WHERE t.status='open' AND t.updated_at < NOW() - make_interval(hours => %s)
            RETURNING {TICKET_COLUMNS}""",
            (hours,),
        )
        closed = await result.fetchall()
    for ticket in closed:
        support_bridge.touch(ticket["id"])
    return closed


async def close_if_open(pool, ticket_id):
    async with pool.connection() as connection:
        result = await connection.execute(
            "UPDATE support_tickets SET status='closed', updated_at=NOW() WHERE id=%s AND status='open'",
            (ticket_id,),
        )
    if result.rowcount == 1:
        support_bridge.touch(ticket_id)
        return True
    return False


async def set_thread(pool, ticket_id, thread_id):
    async with pool.connection() as connection:
        await connection.execute(
            "UPDATE support_tickets SET discord_thread_id=%s WHERE id=%s", (thread_id, ticket_id)
        )
