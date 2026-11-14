"""Public site updates with Discord-authorised publishing and local inline icons."""

import re
from datetime import date
from pathlib import Path

from fastapi import APIRouter, Cookie, HTTPException, Request

from shared.storage.account_limits import SPECIAL_USER_IDS
from shared.storage.database import get_pool
from website.server.core.auth import get_web_session

router = APIRouter(prefix="/api/changelog")
ICON_DIR = Path(__file__).resolve().parents[3] / "website/static/images/ui/ui_misc"


def icons():
    return [
        {
            "name": path.stem,
            "label": "Fix/Redesign" if path.stem == "Fix_Redesign" else path.stem.replace("_", " "),
            "url": f"/static/images/ui/ui_misc/{path.name}",
        }
        for path in sorted(ICON_DIR.glob("*.png"))
        if path.stem not in {"Live_Status", "Changelog"}
        and re.fullmatch(r"[A-Za-z0-9_]+", path.stem)
    ]


def content_lines(content):
    allowed = {icon["name"]: icon for icon in icons()}
    return [
        [
            allowed[part[1:-1]]
            if part.startswith(":") and part[1:-1] in allowed
            else {"text": part}
            for part in re.split(r"(:[A-Za-z0-9_]+:)", line)
            if part
        ]
        for line in content.splitlines()
        if line.strip()
    ]


async def can_edit(token):
    session = await get_web_session(token)
    return bool(session and session.user_id in SPECIAL_USER_IDS)


async def require_editor(token):
    session = await get_web_session(token)
    if session is None:
        raise HTTPException(401, "Sign in to manage the changelog.")
    if session.user_id not in SPECIAL_USER_IDS:
        raise HTTPException(403, "You cannot manage the changelog.")
    return session.user_id


async def entries():
    async with get_pool().connection() as connection:
        result = await connection.execute(
            "SELECT id, entry_date, content, pill_colour, pill_colour_end, entry_time FROM site_changelog ORDER BY entry_date DESC, entry_time DESC, id DESC"
        )
        return [
            dict(
                row,
                date=row["entry_date"].isoformat(),
                date_label=f"{row['entry_date'].day} {row['entry_date']:%b %Y}, {str(row['entry_time'])[:5]}",
                time=str(row["entry_time"])[:5],
                lines=content_lines(row["content"]),
            )
            for row in await result.fetchall()
        ]


async def validated_body(request):
    if request.headers.get("content-type", "").split(";")[0].strip() != "application/json":
        raise HTTPException(415, "Use JSON to publish an update.")
    if len(await request.body()) > 24000:
        raise HTTPException(413, "Keep the update under 8,000 characters.")
    try:
        body = await request.json()
        entry_date = date.fromisoformat(body["date"])
        entry_time = body.get("time", "00:00")
        if not isinstance(entry_time, str) or not re.fullmatch(
            r"(?:[01]\d|2[0-3]):[0-5]\d", entry_time
        ):
            raise ValueError
        content = body["content"]
        if not isinstance(content, str) or not content.strip() or len(content) > 8000:
            raise ValueError
        if len(content.splitlines()) > 100:
            raise ValueError
        pill_colour = body.get("pill_colour", "#8f9cff")
        if not isinstance(pill_colour, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", pill_colour):
            raise ValueError
        colour_end = body.get("pill_colour_end")
        if colour_end is not None and (
            not isinstance(colour_end, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", colour_end)
        ):
            raise ValueError
        return (
            entry_date,
            entry_time,
            content.strip(),
            pill_colour.lower(),
            colour_end.lower() if colour_end else None,
        )
    except ValueError, TypeError, KeyError:
        raise HTTPException(
            422, "Choose a date and write 1–8,000 characters (up to 100 lines)."
        ) from None


@router.get("")
async def changelog_data(cyrene_session: str | None = Cookie(default=None)):
    return {
        "entries": await entries(),
        "can_edit": await can_edit(cyrene_session),
        "icons": icons(),
    }


@router.post("")
async def create_entry(request: Request, cyrene_session: str | None = Cookie(default=None)):
    user_id = await require_editor(cyrene_session)
    entry_date, entry_time, content, pill_colour, pill_colour_end = await validated_body(request)
    async with get_pool().connection() as connection:
        await connection.execute(
            "INSERT INTO site_changelog (entry_date, entry_time, content, author_id, pill_colour, pill_colour_end) VALUES (%s, %s, %s, %s, %s, %s)",
            (entry_date, entry_time, content, user_id, pill_colour, pill_colour_end),
        )
    return {"ok": True}


@router.put("/{entry_id}")
async def edit_entry(
    entry_id: int, request: Request, cyrene_session: str | None = Cookie(default=None)
):
    await require_editor(cyrene_session)
    entry_date, entry_time, content, pill_colour, pill_colour_end = await validated_body(request)
    async with get_pool().connection() as connection:
        result = await connection.execute(
            "UPDATE site_changelog SET entry_date=%s, entry_time=%s, content=%s, pill_colour=%s, pill_colour_end=%s, updated_at=NOW() WHERE id=%s",
            (entry_date, entry_time, content, pill_colour, pill_colour_end, entry_id),
        )
        if result.rowcount != 1:
            raise HTTPException(404, "Update not found.")
    return {"ok": True}


@router.delete("/{entry_id}")
async def delete_entry(entry_id: int, cyrene_session: str | None = Cookie(default=None)):
    await require_editor(cyrene_session)
    async with get_pool().connection() as connection:
        result = await connection.execute("DELETE FROM site_changelog WHERE id=%s", (entry_id,))
        if result.rowcount != 1:
            raise HTTPException(404, "Update not found.")
    return {"ok": True}
