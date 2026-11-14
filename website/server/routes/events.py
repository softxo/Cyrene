"""Events pages and the activity check and daily events APIs."""

from fastapi import APIRouter, Cookie, Request
from fastapi.responses import HTMLResponse, JSONResponse

from shared.storage.database import get_accounts, set_event_activity_check
from website.server.core.auth import get_authenticated_user, get_web_session, verification_redirect
from website.server.core.templating import templates
from website.server.events.events_data import (
    _events_cache,
    get_event_activity_period_keys,
    get_events_data,
)
from website.server.events.limited_event_checks import valid_completion_token

router = APIRouter()


@router.get("/events", response_class=HTMLResponse)
async def events_page(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
    overview: bool = False,
):
    session = await get_web_session(cyrene_session)

    if session is None:
        return verification_redirect("/events")

    user_id = session.user_id
    events_data = await get_events_data(
        user_id,
        account_id,
        overview,
    )

    return templates.TemplateResponse(
        request=request,
        name="events.html",
        context={
            "request": request,
            **events_data,
        },
    )


@router.get("/events/refresh", response_class=HTMLResponse)
async def refresh_events(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
    overview: bool = False,
    tab: str = "all",
):
    session = await get_web_session(cyrene_session)

    if session is None:
        return HTMLResponse("", 401)

    user_id = session.user_id
    events_data = await get_events_data(
        user_id,
        account_id,
        overview,
    )

    return templates.TemplateResponse(
        request=request,
        name="events.html",
        context={
            "request": request,
            **events_data,
            "tab": tab,
        },
    )


@router.post("/api/events/activity-check")
async def update_event_activity_check(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    if user_id is None:
        return JSONResponse(
            {
                "success": False,
                "error": "Not authenticated.",
            },
            status_code=401,
        )

    try:
        data = await request.json()
    except ValueError:
        return JSONResponse(
            {
                "success": False,
                "error": "Invalid request.",
            },
            status_code=400,
        )

    account_id = data.get("account_id")
    activity_type = data.get("activity_type")
    checked = data.get("checked")

    if account_id is None:
        return JSONResponse(
            {
                "success": False,
                "error": "Missing account ID.",
            },
            status_code=400,
        )

    if activity_type not in {
        "temper_thyself",
        "daily_commissions",
        "trounce_domains",
        "limited_event",
    }:
        return JSONResponse(
            {
                "success": False,
                "error": "Invalid activity type.",
            },
            status_code=400,
        )

    if not isinstance(checked, bool):
        return JSONResponse(
            {
                "success": False,
                "error": "Invalid checkmark state.",
            },
            status_code=400,
        )

    try:
        account_id = int(account_id)
    except TypeError, ValueError:
        return JSONResponse(
            {
                "success": False,
                "error": "Invalid account ID.",
            },
            status_code=400,
        )

    accounts = await get_accounts(user_id)
    account = next(
        (account for account in accounts if int(account["id"]) == account_id),
        None,
    )

    if account is None:
        return JSONResponse(
            {
                "success": False,
                "error": "Account not found.",
            },
            status_code=404,
        )

    daily_period_key, weekly_period_key = get_event_activity_period_keys(account["genshin_server"])
    period_key = daily_period_key if activity_type == "daily_commissions" else weekly_period_key

    if activity_type == "limited_event":
        period_key = data.get("event_key")
        if not valid_completion_token(
            data.get("event_token"), user_id, account["genshin_uid"], period_key
        ):
            return JSONResponse(
                {"success": False, "error": "Event not found for this account."}, status_code=404
            )

    await set_event_activity_check(
        user_id,
        account["genshin_uid"],
        activity_type,
        period_key,
        checked,
    )

    for key in list(_events_cache):
        if key[2] == account["genshin_uid"]:
            _events_cache.pop(key, None)

    return JSONResponse(
        {
            "success": True,
            "checked": checked,
            "activity_type": activity_type,
            "period_key": period_key,
        }
    )
