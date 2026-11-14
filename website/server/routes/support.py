"""Support conversations: anyone can write in, staff answer from the site or Discord."""

import base64
import binascii
import hashlib
import re
import secrets
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Cookie, HTTPException, Request, Response

from shared import support_bridge
from shared.storage import support_store
from shared.storage.account_limits import (
    ASSIGNED_STAFF_IDS,
    SPECIAL_USER_IDS,
    STAFF_USER_IDS,
    get_account_type,
    is_staff,
)
from shared.storage.database import get_pool
from website.server.core.auth import (
    discord_profile_payload,
    get_discord_profile,
    get_web_session,
)

router = APIRouter(prefix="/api/support")
VISITOR_COOKIE = "cyrene_support"
MAX_MESSAGE_LENGTH = 2000
MAX_UPLOAD_BYTES = 15 * 1024 * 1024
WAIT_SECONDS = 25
LIMITS = {
    "ticket": (5, 3600),
    "message": (40, 3600),
    "all-tickets": (60, 3600),
}
_recent: dict[tuple[str, str], deque] = defaultdict(deque)


def rate_limit(kind, *keys):
    count, window = LIMITS[kind]
    now = time.monotonic()
    buckets = [_recent[(kind, key)] for key in keys if key]
    for bucket in buckets:
        while bucket and now - bucket[0] > window:
            bucket.popleft()
        if len(bucket) >= count:
            raise HTTPException(
                429, "You're sending messages too quickly. Please wait a while and try again."
            )
    for bucket in buckets:
        bucket.append(now)
    if len(_recent) > 5000:
        for key in [key for key, bucket in _recent.items() if not bucket]:
            del _recent[key]


def client_address(request: Request):
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else "")


class Identity:
    def __init__(self, visitor_hash, user_id, name, avatar):
        self.visitor_hash = visitor_hash
        self.user_id = user_id
        self.name = name
        self.avatar = avatar
        self.staff = is_staff(user_id)


def safe_avatar(url):
    if isinstance(url, str) and (
        url.startswith("https://cdn.discordapp.com/") or url.startswith("/static/images/")
    ):
        return url
    return None


def message_avatar(message):
    if message["author_id"] and message["avatar_hash"]:
        return discord_profile_payload(message["author_id"], message)["avatar_url"]
    return safe_avatar(message["author_avatar"])


def badges(user_id):
    if not user_id:
        return []
    found = ["staff"] if is_staff(user_id) else []
    if get_account_type(user_id) == "special":
        found.append("special")
    return found


async def identify(cyrene_session, cyrene_support, response=None):
    session = await get_web_session(cyrene_session)
    user_id = session.user_id if session else None
    token = (
        cyrene_support if cyrene_support and re.fullmatch(r"[\w-]{43}", cyrene_support) else None
    )
    if token is None and response is not None:
        token = secrets.token_urlsafe(32)
        response.set_cookie(
            VISITOR_COOKIE,
            token,
            max_age=60 * 60 * 24 * 365,
            path="/",
            secure=True,
            httponly=True,
            samesite="lax",
        )
    visitor_hash = hashlib.sha256(token.encode()).hexdigest() if token else None
    name, avatar = "Guest", None
    if user_id:
        profile = await get_discord_profile(user_id)
        name, avatar = profile["display_name"], profile["avatar_url"]
    return Identity(visitor_hash, user_id, name, avatar)


async def json_body(request: Request, limit=12000):
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        raise HTTPException(415, "Send the message as JSON.")
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise HTTPException(413, "That message is too large. Images can be up to 8 MB each.")
    if len(await request.body()) > limit:
        raise HTTPException(413, "That message is too large. Images can be up to 8 MB each.")
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "That message couldn't be read.") from None
    if not isinstance(body, dict):
        raise HTTPException(400, "That message couldn't be read.")
    return body


def message_files(body):
    images = body.get("images", [])
    if not isinstance(images, list) or len(images) > support_store.MAX_IMAGES:
        raise HTTPException(422, f"Attach up to {support_store.MAX_IMAGES} images.")
    files, total = [], 0
    for index, encoded in enumerate(images, start=1):
        try:
            data = base64.b64decode(encoded, validate=True)
        except TypeError, ValueError, binascii.Error:
            raise HTTPException(422, "One of the images couldn't be read.") from None
        kind = support_store.sniff_image(data)
        if kind is None:
            raise HTTPException(422, "Images must be PNG, JPEG, GIF or WebP.")
        if len(data) > support_store.MAX_IMAGE_BYTES:
            raise HTTPException(422, "Each image can be up to 8 MB.")
        total += len(data)
        extension, content_type = kind
        files.append(
            {"filename": f"image-{index}.{extension}", "content_type": content_type, "data": data}
        )
    if total > support_store.MAX_TOTAL_IMAGE_BYTES:
        raise HTTPException(422, "Images in one message can add up to 10 MB.")
    return files


def message_text(body, files=()):
    text = body.get("body", "")
    if not isinstance(text, str):
        raise HTTPException(422, "Write a message first.")
    text = text.strip()
    if not text and not files:
        raise HTTPException(422, "Write a message or attach an image first.")
    if len(text) > MAX_MESSAGE_LENGTH:
        raise HTTPException(422, "Keep your message under 2,000 characters.")
    return text


FINISHED_MESSAGE = (
    "This conversation has finished, so it can't take new messages. Start a new one instead."
)
MENTION_PATTERN = re.compile(r"<@!?(\d{15,20})>")
ROLE_TOKEN = "<@&support>"
ROLE_NAME = "Cyrene Support"
_names: dict[int, str] = {}


def staff_ids():
    return SPECIAL_USER_IDS | STAFF_USER_IDS | ASSIGNED_STAFF_IDS


async def people_for(user_ids):
    people = []
    for user_id in dict.fromkeys(user_ids):
        profile = await get_discord_profile(user_id)
        _names[user_id] = profile["display_name"]
        people.append(
            {
                "id": str(user_id),
                "name": profile["display_name"],
                "avatar": safe_avatar(profile["avatar_url"]),
                "staff": is_staff(user_id),
            }
        )
    return people


def mention_ids(text):
    return [int(match) for match in MENTION_PATTERN.findall(text or "")]


def clean_mentions(text, allowed):
    return MENTION_PATTERN.sub(
        lambda match: match[0] if int(match[1]) in allowed else "@someone", text
    )


def readable(text):
    text = MENTION_PATTERN.sub(lambda match: f"@{_names.get(int(match[1]), 'someone')}", text)
    return text.replace(ROLE_TOKEN, f"@{ROLE_NAME}")


async def mentionable(ticket_id=None):
    ids = list(staff_ids())
    if ticket_id is not None:
        messages = await support_store.get_messages(get_pool(), ticket_id)
        ids = [message["author_id"] for message in messages if message["author_id"]] + ids
    people = await people_for(ids)
    return [{"id": "support", "name": ROLE_NAME, "avatar": None, "staff": True, "role": True}] + (
        people
    )


def summary(ticket):
    preview = readable(ticket["preview"]) or "📷 Image"
    return {
        "id": ticket["id"],
        "topic": support_store.TOPICS.get(ticket["topic"], ticket["topic"]),
        "status": ticket["status"],
        "author": ticket["author_name"],
        "preview": shorten(preview, 140),
        "updated_at": ticket["updated_at"].isoformat(),
        "last_from_staff": ticket["last_from_staff"],
        "last_author": ticket["last_author"],
        "last_body": shorten(readable(ticket["last_body"]) or "📷 Image", 160),
        "last_avatar": safe_avatar(ticket["last_avatar"]),
        "unread": ticket["unread"],
    }


def shorten(text, limit):
    return text if len(text) <= limit else f"{text[: limit - 1]}…"


async def accessible_ticket(ticket_id, identity):
    ticket = await support_store.get_ticket(get_pool(), ticket_id)
    if ticket is None:
        raise HTTPException(404, "Conversation not found.")
    owner = support_store.owns(ticket, identity.visitor_hash, identity.user_id)
    if not owner and not identity.staff:
        raise HTTPException(404, "Conversation not found.")
    return ticket, owner


@router.get("")
async def overview(
    cyrene_session: str | None = Cookie(default=None),
    cyrene_support: str | None = Cookie(default=None),
):
    identity = await identify(cyrene_session, cyrene_support)
    pool = get_pool()
    tickets = await support_store.list_owned(pool, identity.visitor_hash, identity.user_id, "open")
    unread, waiting = await support_store.counts(
        pool, identity.visitor_hash, identity.user_id, identity.staff
    )
    waiting_tickets = []
    if identity.staff and waiting:
        waiting_tickets = [
            summary(ticket) for ticket in await support_store.list_waiting(pool, identity.user_id)
        ]
    return {
        "signed_in": identity.user_id is not None,
        "staff": identity.staff,
        "unread": unread,
        "waiting": waiting,
        "topics": support_store.TOPICS,
        "tickets": [summary(ticket) for ticket in tickets],
        "waiting_tickets": waiting_tickets,
        "version": support_bridge.version(support_bridge.ANY_TICKET),
    }


@router.get("/updates")
async def wait_for_updates(version: int = 0):
    return {"version": await support_bridge.wait(support_bridge.ANY_TICKET, version, WAIT_SECONDS)}


@router.get("/attachments/{attachment_id}")
async def attachment(
    attachment_id: int,
    cyrene_session: str | None = Cookie(default=None),
    cyrene_support: str | None = Cookie(default=None),
):
    file = await support_store.get_attachment(get_pool(), attachment_id)
    if file is None:
        raise HTTPException(404, "Image not found.")
    identity = await identify(cyrene_session, cyrene_support)
    await accessible_ticket(file["ticket_id"], identity)
    return Response(
        content=bytes(file["data"]),
        media_type=file["content_type"],
        headers={
            "Cache-Control": "private, max-age=86400",
            "Content-Disposition": f'inline; filename="{file["filename"]}"',
        },
    )


@router.get("/inbox")
async def inbox(
    cyrene_session: str | None = Cookie(default=None),
    cyrene_support: str | None = Cookie(default=None),
):
    identity = await identify(cyrene_session, cyrene_support)
    tickets = await support_store.list_owned(
        get_pool(), identity.visitor_hash, identity.user_id, "done"
    )
    return {"tickets": [summary(ticket) for ticket in tickets]}


@router.get("/staff")
async def staff_tickets(
    state: str = "open",
    cyrene_session: str | None = Cookie(default=None),
    cyrene_support: str | None = Cookie(default=None),
):
    identity = await identify(cyrene_session, cyrene_support)
    if not identity.staff:
        raise HTTPException(403, "Only staff can see other people's conversations.")
    if state not in support_store.STATES:
        raise HTTPException(422, "Choose open or finished conversations.")
    tickets = await support_store.list_staff(get_pool(), identity.user_id, state)
    return {"tickets": [summary(ticket) for ticket in tickets]}


@router.get("/tickets/{ticket_id}")
async def conversation(
    ticket_id: int,
    cyrene_session: str | None = Cookie(default=None),
    cyrene_support: str | None = Cookie(default=None),
):
    identity = await identify(cyrene_session, cyrene_support)
    ticket, owner = await accessible_ticket(ticket_id, identity)
    pool = get_pool()
    if owner:
        await support_store.mark_seen(pool, ticket_id)
    elif identity.staff:
        await support_store.mark_staff_seen(pool, ticket_id, identity.user_id)
    messages = await support_store.get_messages(pool, ticket_id)
    images = attachments_by_message(await support_store.list_attachments(pool, ticket_id))
    mentioned = [user_id for message in messages for user_id in mention_ids(message["body"])]
    return {
        "people": {person["id"]: person["name"] for person in await people_for(mentioned)},
        "id": ticket["id"],
        "topic": support_store.TOPICS.get(ticket["topic"], ticket["topic"]),
        "status": ticket["status"],
        "locked": ticket["locked"],
        "author": ticket["author_name"],
        "owner": owner,
        "updated_at": ticket["updated_at"].isoformat(),
        "version": support_bridge.version(ticket_id),
        "messages": [
            {
                "id": message["id"],
                "from_staff": message["from_staff"],
                "author": message["author_name"],
                "avatar": message_avatar(message),
                "badges": badges(message["author_id"]),
                "body": message["body"],
                "images": images.get(message["id"], []),
                "created_at": message["created_at"].isoformat(),
            }
            for message in messages
        ],
    }


def attachments_by_message(rows):
    grouped = {}
    for row in rows:
        grouped.setdefault(row["message_id"], []).append(f"/api/support/attachments/{row['id']}")
    return grouped


@router.get("/people")
async def new_ticket_people():
    return {"people": await mentionable()}


@router.get("/tickets/{ticket_id}/people")
async def ticket_people(
    ticket_id: int,
    cyrene_session: str | None = Cookie(default=None),
    cyrene_support: str | None = Cookie(default=None),
):
    identity = await identify(cyrene_session, cyrene_support)
    await accessible_ticket(ticket_id, identity)
    return {"people": await mentionable(ticket_id)}


@router.get("/tickets/{ticket_id}/wait")
async def wait_for_change(
    ticket_id: int,
    version: int = 0,
    cyrene_session: str | None = Cookie(default=None),
    cyrene_support: str | None = Cookie(default=None),
):
    identity = await identify(cyrene_session, cyrene_support)
    await accessible_ticket(ticket_id, identity)
    return {"version": await support_bridge.wait(ticket_id, version, WAIT_SECONDS)}


@router.post("/tickets")
async def create_conversation(
    request: Request,
    response: Response,
    cyrene_session: str | None = Cookie(default=None),
    cyrene_support: str | None = Cookie(default=None),
):
    body = await json_body(request, MAX_UPLOAD_BYTES)
    topic = body.get("topic")
    if topic not in support_store.TOPICS:
        raise HTTPException(422, "Choose what your message is about.")
    files = message_files(body)
    text = clean_mentions(message_text(body, files), staff_ids())
    identity = await identify(cyrene_session, cyrene_support, response)
    rate_limit(
        "ticket", identity.visitor_hash, client_address(request), str(identity.user_id or "")
    )
    rate_limit("all-tickets", "site")
    ticket, message = await support_store.create_ticket(
        get_pool(),
        identity.visitor_hash,
        identity.user_id,
        identity.name,
        identity.avatar,
        topic,
        text,
        files,
    )
    support_bridge.send("ticket", ticket, dict(message, files=files))
    return {"id": ticket["id"]}


@router.post("/tickets/{ticket_id}/messages")
async def reply(
    ticket_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    cyrene_support: str | None = Cookie(default=None),
):
    body = await json_body(request, MAX_UPLOAD_BYTES)
    files = message_files(body)
    text = message_text(body, files)
    identity = await identify(cyrene_session, cyrene_support)
    ticket, owner = await accessible_ticket(ticket_id, identity)
    if ticket["status"] != "open":
        raise HTTPException(409, FINISHED_MESSAGE)
    if owner and ticket["locked"]:
        raise HTTPException(403, "Staff have locked this conversation, so only they can reply.")
    rate_limit("message", identity.visitor_hash, client_address(request))
    from_staff = not owner
    pool = get_pool()
    participants = {
        message["author_id"]
        for message in await support_store.get_messages(pool, ticket_id)
        if message["author_id"]
    }
    text = clean_mentions(text, staff_ids() | participants)
    try:
        message = await support_store.add_message(
            pool,
            ticket_id,
            from_staff,
            identity.name,
            text,
            "site",
            author_id=identity.user_id,
            author_avatar=identity.avatar,
            files=files,
        )
    except support_store.TicketFinished:
        raise HTTPException(409, FINISHED_MESSAGE) from None
    if owner:
        await support_store.mark_seen(pool, ticket_id)
    support_bridge.send(
        "message", await support_store.get_ticket(pool, ticket_id), dict(message, files=files)
    )
    return {"ok": True}


@router.post("/tickets/{ticket_id}/status")
async def change_status(
    ticket_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    cyrene_support: str | None = Cookie(default=None),
):
    body = await json_body(request)
    status = body.get("status")
    if status not in support_store.STATUSES:
        raise HTTPException(422, "Choose solved or closed.")
    if status == "open":
        raise HTTPException(
            403, "Finished conversations can't be reopened. Start a new one instead."
        )
    identity = await identify(cyrene_session, cyrene_support)
    ticket, _ = await accessible_ticket(ticket_id, identity)
    if ticket["status"] == status:
        return {"ok": True}
    pool = get_pool()
    await support_store.set_status(pool, ticket_id, status)
    support_bridge.send(
        "status", await support_store.get_ticket(pool, ticket_id), {"actor": identity.name}
    )
    return {"ok": True}
