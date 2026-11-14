"""Exploration page and API."""

from fastapi import APIRouter, Cookie, Request
from fastapi.logger import logger
from fastapi.responses import HTMLResponse, JSONResponse

from shared.hoyolab.account_client import get_account_client
from shared.storage.database import get_accounts
from website.server.core.account_access import find_account_by_id
from website.server.core.auth import get_web_session, verification_redirect
from website.server.core.templating import templates

router = APIRouter()


@router.get("/exploration", response_class=HTMLResponse)
async def exploration_page(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    session = await get_web_session(cyrene_session)
    if session is None:
        return verification_redirect("/exploration")
    accounts = await get_accounts(session.user_id)
    selected = find_account_by_id(accounts, account_id)
    if selected is None and accounts:
        selected = accounts[0]
    return templates.TemplateResponse(
        request=request,
        name="exploration.html",
        context={"request": request, "accounts": accounts, "selected_account": selected},
    )


@router.get("/api/exploration")
async def exploration_data(account_id: int, cyrene_session: str | None = Cookie(default=None)):
    session = await get_web_session(cyrene_session)
    if session is None:
        return JSONResponse(status_code=401, content={"error": "Your session has expired."})
    accounts = await get_accounts(session.user_id)
    selected = find_account_by_id(accounts, account_id)
    if selected is None:
        return JSONResponse(
            status_code=404, content={"error": "The selected account was not found."}
        )
    try:
        client = await get_account_client(session.user_id, selected["genshin_uid"])
        if client is None:
            return JSONResponse(
                status_code=404, content={"error": "Unable to load the selected account."}
            )
        async with client:
            data = await client.get_genshin_exploration()
    except Exception:
        logger.exception("Failed to retrieve exploration for account %s", selected["id"])
        return JSONResponse(
            status_code=502,
            content={
                "error": "Couldn't retrieve exploration from HoYoLAB. Check your account connection and battle chronicle privacy settings."
            },
        )
    return {
        "account_id": selected["id"],
        "regions": data.get("world_explorations", []),
        "stats": data.get("stats", {}),
    }
