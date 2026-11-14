"""Inventory page and API."""

from fastapi import APIRouter, Cookie, Request
from fastapi.logger import logger
from fastapi.responses import HTMLResponse, JSONResponse

from shared.storage.database import get_accounts
from website.server.core.account_access import find_account_by_id
from website.server.core.auth import get_web_session, verification_redirect
from website.server.core.templating import templates
from website.server.events.events_data import get_cached_inventory

router = APIRouter()


@router.get(
    "/inventory",
    response_class=HTMLResponse,
)
async def inventory_page(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    session = await get_web_session(cyrene_session)

    if session is None:
        return verification_redirect("/inventory")

    user_id = session.user_id
    accounts = await get_accounts(user_id)
    selected_account = find_account_by_id(accounts, account_id) if account_id is not None else None

    if selected_account is None and accounts:
        selected_account = accounts[0]

    return templates.TemplateResponse(
        request=request,
        name="inventory.html",
        context={
            "request": request,
            "accounts": accounts,
            "selected_account": selected_account,
        },
    )


@router.get("/api/inventory")
async def inventory_data(
    account_id: int,
    cyrene_session: str | None = Cookie(default=None),
):
    """Return HoYoLAB inventory data for one linked account."""
    session = await get_web_session(cyrene_session)

    if session is None:
        return JSONResponse(
            status_code=401,
            content={"error": "Your session has expired."},
        )

    accounts = await get_accounts(session.user_id)
    selected_account = find_account_by_id(accounts, account_id)

    if selected_account is None:
        return JSONResponse(
            status_code=404,
            content={"error": "The selected account was not found."},
        )

    try:
        inventory = await get_cached_inventory(
            session.user_id,
            selected_account,
        )
    except RuntimeError:
        return JSONResponse(
            status_code=404,
            content={"error": "Unable to load the selected account."},
        )
    except Exception:
        logger.exception(
            "Failed to retrieve inventory for account %s",
            selected_account["id"],
        )
        return JSONResponse(
            status_code=502,
            content={"error": "Couldn't retrieve inventory from HoYoLAB."},
        )

    return {
        "account_id": selected_account["id"],
        "inventory": inventory,
    }
