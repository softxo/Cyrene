"""Home and settings pages."""

from fastapi import APIRouter, Cookie, Request
from fastapi.responses import HTMLResponse

from shared.storage.account_limits import SPECIAL_USER_IDS
from website.server.core.auth import get_web_session
from website.server.core.templating import templates

router = APIRouter()


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="home.html",
        context={
            "request": request,
        },
    )


@router.get("/settings", response_class=HTMLResponse)
async def settings(request: Request, cyrene_session: str | None = Cookie(default=None)):
    session = await get_web_session(cyrene_session)
    return templates.TemplateResponse(
        request=request,
        name="settings.html",
        context={
            "request": request,
            "is_special": bool(session and session.user_id in SPECIAL_USER_IDS),
        },
    )
