"""Staff pages for reading support conversations as readable transcripts."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Cookie, HTTPException, Request
from fastapi.responses import HTMLResponse

from shared.storage import support_store
from shared.storage.account_limits import is_staff
from shared.storage.database import get_pool
from website.server.core.auth import get_web_session, verification_redirect
from website.server.core.templating import templates
from website.server.routes.support import (
    attachments_by_message,
    badges,
    mention_ids,
    message_avatar,
    people_for,
)

router = APIRouter()
FILTERS = {"all": ("solved", "closed"), "solved": ("solved",), "closed": ("closed",)}
GROUP_WINDOW = timedelta(minutes=5)


async def require_staff(cyrene_session, path):
    session = await get_web_session(cyrene_session)
    if session is None:
        return verification_redirect(path)
    if not is_staff(session.user_id):
        raise HTTPException(404, "Page not found")
    return None


def duration(start, end):
    minutes = int((end - start).total_seconds() // 60)
    days, minutes = divmod(minutes, 1440)
    hours, minutes = divmod(minutes, 60)
    parts = [
        f"{days}d" if days else "",
        f"{hours}h" if hours else "",
        f"{minutes}m" if minutes else "",
    ]
    return " ".join(part for part in parts if part) or "under a minute"


@router.get("/support/logs", response_class=HTMLResponse)
async def logs(
    request: Request, status: str = "all", cyrene_session: str | None = Cookie(default=None)
):
    if redirect := await require_staff(cyrene_session, "/support/logs"):
        return redirect
    if status not in FILTERS:
        status = "all"
    tickets = await support_store.list_finished(get_pool(), FILTERS[status])
    return templates.TemplateResponse(
        request=request,
        name="support/logs.html",
        context={
            "request": request,
            "status": status,
            "topics": support_store.TOPICS,
            "tickets": [
                dict(ticket, lasted=duration(ticket["created_at"], ticket["updated_at"]))
                for ticket in tickets
            ],
        },
    )


@router.get("/support/logs/{ticket_id}", response_class=HTMLResponse)
async def log(request: Request, ticket_id: int, cyrene_session: str | None = Cookie(default=None)):
    if redirect := await require_staff(cyrene_session, f"/support/logs/{ticket_id}"):
        return redirect
    pool = get_pool()
    ticket = await support_store.get_ticket(pool, ticket_id)
    if ticket is None:
        raise HTTPException(404, "Ticket not found")
    images = attachments_by_message(await support_store.list_attachments(pool, ticket_id))
    messages = []
    previous = None
    for message in await support_store.get_messages(pool, ticket_id):
        created = message["created_at"]
        new_day = previous is None or previous["created_at"].date() != created.date()
        grouped = (
            not new_day
            and previous["author_name"] == message["author_name"]
            and previous["from_staff"] == message["from_staff"]
            and created - previous["created_at"] < GROUP_WINDOW
        )
        messages.append(
            dict(
                message,
                avatar=message_avatar(message),
                badges=badges(message["author_id"]),
                day=f"{created:%d %B %Y}" if new_day else None,
                grouped=grouped,
                images=images.get(message["id"], []),
            )
        )
        previous = message
    end = ticket["updated_at"] if ticket["status"] != "open" else datetime.now(timezone.utc)
    return templates.TemplateResponse(
        request=request,
        name="support/log.html",
        context={
            "request": request,
            "ticket": ticket,
            "topic": support_store.TOPICS.get(ticket["topic"], ticket["topic"]),
            "messages": messages,
            "author": next((m for m in messages if not m["from_staff"]), None),
            "staff": sorted({m["author_name"] for m in messages if m["from_staff"]}),
            "lasted": duration(ticket["created_at"], end),
            "people": {
                person["id"]: person["name"]
                for person in await people_for(
                    [user_id for message in messages for user_id in mention_ids(message["body"])]
                )
            },
        },
    )
