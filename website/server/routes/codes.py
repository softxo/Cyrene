"""Gift code pages and the redeem, automatic claiming and daily check-in APIs."""

import asyncio
import logging

import aiohttp
from fastapi import APIRouter, Cookie, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

from shared.hoyolab.account_client import get_account_client
from shared.storage.database import (
    get_accounts,
    get_daily_checkin_settings,
    get_gift_code_redemptions,
    get_gift_code_settings,
    reserve_gift_code_redemption,
    set_daily_checkin_enabled,
    set_gift_code_auto_claim,
    update_gift_code_redemption,
)
from shared.workers.daily_checkin_worker import request_daily_checkin
from shared.workers.gift_code_worker import request_gift_code_check
from website.server.core.account_access import find_account_by_id
from website.server.core.auth import get_authenticated_user, get_web_session, verification_redirect
from website.server.core.templating import templates

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/codes", response_class=HTMLResponse)
async def codes_page(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    session = await get_web_session(cyrene_session)

    if session is None:
        return verification_redirect("/codes")

    accounts = await get_accounts(session.user_id)
    codes_accounts = [
        {
            "id": account["id"],
            "genshin_uid": account["genshin_uid"],
            "nickname": (
                account.get("cyrene_nickname") or account.get("nickname") or account["genshin_uid"]
            ),
            "genshin_server": account["genshin_server"],
        }
        for account in accounts
    ]

    return templates.TemplateResponse(
        request=request,
        name="codes.html",
        context={
            "request": request,
            "accounts": codes_accounts,
        },
    )


@router.get("/api/codes")
async def get_genshin_codes(
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    user_id = await get_authenticated_user(cyrene_session)
    accounts = await get_accounts(user_id)

    if not accounts:
        return {
            "codes": [],
            "auto_claim_enabled": False,
        }

    if account_id is None:
        account = accounts[0]
    else:
        account = find_account_by_id(accounts, account_id)

        if account is None:
            raise HTTPException(
                status_code=404,
                detail="The selected Genshin account was not found.",
            )

    selected_account_id = account["id"]
    settings = await get_gift_code_settings(selected_account_id)
    checkin_settings = await get_daily_checkin_settings(selected_account_id)
    redemptions = await get_gift_code_redemptions(selected_account_id)
    url = "https://hoyo-codes.seria.moe/codes?game=genshin"

    try:
        timeout = aiohttp.ClientTimeout(total=15)

        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as response:
                if response.status != 200:
                    raise HTTPException(
                        status_code=502,
                        detail=("The gift-code service is temporarily unavailable."),
                    )

                data = await response.json(content_type=None)

        if not isinstance(data, dict) or not isinstance(data.get("codes"), list):
            raise HTTPException(
                status_code=502,
                detail=("The gift-code service returned an unexpected response."),
            )

        codes = []

        for item in data["codes"]:
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("code"), str)
                or item.get("status") != "OK"
            ):
                continue

            code = item["code"].strip()
            saved = redemptions.get(code.upper(), {})

            codes.append(
                {
                    "code": code,
                    "rewards": item.get(
                        "rewards",
                        "Rewards not listed",
                    ),
                    "status": item.get("status", "UNKNOWN"),
                    "redemption_status": saved.get("status"),
                    "redemption_message": saved.get("message"),
                }
            )

        return {
            "codes": codes,
            "auto_claim_enabled": settings["auto_claim_enabled"],
            "auto_checkin_enabled": checkin_settings["auto_checkin_enabled"],
            "checkin_last_claimed_date": checkin_settings["last_claimed_date"],
            "checkin_last_status": checkin_settings["last_status"],
            "checkin_last_message": checkin_settings["last_message"],
        }

    except HTTPException:
        raise
    except (
        aiohttp.ClientError,
        asyncio.TimeoutError,
        ValueError,
    ) as exc:
        raise HTTPException(
            status_code=502,
            detail=("Unable to retrieve gift codes. Please try again later."),
        ) from exc


@router.post("/api/codes/redeem")
async def redeem_genshin_code(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        payload = await request.json()
    except ValueError, UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Invalid request body.",
        )

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=400,
            detail="Invalid request body.",
        )

    code = payload.get("code")
    account_id = payload.get("account_id")

    if not isinstance(code, str) or not code.strip():
        raise HTTPException(
            status_code=400,
            detail="A gift code is required.",
        )

    try:
        account_id = int(account_id)
    except TypeError, ValueError:
        raise HTTPException(
            status_code=400,
            detail="Select a valid Genshin account.",
        )

    accounts = await get_accounts(user_id)
    account = find_account_by_id(accounts, account_id)

    if account is None:
        raise HTTPException(
            status_code=404,
            detail="The selected Genshin account was not found.",
        )

    client = await get_account_client(
        user_id,
        account["genshin_uid"],
    )

    if client is None:
        raise HTTPException(
            status_code=404,
            detail="Could not load the selected Genshin account.",
        )

    normalised_code = code.strip().upper()

    if not await reserve_gift_code_redemption(account_id, normalised_code, automatic=False):
        return JSONResponse(
            status_code=409,
            content={
                "success": False,
                "code": normalised_code,
                "message": "This code has already been submitted or a redemption is in progress for this UID.",
            },
        )

    try:
        async with client:
            await client.redeem_genshin_code(code.strip())

        await update_gift_code_redemption(
            account_id=account_id,
            genshin_uid=account["genshin_uid"],
            code=normalised_code,
            status="submitted",
            message="The redemption request completed successfully.",
        )

        return {
            "success": True,
            "code": code.strip(),
            "status": "submitted",
            "message": "The redemption request completed successfully.",
        }

    except Exception:
        logger.exception(
            "Gift-code redemption failed for account %s, code %s.", account_id, normalised_code
        )

        message = (
            "Redemption failed. The code may be expired, "
            "already claimed, unavailable for this region, "
            "or the account may need to be reconnected."
        )

        await update_gift_code_redemption(
            account_id=account_id,
            genshin_uid=account["genshin_uid"],
            code=normalised_code,
            status="failed",
            message=message,
        )

        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "code": code.strip(),
                "status": "failed",
                "message": message,
            },
        )


@router.post("/api/codes/automatic")
async def update_automatic_gift_code_claiming(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        payload = await request.json()
    except ValueError, UnicodeDecodeError:
        raise HTTPException(
            status_code=400,
            detail="Invalid request body.",
        )

    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=400,
            detail="Invalid request body.",
        )

    account_id = payload.get("account_id")
    enabled = payload.get("enabled")

    if not isinstance(enabled, bool):
        raise HTTPException(
            status_code=400,
            detail="A valid enabled setting is required.",
        )

    try:
        account_id = int(account_id)
    except TypeError, ValueError:
        raise HTTPException(
            status_code=400,
            detail="Select a valid Genshin account.",
        )

    accounts = await get_accounts(user_id)
    account = find_account_by_id(accounts, account_id)

    if account is None:
        raise HTTPException(
            status_code=404,
            detail="The selected Genshin account was not found.",
        )

    await set_gift_code_auto_claim(
        account_id=account_id,
        enabled=enabled,
    )

    if enabled:
        request_gift_code_check()

    return {
        "success": True,
        "auto_claim_enabled": enabled,
    }


@router.post("/api/codes/daily-checkin")
async def set_daily_checkin(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user = await get_authenticated_user(cyrene_session)

    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
        )

    payload = await request.json()

    try:
        account_id = int(payload.get("account_id"))
    except TypeError, ValueError:
        raise HTTPException(
            status_code=400,
            detail="A valid account ID is required.",
        )

    enabled = payload.get("enabled")

    if not isinstance(enabled, bool):
        raise HTTPException(
            status_code=400,
            detail="The enabled value must be a boolean.",
        )

    accounts = await get_accounts(user)
    account = next(
        (item for item in accounts if int(item["id"]) == account_id),
        None,
    )

    if account is None:
        raise HTTPException(
            status_code=404,
            detail="Genshin account not found.",
        )

    await set_daily_checkin_enabled(
        account_id,
        enabled,
    )

    if enabled:
        request_daily_checkin()

    return {
        "success": True,
        "auto_checkin_enabled": enabled,
    }
