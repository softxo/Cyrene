import typing
import asyncio
import aiohttp
import time
import tempfile
import re
import uuid
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from datetime import (
    datetime,
    timedelta,
    timezone
)
from pathlib import Path
from fastapi import (
    Cookie, 
    logger,
    FastAPI,
    HTTPException,
    Request,
    File,
    UploadFile,
)
from fastapi.responses import (
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
)
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from genshin.models.auth.geetest import (
    SessionMMTv4,
    SessionMMTResult,
    SessionMMTv4Result,
)
from utils.web.sessions import (
    get_challenge_session,
    complete_challenge,
)
from utils.web.auth import (
    create_verification,
    get_verification,
    create_web_session,
    get_web_session,
    delete_web_session,
)
from utils.hoyolab.database import (
    save_account,
    get_account,
    get_account_count,
    delete_account,
    update_account_nickname,
    get_accounts,
    get_reminders,
    get_reminder,
    create_reminder,
    update_reminder,
    delete_reminder,
    get_gift_code_settings,
    set_gift_code_auto_claim,
    get_gift_code_redemptions,
    update_gift_code_redemption,
    update_achievement_tier,
    get_event_activity_checks,
    set_event_activity_check,
    create_custom_event,
    get_custom_events,
    get_custom_event,
    update_custom_event,
    delete_custom_event,
    set_custom_event_completion,
    get_custom_event_completions,
    get_daily_checkin_settings,
    set_daily_checkin_enabled,
    change_custom_event_account_progress,
    get_custom_event_account_progress,
    reorder_custom_events,
    get_visible_custom_event,
    get_character_plans,
    replace_character_plans,
    get_wish_history,
    import_wish_history,
)
from utils.hoyolab.login import login_with_password
from utils.hoyolab.accounts import get_genshin_accounts
from utils.hoyolab.account_limits import get_account_limit
from utils.hoyolab.errors import (
    HoYoLABAuthenticationError,
    HoYoLABAccountNotFoundError,
    HoYoLABAccountLockedError,
    HoYoLABAccountMutedError,
    HoYoLABVerificationError,
    HoYoLABCaptchaError,
    HoYoLABRateLimitError,
    HoYoLABError,
)
from utils.hoyolab.account_client import get_account_client
from utils.hoyolab.daily_note import get_resin
from utils.achievements.achievements import load_achievements
from utils.achievements.progress import load_progress
from utils.achievements.importer import import_achievements
from collections import Counter
from utils.changing_variables.config import IT_ELEMENTS
from utils.hoyolab.gift_code_worker import request_gift_code_check
from utils.hoyolab.daily_checkin_worker import request_daily_checkin
from genshin.models.genshin.constants import CHARACTER_NAMES
from utils.web.planner_costs import calculate_planner_costs
from utils.genshin_db import GenshinDB, GenshinDBError



app = FastAPI(
    title="Cyrene Authentication",
    docs_url=None,
    redoc_url=None,
)

BASE_DIR = Path(__file__).resolve().parents[2]

templates = Jinja2Templates(
    directory=BASE_DIR / "website" / "templates"
)

app.mount(
    "/static",
    StaticFiles(
        directory=BASE_DIR / "website" / "static"
    ),
    name="static",
)


GT_V3_URL = "https://static.geetest.com/static/js/gt.0.5.0.js"



@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="home.html",
        context={
            "request": request,
        },
    )


@app.get("/settings", response_class=HTMLResponse)
async def settings(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="settings.html",
        context={
            "request": request,
        },
    )

@app.get(
    "/verify",
    response_class=HTMLResponse,
)
async def verify_page(
    request: Request,
    next: str | None = None,
):
    if next and (
        not next.startswith("/")
        or next.startswith("//")
    ):
        next = None

    return templates.TemplateResponse(
        request=request,
        name="verification.html",
        context={
            "request": request,
            "next": next,
        },
    )


@app.post("/api/verify/create")
async def create_web_verification():

    verification = create_verification()

    return {
        "success": True,
        "token": verification.token,
        "code": verification.code,
        "expires_in": 300,
    }


@app.get("/api/verify/status")
async def verification_status(
    token: str
):
    verification = get_verification(token)

    if verification is None:
        raise HTTPException(
            status_code=404,
            detail="Verification request expired.",
        )

    if verification.user_id is None:
        return {
            "verified": False,
        }

    session = await create_web_session(
        verification.user_id
    )

    response = JSONResponse(
        content={
            "verified": True,
        }
    )

    response.set_cookie(
        key="cyrene_session",
        value=session.token,
        max_age=30 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="lax",
    )

    return response


@app.post("/api/auth/logout")
async def logout(
    cyrene_session: str | None = Cookie(
        default=None
    )
):
    if cyrene_session:
        await delete_web_session(
            cyrene_session
        )

    response = JSONResponse(
        content={
            "success": True,
        }
    )

    response.delete_cookie(
        key="cyrene_session"
    )

    return response


@app.get("/api/auth/status")
async def auth_status(
    cyrene_session: str | None = Cookie(
        default=None
    )
):
    session = await get_web_session(
        cyrene_session
    )

    if session is None:
        return {
            "authenticated": False,
        }

    return {
        "authenticated": True,
        "user_id": session.user_id,
    }


async def get_authenticated_user(
    cyrene_session: str | None
) -> int:

    session = await get_web_session(
        cyrene_session
    )

    if session is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required."
        )

    return session.user_id


ACCOUNT_LINK_TIMEOUT = 15 * 60
_account_link_attempts: dict[str, dict[str, typing.Any]] = {}
_account_link_tasks: set[asyncio.Task] = set()


def _cleanup_account_link_attempts() -> None:
    cutoff = time.time() - ACCOUNT_LINK_TIMEOUT

    for token, attempt in list(_account_link_attempts.items()):
        if attempt["created_at"] < cutoff:
            _account_link_attempts.pop(token, None)


def _account_link_error(error: Exception) -> str:
    if isinstance(error, HoYoLABAccountNotFoundError):
        return "The HoYoLAB account could not be found."
    if isinstance(error, HoYoLABAuthenticationError):
        return "The HoYoLAB email, username, or password is incorrect."
    if isinstance(error, HoYoLABAccountLockedError):
        return "This HoYoLAB account is currently locked."
    if isinstance(error, HoYoLABAccountMutedError):
        return "This HoYoLAB account is currently restricted."
    if isinstance(error, HoYoLABVerificationError):
        return "HoYoLAB verification could not be completed. Please try again."
    if isinstance(error, HoYoLABCaptchaError):
        return "The CAPTCHA could not be completed. Please try again."
    if isinstance(error, HoYoLABRateLimitError):
        return "HoYoLAB is temporarily rate-limiting requests. Please try again later."
    return "Cyrene could not connect to HoYoLAB. Please try again."


async def _run_web_account_login(
    token: str,
    account: str,
    password: str,
) -> None:
    attempt = _account_link_attempts[token]

    async def notify(challenge_url: str) -> None:
        attempt["status"] = "captcha"
        attempt["challenge_url"] = challenge_url

    try:
        client, credentials = await login_with_password(
            account,
            password,
            user_id=attempt["user_id"],
            notify=notify,
        )

        accounts = await get_genshin_accounts(client)

        if not accounts:
            attempt["status"] = "error"
            attempt["error"] = (
                "No Genshin accounts are linked to this HoYoLAB account."
            )
            return

        attempt["credentials"] = credentials
        attempt["accounts"] = accounts
        attempt["status"] = "select"

    except HoYoLABError as error:
        attempt["status"] = "error"
        attempt["error"] = _account_link_error(error)

    except Exception as error:
        print("===== WEB ACCOUNT LINK ERROR =====")
        print(f"Type: {type(error).__name__}")
        print(f"Error: {error}")
        print("==================================")

        attempt["status"] = "error"
        attempt["error"] = _account_link_error(error)


@app.post("/api/hoyolab/link/start")
async def start_hoyolab_link(
    data: dict[str, typing.Any],
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    account = str(data.get("account") or "").strip()
    password = str(data.get("password") or "")

    if not account or not password:
        raise HTTPException(
            status_code=400,
            detail="Enter your HoYoLAB email or username and password.",
        )

    _cleanup_account_link_attempts()
    token = uuid.uuid4().hex
    _account_link_attempts[token] = {
        "user_id": user_id,
        "created_at": time.time(),
        "status": "authenticating",
        "challenge_url": None,
        "accounts": None,
        "credentials": None,
        "error": None,
    }

    task = asyncio.create_task(
        _run_web_account_login(token, account, password)
    )
    _account_link_tasks.add(task)
    task.add_done_callback(_account_link_tasks.discard)

    return {"success": True, "token": token}


@app.get("/api/hoyolab/accounts")
async def web_hoyolab_accounts(
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    accounts = await get_accounts(user_id)

    return {
        "accounts": [
            {
                "uid": account["genshin_uid"],
                "nickname": account["nickname"],
                "cyrene_nickname": account["cyrene_nickname"],
                "level": account["level"],
                "server": account["genshin_server"],
            }
            for account in accounts
        ],
    }


@app.patch("/api/hoyolab/accounts/{uid}")
async def rename_web_hoyolab_account(
    uid: str,
    data: dict[str, typing.Any],
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    nickname = str(data.get("nickname") or "").strip()

    if len(nickname) > 50:
        raise HTTPException(
            status_code=400,
            detail="Account names must be 50 characters or fewer.",
        )

    updated = await update_account_nickname(
        user_id,
        uid,
        nickname or None,
    )

    if not updated:
        raise HTTPException(status_code=404, detail="Account not found.")

    return {"success": True, "nickname": nickname or None}


@app.delete("/api/hoyolab/accounts/{uid}")
async def delete_web_hoyolab_account(
    uid: str,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    deleted = await delete_account(user_id, uid)

    if not deleted:
        raise HTTPException(status_code=404, detail="Account not found.")

    return {"success": True}


def _get_account_link_attempt(token: str, user_id: int) -> dict:
    _cleanup_account_link_attempts()
    attempt = _account_link_attempts.get(token)

    if attempt is None or attempt["user_id"] != user_id:
        raise HTTPException(
            status_code=404,
            detail="This account-linking attempt has expired.",
        )

    return attempt


@app.get("/api/hoyolab/link/status")
async def hoyolab_link_status(
    token: str,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    attempt = _get_account_link_attempt(token, user_id)

    response = {"status": attempt["status"]}

    if attempt["status"] == "captcha":
        response["challenge_url"] = attempt["challenge_url"]
    elif attempt["status"] == "select":
        response["accounts"] = attempt["accounts"]
    elif attempt["status"] == "error":
        response["error"] = attempt["error"]

    return response


@app.post("/api/hoyolab/link/complete")
async def complete_hoyolab_link(
    data: dict[str, typing.Any],
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    token = str(data.get("token") or "")
    selected_uid = str(data.get("uid") or "")
    attempt = _get_account_link_attempt(token, user_id)

    if attempt["status"] != "select":
        raise HTTPException(
            status_code=409,
            detail="The HoYoLAB login is not ready for account selection.",
        )

    account = next(
        (
            item for item in attempt["accounts"]
            if item["game_uid"] == selected_uid
        ),
        None,
    )

    if account is None:
        raise HTTPException(status_code=400, detail="Select a valid account.")

    existing_account = await get_account(user_id, selected_uid)
    account_count = await get_account_count(user_id)
    account_limit = get_account_limit(user_id)

    if (
        existing_account is None
        and account_limit is not None
        and account_count >= account_limit
    ):
        raise HTTPException(
            status_code=409,
            detail=f"You have reached your limit of {account_limit} linked accounts.",
        )

    await save_account(
        user_id,
        attempt["credentials"],
        discord_username=(
            existing_account["discord_username"]
            if existing_account else None
        ),
        discord_display_name=(
            existing_account["discord_display_name"]
            if existing_account else None
        ),
        discord_guild_id=(
            existing_account["discord_guild_id"]
            if existing_account else None
        ),
        discord_guild_name=(
            existing_account["discord_guild_name"]
            if existing_account else None
        ),
        genshin_uid=account["game_uid"],
        genshin_server=account["region"],
        nickname=account["nickname"],
        cyrene_nickname=(
            existing_account["cyrene_nickname"]
            if existing_account else None
        ),
        level=account["level"],
    )

    _account_link_attempts.pop(token, None)

    return {
        "success": True,
        "account": account,
        "reconnected": existing_account is not None,
    }


@app.get(
    "/planner",
    response_class=HTMLResponse,
)
async def planner(
    request: Request,
    cyrene_session: str | None = Cookie(default=None)
):
    session = await get_web_session(
        cyrene_session
    )

    if session is None:
        return RedirectResponse(
            url="/verify?next=/planner",
            status_code=303,
        )

    return templates.TemplateResponse(
        request=request,
        name="planner.html",
        context={
            "request": request,
        },
    )


@app.get("/api/planner")
async def planner_data(
    cyrene_session: str | None = Cookie(default=None)
):
    user_id = await get_authenticated_user(
        cyrene_session
    )

    accounts, reminders = await asyncio.gather(
        get_accounts(user_id),
        get_reminders(user_id),
    )

    async def load_planner_account(account):
        client = await get_account_client(
            user_id,
            account["genshin_uid"]
        )

        if client is None:
            return None

        try:
            async with client:
                response = await client.get_genshin_daily_note(
                    client.genshin_uid,
                    client.genshin_server
                )

            current_resin, max_resin, recovery = get_resin(
                response
            )

        except Exception as error:
            print("===== WEBSITE PLANNER RESIN ERROR =====")
            print(type(error).__name__)
            print(error)
            print("========================================")

            return None

        replenished_at = None
        full_resin_at = None

        if current_resin < max_resin:

            remaining_resin = max_resin - current_resin

            replenished_at = (
                    int(time.time())
                    + recovery
            )

            full_resin_at = (
                    int(time.time())
                    + recovery
                    + ((remaining_resin - 1) * 480)
            )

        return {
            "genshin_uid": account["genshin_uid"],
            "nickname": account.get("nickname"),
            "level": account.get("level"),
            "genshin_server": account["genshin_server"],
            "current_resin": current_resin,
            "max_resin": max_resin,
            "replenished_at": replenished_at,
            "full_resin_at": full_resin_at,
        }

    loaded_accounts = await asyncio.gather(*(
        load_planner_account(account)
        for account in accounts
    ))
    planner_accounts = [
        account
        for account in loaded_accounts
        if account is not None
    ]

    planner_reminders = []

    for reminder in reminders:

        if not reminder.get("enabled"):
            continue

        config = reminder.get("config") or {}

        account = next(
            (
                account
                for account in accounts
                if account["genshin_uid"]
                   == reminder["genshin_uid"]
            ),
            None,
        )

        planner_reminders.append(
            {
                "id": reminder["id"],
                "account_nickname": (
                    account.get("nickname")
                    if account
                    else None
                ),
                "type": reminder["reminder_type"],
                "mode": reminder["reminder_mode"],
                "genshin_uid": reminder["genshin_uid"],
                "config": config,
            }
        )

    return {
        "accounts": planner_accounts,
        "reminders": planner_reminders,
    }


@app.post("/api/planner/reminders")
async def create_planner_reminder(
    data: dict,
    cyrene_session: str | None = Cookie(default=None)
):
    user_id = await get_authenticated_user(
        cyrene_session
    )

    reminder_type = data.get("type")
    reminder_mode = data.get("mode", "automatic")
    genshin_uid = data.get("genshin_uid")
    config = data.get("config") or {}
    delivery_type = data.get("delivery_type", "dm")

    valid_types = {
        "resin",
        "expedition",
        "teapot",
        "transformer",
        "custom",
    }

    valid_modes = {
        "automatic",
        "manual",
    }

    valid_delivery_types = {
        "dm",
    }

    if reminder_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail="Invalid reminder type."
        )

    if reminder_mode not in valid_modes:
        raise HTTPException(
            status_code=400,
            detail="Invalid reminder mode."
        )

    if delivery_type not in valid_delivery_types:
        raise HTTPException(
            status_code=400,
            detail="Invalid delivery type."
        )

    if not isinstance(config, dict):
        raise HTTPException(
            status_code=400,
            detail="Invalid reminder configuration."
        )

    accounts = await get_accounts(
        user_id
    )

    if not accounts:
        raise HTTPException(
            status_code=404,
            detail="No Genshin account linked."
        )

    if not genshin_uid:
        raise HTTPException(
            status_code=400,
            detail="A Genshin account is required."
        )

    account = next(
        (
            account
            for account in accounts
            if account["genshin_uid"] == genshin_uid
        ),
        None,
    )

    if account is None:
        raise HTTPException(
            status_code=400,
            detail="Invalid Genshin account."
        )

    # --------------------------------
    # Resin validation
    # --------------------------------

    if reminder_type == "resin":

        amount = config.get("amount")

        try:
            amount = int(amount)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail="Invalid Resin amount."
            )

        if not 1 <= amount <= 200:
            raise HTTPException(
                status_code=400,
                detail="Resin must be between 1 and 200."
            )

        config["amount"] = amount

    # --------------------------------
    # Automatic reminder restrictions
    # --------------------------------

    if reminder_mode == "automatic":

        if reminder_type == "custom":
            raise HTTPException(
                status_code=400,
                detail="Custom reminders cannot use automatic mode."
            )

    reminder_id = await create_reminder(
        discord_user_id=user_id,
        reminder_type=reminder_type,
        genshin_uid=genshin_uid,
        config=config,
        delivery_type=delivery_type,
        reminder_mode=reminder_mode,
        next_trigger_at=datetime.now(timezone.utc),
    )

    return {
        "success": True,
        "id": reminder_id,
    }


@app.patch("/api/planner/reminders/{reminder_id}")
async def update_planner_reminder(
    reminder_id: int,
    data: dict,
    cyrene_session: str | None = Cookie(default=None)
):
    user_id = await get_authenticated_user(
        cyrene_session
    )

    reminder = await get_reminder(
        user_id,
        reminder_id
    )

    if reminder is None:
        raise HTTPException(
            status_code=404,
            detail="Reminder not found."
        )

    enabled = data.get("enabled")
    config = data.get("config")

    if enabled is not None:
        if not isinstance(enabled, bool):
            raise HTTPException(
                status_code=400,
                detail="Invalid enabled value."
            )

    if config is not None:
        if not isinstance(config, dict):
            raise HTTPException(
                status_code=400,
                detail="Invalid reminder configuration."
            )

        if reminder["reminder_type"] == "resin":

            amount = config.get("amount")

            if amount is not None:

                try:
                    amount = int(amount)
                except (TypeError, ValueError):
                    raise HTTPException(
                        status_code=400,
                        detail="Invalid Resin amount."
                    )

                if not 1 <= amount <= 200:
                    raise HTTPException(
                        status_code=400,
                        detail="Resin must be between 1 and 200."
                    )

                config["amount"] = amount

    updated = await update_reminder(
        discord_user_id=user_id,
        reminder_id=reminder_id,
        enabled=enabled,
        config=config,
    )

    if not updated:
        raise HTTPException(
            status_code=400,
            detail="Nothing to update."
        )

    return {
        "success": True,
    }


@app.delete("/api/planner/reminders/{reminder_id}")
async def delete_planner_reminder(
    reminder_id: int,
    cyrene_session: str | None = Cookie(default=None)
):
    user_id = await get_authenticated_user(
        cyrene_session
    )

    deleted = await delete_reminder(
        user_id,
        reminder_id
    )

    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="Reminder not found."
        )

    return {
        "success": True,
    }
    

@app.get("/codes", response_class=HTMLResponse)
async def codes_page(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    session = await get_web_session(cyrene_session)

    if session is None:
        return RedirectResponse(
            url="/verify?next=/codes",
            status_code=303,
        )

    accounts = await get_accounts(session.user_id)

    codes_accounts = [
        {
            "id": account["id"],
            "genshin_uid": account["genshin_uid"],
            "nickname": (
                account.get("cyrene_nickname")
                or account.get("nickname")
                or account["genshin_uid"]
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
    

@app.get("/api/codes")
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

    # Default to the first connected account.
    if account_id is None:
        account = accounts[0]
    else:
        account = next(
            (
                item for item in accounts
                if item["id"] == account_id
            ),
            None,
        )

        if account is None:
            raise HTTPException(
                status_code=404,
                detail="The selected Genshin account was not found.",
            )

    selected_account_id = account["id"]

    settings = await get_gift_code_settings(
        selected_account_id
    )
    checkin_settings = await get_daily_checkin_settings(
        selected_account_id
    )
    redemptions = await get_gift_code_redemptions(
        selected_account_id
    )

    url = "https://hoyo-codes.seria.moe/codes?game=genshin"

    try:
        timeout = aiohttp.ClientTimeout(total=15)

        async with aiohttp.ClientSession(
            timeout=timeout
        ) as session:
            async with session.get(url) as response:
                if response.status != 200:
                    raise HTTPException(
                        status_code=502,
                        detail=(
                            "The gift-code service is temporarily "
                            "unavailable."
                        ),
                    )

                data = await response.json(content_type=None)

        if (
            not isinstance(data, dict)
            or not isinstance(data.get("codes"), list)
        ):
            raise HTTPException(
                status_code=502,
                detail=(
                    "The gift-code service returned an "
                    "unexpected response."
                ),
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

            codes.append({
                "code": code,
                "rewards": item.get(
                    "rewards",
                    "Rewards not listed",
                ),
                "status": item.get("status", "UNKNOWN"),
                "redemption_status": saved.get("status"),
                "redemption_message": saved.get("message"),
            })

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
            detail=(
                "Unable to retrieve gift codes. Please try again later."
            ),
        ) from exc


@app.post("/api/codes/redeem")
async def redeem_genshin_code(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        payload = await request.json()
    except (ValueError, UnicodeDecodeError):
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
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Select a valid Genshin account.",
        )

    # Only allow accounts belonging to the authenticated user.
    accounts = await get_accounts(user_id)
    account = next(
        (
            item for item in accounts
            if item["id"] == account_id
        ),
        None,
    )

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

    # Save the attempt before contacting HoYoLAB.
    await update_gift_code_redemption(
        account_id=account_id,
        code=normalised_code,
        status="processing",
        message="Redemption request in progress.",
    )

    try:
        async with client:
            await client.redeem_genshin_code(code.strip())

        await update_gift_code_redemption(
            account_id=account_id,
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

    except Exception as exc:
        print(
            f"Gift-code redemption failed for account "
            f"{account_id}, code {normalised_code}: "
            f"{type(exc).__name__}: {exc}"
        )

        message = (
            "Redemption failed. The code may be expired, "
            "already claimed, unavailable for this region, "
            "or the account may need to be reconnected."
        )

        await update_gift_code_redemption(
            account_id=account_id,
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
        
        
@app.post("/api/codes/automatic")
async def update_automatic_gift_code_claiming(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        payload = await request.json()
    except (ValueError, UnicodeDecodeError):
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
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Select a valid Genshin account.",
        )

    accounts = await get_accounts(user_id)

    account = next(
        (
            item for item in accounts
            if item["id"] == account_id
        ),
        None,
    )

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
    

@app.post("/api/codes/daily-checkin")
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
    except (TypeError, ValueError):
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
        (
            item
            for item in accounts
            if int(item["id"]) == account_id
        ),
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
        
    
def get_event_activity_period_keys(
    genshin_server: str,
) -> tuple[str, str]:
    """
    Return the current Daily Commissions and Trounce Domains period keys for a Genshin server.
    """

    daily_reset = get_daily_reset_timestamp(genshin_server)
    weekly_reset = get_weekly_reset_timestamp(genshin_server)

    # The reset timestamp is the NEXT reset, so subtract one period to get the period that is currently active.
    daily_period_timestamp = daily_reset - 86400
    weekly_period_timestamp = weekly_reset - (7 * 86400)

    daily_period_key = datetime.fromtimestamp(
        daily_period_timestamp,
        tz=timezone.utc,
    ).strftime("%Y-%m-%d")

    weekly_period_key = datetime.fromtimestamp(
        weekly_period_timestamp,
        tz=timezone.utc,
    ).strftime("%G-W%V")

    return daily_period_key, weekly_period_key
    

# =========================================
# EVENTS CACHE
# =========================================

EVENTS_CACHE_TTL = 30

_events_cache = {}

INVENTORY_CACHE_TTL = 300
_inventory_cache = {}


async def get_cached_inventory(user_id: int, account: dict) -> list[dict]:
    """Return a recently fetched inventory, scoped to its linked account."""
    cache_key = (user_id, account["id"], account["genshin_uid"])
    cached = _inventory_cache.get(cache_key)

    if (
        cached
        and time.monotonic() - cached["timestamp"] < INVENTORY_CACHE_TTL
    ):
        return cached["data"]

    client = await get_account_client(user_id, account["genshin_uid"])
    if client is None:
        raise RuntimeError("Unable to load the selected account.")

    async with client:
        inventory = await client.get_genshin_inventory()

    _inventory_cache[cache_key] = {
        "timestamp": time.monotonic(),
        "data": inventory,
    }
    return inventory


async def get_single_account_events(
    user_id: int,
    account: dict,
    include_featured: bool = True,
):
    
    # Keep Overview and full Events data in separate cache entries.
    cache_key = (
        user_id,
        account["id"],
        account["genshin_uid"],
        include_featured,
    )

    cached = _events_cache.get(cache_key)

    if cached:
        cache_age = time.monotonic() - cached["timestamp"]

        if cache_age < EVENTS_CACHE_TTL:
            return cached["data"]

    abyss_data = {
        "has_data": False,
        "max_floor": "—",
        "total_stars": 0,
        "end_time": 0,
        "chambers": [],
    }

    theater_data = {
        "has_data": False,
        "best_round": 0,
        "arcanums": 0,
        "medals": 0,
        "end_time": 0,
        "elements": IT_ELEMENTS,
    }

    stygian_data = {
        "has_data": False,
        "end_time": 0,
        "difficulty": 0,
        "difficulty_icon": "",
        "best_time": 0,
        "bosses": [],
        "dire_prestige": {
            "available": False,
            "active": False,
            "ended": False,
            "progress": 0,
            "max_progress": 0,
        },
    }

    daily_data = {
        "has_data": False,
        "completed": 0,
        "total": 4,
        "claimed_reward": False,
        "handbook_claimed": False,
        "encounter_points": 0,
        "reset_time": 0,
        "manual_checked": None,
    }
    
    resin_data = {
        "has_data": False,
        "current": 0,
        "maximum": 200,
        "next_resin_at": None,
        "full_resin_at": None,
    }

    trounce_data = {
        "has_data": False,
        "remaining": 0,
        "total": 3,
        "reset_time": 0,
        "manual_checked": None,
    }

    wish_banners = []
    limited_events = []

    try:

        client = await get_account_client(
            user_id,
            account["genshin_uid"],
        )

        if client is not None:
            
            async def timed_event_request(name, awaitable):
                started = time.monotonic()

                try:
                    result = await awaitable

                    return result

                except Exception as error:
                    print(
                        f"[Events API] {name} FAILED | "
                        f"UID: {account['genshin_uid']} | "
                        f"Time: {time.monotonic() - started:.2f}s | "
                        f"{type(error).__name__}: {error}"
                    )
                    raise

            async with client:

                requests = [
                    timed_event_request(
                        "Announcements",
                        client.get_genshin_announcements(),
                    ),
                    timed_event_request(
                        "Event Calendar",
                        client.get_genshin_event_calendar(),
                    ),
                    timed_event_request(
                        "Abyss",
                        client.get_genshin_spiral_abyss(),
                    ),
                    timed_event_request(
                        "Notes",
                        client.get_genshin_notes(),
                    ),
                ]

                if include_featured:
                    requests.extend([
                        timed_event_request(
                            "Theater",
                            client.get_imaginarium_theater(),
                        ),
                        timed_event_request(
                            "Stygian",
                            client.get_stygian_onslaught(),
                        ),
                    ])

                results = await asyncio.gather(*requests)

                announcements = results[0]
                event_calendar = results[1]
                abyss = results[2]
                notes = results[3]

                if include_featured:
                    theater = results[4]
                    stygian = results[5]
                    
            
            # =========================================
            # DIRE PRESTIGE / DISTURBANCE OUTBREAK
            # =========================================

            dire_prestige_data = {
                "available": False,
                "active": False,
                "ended": False,
                "progress": 0,
                "max_progress": 0,
            }

            try:
                stygian_calendar_events = [
                    event
                    for event in event_calendar.events
                    if getattr(event, "stygian_detail", None) is not None
                ]

                for event in stygian_calendar_events:
                    dire_prestige_data["available"] = True

                    stygian_detail = getattr(
                        event,
                        "stygian_detail",
                        None,
                    )
                    outbreak = getattr(
                        stygian_detail,
                        "disturbance_outbreak",
                        None,
                    )

                    if outbreak is not None:
                        progress = outbreak.progress
                        max_progress = outbreak.max_progress

                        # A zero maximum indicates that the Outbreak is not active.
                        if max_progress > 0:
                            dire_prestige_data.update({
                                "active": True,
                                "ended": False,
                                "progress": progress,
                                "max_progress": max_progress,
                            })
                        else:
                            dire_prestige_data.update({
                                "active": False,
                                "ended": True,
                                "progress": 0,
                                "max_progress": 0,
                            })

                        break

                # If the Stygian event exists but its Outbreak
                # data is absent, the Outbreak is no longer active.
                if (
                    dire_prestige_data["available"]
                    and not dire_prestige_data["active"]
                ):
                    dire_prestige_data["ended"] = True

            except Exception as error:
                print(
                    f"[Events API] Dire Prestige FAILED | "
                    f"UID: {account['genshin_uid']} | "
                    f"{type(error).__name__}: {error}"
                )

            stygian_data["dire_prestige"] = dire_prestige_data


            # =========================================
            # EVENT WISH BANNERS
            # =========================================

            now_timestamp = int(
                datetime.now(timezone.utc).timestamp()
            )

            # =========================================
            # LIMITED-TIME EVENTS
            # =========================================

            def normalise_event_name(value: str) -> str:
                value = re.sub(r"<[^>]+>", "", value or "")
                return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()

            seen_limited_events = set()
            calendar_events = (
                *event_calendar.events,
                *event_calendar.challenges,
            )

            for calendar_event in calendar_events:
                event_key = (
                    calendar_event.id,
                    normalise_event_name(calendar_event.name),
                )
                if (
                    event_key in seen_limited_events
                    or (
                        calendar_event.end_timestamp > 0
                        and calendar_event.end_timestamp <= now_timestamp
                    )
                    or calendar_event.abyss_detail is not None
                    or calendar_event.theater_detail is not None
                    or getattr(
                        calendar_event,
                        "stygian_detail",
                        None,
                    ) is not None
                ):
                    continue

                seen_limited_events.add(event_key)

                event_name = re.sub(
                    r"<[^>]+>",
                    "",
                    calendar_event.name,
                ).strip()
                normalised_name = normalise_event_name(event_name)
                matching_announcement = next(
                    (
                        announcement
                        for announcement in announcements
                        if normalised_name
                        and (
                            normalised_name in normalise_event_name(
                                announcement.title
                            )
                            or normalised_name in normalise_event_name(
                                announcement.subtitle
                            )
                        )
                    ),
                    None,
                )

                icon = None
                if matching_announcement is not None:
                    icon = (
                        matching_announcement.img
                        or matching_announcement.banner
                    )
                if not icon and calendar_event.rewards:
                    icon = calendar_event.rewards[0].icon

                all_rewards = [
                    {
                        "id": reward.id,
                        "name": reward.name,
                        "icon": reward.icon,
                        "amount": reward.num,
                        "rarity": reward.rarity,
                        "homepage_show": reward.homepage_show,
                    }
                    for reward in calendar_event.rewards
                ]
                is_tcg = any(
                    "lucky coin" in reward["name"].casefold()
                    for reward in all_rewards
                )
                limited_events.append({
                    "id": calendar_event.id,
                    "name": event_name,
                    "description": calendar_event.description,
                    "icon": icon,
                    "is_tcg": is_tcg,
                    "is_finished": calendar_event.is_finished,
                    "is_upcoming": (
                        calendar_event.start_timestamp > now_timestamp
                        or calendar_event.end_timestamp <= 0
                    ),
                    "is_unscheduled_upcoming": (
                        calendar_event.start_timestamp <= 0
                        and calendar_event.end_timestamp <= 0
                    ),
                    "start_time": calendar_event.start_timestamp,
                    "end_time": calendar_event.end_timestamp,
                    "rewards": all_rewards,
                })

            limited_events.sort(key=lambda event: (
                event["is_upcoming"],
                event["is_tcg"],
                event["start_time"] if event["is_upcoming"] else event["end_time"],
            ))


            def find_wish_announcement(names):
                """
                Find the announcement matching the active banner.
                """

                for announcement in announcements:

                    if not announcement.subtitle:
                        continue

                    if not announcement.subtitle.startswith(
                        "Event Wish"
                    ):
                        continue

                    if not announcement.banner:
                        continue

                    content = announcement.content or ""

                    for name in names:

                        if name.lower() in content.lower():
                            return announcement

                return None


            # -----------------------------------------
            # Character Event Wishes
            # -----------------------------------------

            for banner in event_calendar.character_banners:

                if banner.pool_status != 2:
                    continue

                if banner.end_timestamp <= now_timestamp:
                    continue

                featured_5star_names = [
                    character.name
                    for character in banner.characters
                    if character.rarity == 5
                ]

                if not featured_5star_names:
                    continue

                announcement = find_wish_announcement(
                    featured_5star_names
                )

                featured_5stars = [
                    {
                        "name": character.name,
                        "icon": character.icon,
                    }
                    for character in banner.characters
                    if character.rarity == 5
                ]

                featured_4stars = [
                    {
                        "name": character.name,
                        "icon": character.icon,
                    }
                    for character in banner.characters
                    if character.rarity == 4
                ]

                wish_banners.append({
                    "banner_id": banner.id,
                    "banner_type": 301,
                    "title": (
                        clean_banner_title(
                            announcement.subtitle
                        )
                        if announcement
                        else "Character Event Wish"
                    ),
                    "banner_type_name": "Character Event Wish",
                    "image": (
                        announcement.banner
                        if announcement
                        else None
                    ),
                    "start_time": banner.start_timestamp,
                    "end_time": banner.end_timestamp,
                    "r5_up_items": featured_5stars,
                    "r4_up_items": featured_4stars,
                })


            # -----------------------------------------
            # Weapon Event Wishes
            # -----------------------------------------

            for banner in event_calendar.weapon_banners:

                if banner.pool_status != 2:
                    continue

                if banner.end_timestamp <= now_timestamp:
                    continue

                featured_5star_names = [
                    weapon.name
                    for weapon in banner.weapons
                    if weapon.rarity == 5
                ]

                featured_5stars = [
                    {
                        "name": weapon.name,
                        "icon": weapon.icon,
                    }
                    for weapon in banner.weapons
                    if weapon.rarity == 5
                ]

                featured_4stars = [
                    {
                        "name": weapon.name,
                        "icon": weapon.icon,
                    }
                    for weapon in banner.weapons
                    if weapon.rarity == 4
                ]

                if not featured_5stars:
                    continue

                announcement = find_wish_announcement(
                    featured_5star_names
                )

                wish_banners.append({
                    "banner_id": banner.id,
                    "banner_type": 302,
                    "title": (
                        clean_banner_title(
                            announcement.subtitle
                        )
                        if announcement
                        else "Weapon Event Wish"
                    ),
                    "banner_type_name": "Weapon Event Wish",
                    "image": (
                        announcement.banner
                        if announcement
                        else None
                    ),
                    "start_time": banner.start_timestamp,
                    "end_time": banner.end_timestamp,
                    "r5_up_items": featured_5stars,
                    "r4_up_items": featured_4stars,
                })


            # =========================================
            # DAILY COMMISSIONS
            # =========================================

            notes_data = notes["data"]

            daily_task = notes_data.get(
                "daily_task",
                {}
            )

            daily_commissions = int(
                notes_data.get(
                    "finished_task_num",
                    0
                )
            )

            attendance_rewards = daily_task.get(
                "attendance_rewards",
                []
            )

            daily_progress = min(
                4,
                daily_commissions
            )

            # -----------------------------------------
            # HANDBOOK / ENCOUNTER POINT REWARD
            # -----------------------------------------

            attendance_rewards = daily_task.get(
                "attendance_rewards",
                []
            )

            handbook_claimed = any(
                reward.get("status")
                == "AttendanceRewardStatusTakenAward"
                for reward in attendance_rewards
            )


            # -----------------------------------------
            # KATHERYNE / OVERALL REWARD
            # -----------------------------------------

            katheryne_claimed = bool(
                notes_data.get(
                    "is_extra_task_reward_received",
                    False
                )
            )


            daily_data = {
                "has_data": True,

                "completed": daily_progress,

                "total": 4,

                # Katheryne / overall reward.
                "claimed_reward": katheryne_claimed,

                # Handbook / Encounter Point reward.
                "handbook_claimed": handbook_claimed,

                "daily_commissions": int(
                    notes_data.get(
                        "finished_task_num",
                        0
                    )
                ),

                # Keep the stored Encounter Point value available,
                # but DO NOT use it for daily_progress.
                "encounter_points": float(
                    daily_task.get(
                        "stored_attendance",
                        0
                    )
                ),

                "reset_time": get_daily_reset_timestamp(
                    account["genshin_server"]
                ),
            }


            # -----------------------------------------
            # REWARD STATE
            # -----------------------------------------

            if katheryne_claimed:

                daily_data["reward_state"] = "claimed"

            elif handbook_claimed:

                daily_data["reward_state"] = "handbook-claimed"

            else:

                daily_data["reward_state"] = "unclaimed"
            
            
            # =========================================
            # RESIN
            # =========================================

            notes_data = notes["data"]

            current_resin = notes_data["current_resin"]
            maximum_resin = 200
            recovery_seconds = int(
                notes_data["resin_recovery_time"]
            )

            now_timestamp = int(time.time())

            if current_resin >= maximum_resin:
                next_resin_at = None
                full_resin_at = None
            else:
                remaining_resin = (
                    maximum_resin - current_resin
                )

                next_resin_at = (
                    now_timestamp
                    + recovery_seconds
                    - ((remaining_resin - 1) * 480)
                )

                full_resin_at = (
                    now_timestamp + recovery_seconds
                )

            resin_data = {
                "has_data": True,
                "current": current_resin,
                "maximum": maximum_resin,
                "next_resin_at": next_resin_at,
                "full_resin_at": full_resin_at,
            }


            # =========================================
            # TROUNCE DOMAINS
            # =========================================

            trounce_data = {
                "has_data": True,
                "remaining": (
                    notes["data"]["remain_resin_discount_num"]
                ),
                "total": (
                    notes["data"]["resin_discount_num_limit"]
                ),
                "reset_time": get_weekly_reset_timestamp(
                    account["genshin_server"]
                ),
            }
            
            # =========================================
            # ACTIVITY CHECKMARKS
            # =========================================

            daily_period_key, weekly_period_key = (
                get_event_activity_period_keys(
                    account["genshin_server"]
                )
            )

            activity_checks = await get_event_activity_checks(
                user_id,
                account["genshin_uid"],
                daily_period_key,
                weekly_period_key,
            )

            daily_data["manual_checked"] = (
                activity_checks["daily_commissions"]
            )

            trounce_data["manual_checked"] = (
                activity_checks["trounce_domains"]
            )
            
            daily_automatic_checked = (
                daily_data["completed"] >= daily_data["total"]
                and daily_data["claimed_reward"]
            )

            trounce_automatic_checked = (
                trounce_data["remaining"] <= 0
            )

            daily_data["checked"] = (
                daily_automatic_checked
                if daily_data["manual_checked"] is None
                else daily_data["manual_checked"]
            )

            trounce_data["checked"] = (
                trounce_automatic_checked
                if trounce_data["manual_checked"] is None
                else trounce_data["manual_checked"]
            )


            # =========================================
            # SPIRAL ABYSS
            # =========================================

            abyss_chambers = []

            if abyss.floors:

                deepest_floor = max(
                    abyss.floors,
                    key=lambda floor: floor.floor
                )

                for chamber in deepest_floor.chambers:

                    battles = []

                    for battle in chamber.battles:

                        characters = []

                        for character in battle.characters:

                            characters.append({
                                "name": character.name,
                                "icon": character.icon,
                            })

                        battles.append({
                            "half": battle.half,
                            "characters": characters,
                        })

                    abyss_chambers.append({
                        "floor": deepest_floor.floor,
                        "chamber": chamber.chamber,
                        "battles": battles,
                    })


            abyss_data = {
                "has_data": abyss.total_battles > 0,
                "max_floor": abyss.max_floor,
                "total_stars": abyss.total_stars,
                "end_time": abyss.end_time.timestamp(),
                "chambers": abyss_chambers,
            }


            # =========================================
            # STYGIAN ONSLAUGHT
            # =========================================

            if include_featured and stygian:
                current_stygian = stygian[0]
                record = current_stygian["single"]["best"]

                bosses = []

                for challenge in current_stygian["single"]["challenge"]:
                    characters = []

                    for character in challenge.get("teams", []):
                        characters.append({
                            "name": character["name"],
                            "icon": character["image"],
                        })

                    bosses.append({
                        "name": challenge["monster"]["name"],
                        "icon": challenge["monster"]["icon"],
                        "time": challenge["second"],
                        "characters": characters,
                    })

                difficulty_icons = {
                    1: "SO_Diff_I.webp",
                    2: "SO_Diff_II.webp",
                    3: "SO_Diff_III.webp",
                    4: "SO_Diff_IV.webp",
                    5: "SO_Diff_V.webp",
                    6: "SO_Diff_VI.webp",
                }

                stygian_data = {
                    "has_data": current_stygian["single"]["has_data"],
                    "end_time": int(
                        current_stygian["schedule"]["end_time"]
                    ),
                    "difficulty": (
                        record["difficulty"] if record else 0
                    ),
                    "difficulty_icon": (
                        "SO_Diff_VI_180.webp"
                        if (
                            record
                            and record["difficulty"] == 6
                            and record["second"] < 180
                        )
                        else (
                            difficulty_icons.get(
                                record["difficulty"], ""
                            )
                            if record
                            else ""
                        )
                    ),
                    "best_time": record["second"] if record else 0,
                    "bosses": bosses,
                }
                
            # Attach Dire Prestige data after the Stygian dictionary has been fully constructed.
            stygian_data["dire_prestige"] = dire_prestige_data

            # =========================================
            # IMAGINARIUM THEATER
            # =========================================

            if include_featured and theater:
                current_cycle = theater["data"][0]
                stat = current_cycle["stat"]
                schedule = current_cycle["schedule"]
                detail = current_cycle["detail"]
                acts = detail["rounds_data"]

                arcanums = sum(
                    1
                    for act in acts
                    if act.get("is_tarot") is True
                )

                theater_data = {
                    "has_data": stat["max_round_id"] > 0,
                    "best_round": stat["max_round_id"],
                    "arcanums": arcanums,
                    "medals": stat["medal_num"],
                    "end_time": schedule["end_time"],
                    "elements": IT_ELEMENTS,
                }


    except Exception as error:

        print("===== EVENTS ERROR =====")
        print(f"Account: {account.get('genshin_uid')}")
        print(f"Type: {type(error).__name__}")
        print(f"Error: {error}")
        print("================================")


    result = {
        "account": account,
        "abyss": abyss_data,
        "theater": theater_data,
        "stygian": stygian_data,
        "daily": daily_data,
        "trounce": trounce_data,
        "resin": resin_data,
        "wish_banners": wish_banners,
        "limited_events": limited_events,
    }

    _events_cache[cache_key] = {
        "timestamp": time.monotonic(),
        "data": result,
    }

    return result


async def get_events_data(
    user_id: int,
    account_id: int | None = None,
    overview: bool = False,
):
    accounts = await get_accounts(user_id)

    selected_account = None

    if accounts:

        if account_id is not None:

            selected_account = next(
                (
                    account
                    for account in accounts
                    if account["id"] == account_id
                ),
                None,
            )

        if selected_account is None:
            selected_account = accounts[0]


    # =========================================
    # OVERVIEW VIEW
    # =========================================

    if overview:

        overview_data = await asyncio.gather(
            *[
                get_single_account_events(
                    user_id,
                    account,
                    include_featured=True,
                )
                for account in accounts
            ]
        )


        return {
            "accounts": accounts,
            "selected_account": selected_account,
            "overview": True,
            "overview_data": overview_data,
        }


    # =========================================
    # ACCOUNT VIEW
    # =========================================

    if selected_account is not None:

        account_events = await get_single_account_events(
            user_id,
            selected_account,
        )

        return {
            "accounts": accounts,
            "selected_account": selected_account,
            "overview": False,
            "abyss": account_events["abyss"],
            "theater": account_events["theater"],
            "stygian": account_events["stygian"],
            "daily": account_events["daily"],
            "trounce": account_events["trounce"],
            "wish_banners": account_events["wish_banners"],
            "limited_events": account_events["limited_events"],
        }


    # =========================================
    # NO ACCOUNTS
    # =========================================

    return {
        "accounts": accounts,
        "selected_account": None,
        "overview": False,
        "abyss": {
            "has_data": False,
            "max_floor": "—",
            "total_stars": 0,
            "end_time": 0,
            "chambers": [],
        },
        "theater": {
            "has_data": False,
            "best_round": 0,
            "arcanums": 0,
            "medals": 0,
            "end_time": 0,
            "elements": IT_ELEMENTS,
        },
        "stygian": {
            "has_data": False,
            "end_time": 0,
            "difficulty": 0,
            "difficulty_icon": "",
            "best_time": 0,
            "bosses": [],
            "dire_prestige": {
                "ended": True,
                "available": False,
                "active": False,
                "progress": 0,
                "max_progress": 0,
            },
        },
        "daily": {
            "has_data": False,
            "completed": 0,
            "total": 4,
            "claimed_reward": False,
            "encounter_points": 0,
            "reset_time": 0,
        },
        "trounce": {
            "has_data": False,
            "remaining": 0,
            "total": 3,
            "reset_time": 0,
        },
        "wish_banners": [],
        "limited_events": [],
    }


def clean_banner_title(title: str) -> str:
    return re.sub(
        r"<color=.*?>(.*?)</color>",
        r"\1",
        title
    )

def get_daily_reset_timestamp(
    genshin_server: str
) -> int:

    server_offsets = {
        "os_usa": timezone(
            timedelta(hours=-5)
        ),
        "os_euro": timezone(
            timedelta(hours=1)
        ),
        "os_asia": timezone(
            timedelta(hours=8)
        ),
    }

    timezone_value = server_offsets.get(
        genshin_server,
        timezone.utc
    )

    now = datetime.now(timezone_value)

    reset = now.replace(
        hour=4,
        minute=0,
        second=0,
        microsecond=0
    )

    if now >= reset:
        reset += timedelta(days=1)

    return int(reset.timestamp())


def get_weekly_reset_timestamp(
    genshin_server: str
) -> int:

    server_offsets = {
        "os_usa": timezone(
            timedelta(hours=-5)
        ),
        "os_euro": timezone(
            timedelta(hours=1)
        ),
        "os_asia": timezone(
            timedelta(hours=8)
        ),
    }

    timezone_value = server_offsets.get(
        genshin_server,
        timezone.utc
    )

    now = datetime.now(timezone_value)

    days_until_monday = (
        7 - now.weekday()
    ) % 7

    reset = (
        now
        + timedelta(days=days_until_monday)
    ).replace(
        hour=4,
        minute=0,
        second=0,
        microsecond=0
    )

    if reset <= now:
        reset += timedelta(days=7)

    return int(reset.timestamp())


@app.get(
    "/events", 
    response_class=HTMLResponse
)
async def events_page(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
    overview: bool = False,
):
    session = await get_web_session(cyrene_session)

    if session is None:
        return RedirectResponse(
            url="/verify?next=/events",
            status_code=303,
        )

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


@app.get(
    "/events/refresh",
    response_class=HTMLResponse
)
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
    

@app.post("/api/events/activity-check")
async def update_event_activity_check(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(
        cyrene_session
    )

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
    except Exception:
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
        "daily_commissions",
        "trounce_domains",
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
    except (TypeError, ValueError):
        return JSONResponse(
            {
                "success": False,
                "error": "Invalid account ID.",
            },
            status_code=400,
        )

    # =========================================
    # VERIFY ACCOUNT OWNERSHIP
    # =========================================

    accounts = await get_accounts(user_id)

    account = next(
        (
            account
            for account in accounts
            if int(account["id"]) == account_id
        ),
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

    # =========================================
    # DETERMINE CURRENT PERIOD
    # =========================================

    daily_period_key, weekly_period_key = (
        get_event_activity_period_keys(
            account["genshin_server"]
        )
    )

    period_key = (
        daily_period_key
        if activity_type == "daily_commissions"
        else weekly_period_key
    )

    # =========================================
    # SAVE CHECKMARK
    # =========================================

    await set_event_activity_check(
        user_id,
        account["genshin_uid"],
        activity_type,
        period_key,
        checked,
    )

    # =========================================
    # INVALIDATE EVENTS CACHE
    # =========================================

    for include_featured in (True, False):
        _events_cache.pop(
            (
                user_id,
                account["id"],
                account["genshin_uid"],
                include_featured,
            ),
            None,
        )

    return JSONResponse(
        {
            "success": True,
            "checked": checked,
            "activity_type": activity_type,
            "period_key": period_key,
        }
    )


@app.get("/api/events/daily")
async def daily_events_data(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    session = await get_web_session(
        cyrene_session
    )

    if session is None:
        return {
            "success": False
        }

    user_id = session.user_id

    accounts = await get_accounts(
        user_id
    )

    if not accounts:
        return {
            "success": False
        }

    selected_account = None

    if account_id is not None:
        selected_account = next(
            (
                account
                for account in accounts
                if account["id"] == account_id
            ),
            None,
        )

    if selected_account is None:
        selected_account = accounts[0]

    try:

        client = await get_account_client(
            user_id,
            selected_account["genshin_uid"]
        )

        if client is None:
            return {
                "success": False
            }

        async with client:

            notes = await client.get_genshin_notes()

        data = notes["data"]

        daily_commissions = int(
            data.get("finished_task_num", 0)
        )

        daily_task = data.get(
            "daily_task",
            {}
        )

        encounter_points = float(
            daily_task.get("stored_attendance", 0)
        )

        daily_progress = min(
            4,
            daily_commissions + encounter_points
        )
        
        return {
            "success": True,

            # Combined Daily Commission + Encounter Point progress.
            "completed": daily_progress,

            "total": 4,

            "claimed_reward": (
                data["is_extra_task_reward_received"]
            ),

            # Individual values remain available if the frontend needs them later.
            "daily_commissions": daily_commissions,
            "encounter_points": encounter_points,

            "reset_time": get_daily_reset_timestamp(
                selected_account["genshin_server"]
            ),
        }

    except Exception as error:

        print("===== DAILY EVENTS ERROR =====")
        print(f"Type: {type(error).__name__}")
        print(f"Error: {error}")
        print("================================")

        return {
            "success": False
        }
        
        
# =========================================
# CUSTOM EVENTS — API HELPERS
# =========================================

def parse_custom_event_datetime(value, field_name: str) -> datetime:
    """Parse an ISO-8601 datetime and ensure it is timezone-aware."""
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} is required.",
        )

    try:
        parsed = datetime.fromisoformat(
            value.strip().replace("Z", "+00:00")
        )
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be a valid ISO-8601 datetime.",
        )

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


async def validate_custom_event_payload(
    user_id: int,
    data: dict,
) -> dict:
    """Validate event fields and verify the selected account belongs to the user."""

    title = data.get("title")
    if not isinstance(title, str) or not title.strip():
        raise HTTPException(
            status_code=400,
            detail="An event title is required.",
        )

    title = title.strip()
    if len(title) > 120:
        raise HTTPException(
            status_code=400,
            detail="The event title cannot exceed 120 characters.",
        )

    description = data.get("description")
    if description is not None:
        if not isinstance(description, str):
            raise HTTPException(
                status_code=400,
                detail="Description must be text.",
            )
        description = description.strip() or None
        if description and len(description) > 2000:
            raise HTTPException(
                status_code=400,
                detail="Description cannot exceed 2000 characters.",
            )

    account_scope = data.get("account_scope", "all")
    if account_scope not in {"all", "account"}:
        raise HTTPException(
            status_code=400,
            detail="Account scope must be 'all' or 'account'.",
        )

    account_id = data.get("account_id")

    if account_scope == "all":
        account_id = None
    else:
        try:
            account_id = int(account_id)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail="Select a valid account for this event.",
            )

        accounts = await get_accounts(user_id)
        owned_account = next(
            (
                account
                for account in accounts
                if int(account["id"]) == account_id
            ),
            None,
        )

        if owned_account is None:
            raise HTTPException(
                status_code=404,
                detail="Account not found.",
            )

    start_at = parse_custom_event_datetime(
        data.get("start_at"),
        "Start date and time",
    )

    end_value = data.get("end_at")
    end_at = (
        parse_custom_event_datetime(end_value, "End date and time")
        if end_value
        else None
    )

    if end_at is not None and end_at <= start_at:
        raise HTTPException(
            status_code=400,
            detail="The end date and time must be after the start.",
        )

    recurrence = data.get("recurrence", {"type": "none"})
    if not isinstance(recurrence, dict):
        raise HTTPException(
            status_code=400,
            detail="Recurrence must be an object.",
        )

    recurrence_type = recurrence.get("type", "none")
    if recurrence_type not in {"none", "daily", "weekly", "monthly"}:
        raise HTTPException(
            status_code=400,
            detail="Unsupported recurrence type.",
        )

    try:
        interval = int(recurrence.get("interval", 1))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="Recurrence interval must be a number.",
        )

    if not 1 <= interval <= 365:
        raise HTTPException(
            status_code=400,
            detail="Recurrence interval must be between 1 and 365.",
        )

    recurrence = {
        "type": recurrence_type,
        "interval": interval,
    }

    if recurrence_type == "weekly":
        supplied_weekdays = data.get("recurrence", {}).get("weekdays", [])

        if not isinstance(supplied_weekdays, list):
            raise HTTPException(
                status_code=400,
                detail="Weekly recurrence weekdays must be a list.",
            )

        try:
            supplied_weekdays = sorted(set(int(day) for day in supplied_weekdays))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail="Weekly recurrence weekdays are invalid.",
            )

        if any(day < 0 or day > 6 for day in supplied_weekdays):
            raise HTTPException(
                status_code=400,
                detail="Weekdays must be between 0 (Monday) and 6 (Sunday).",
            )

        recurrence["weekdays"] = supplied_weekdays

    colour = data.get("colour", "#7c83ff")
    if not isinstance(colour, str) or not re.fullmatch(
        r"#[0-9a-fA-F]{6}", colour
    ):
        raise HTTPException(
            status_code=400,
            detail="Colour must be a valid six-digit hexadecimal colour.",
        )
    colour = colour.lower()

    reminder_minutes = data.get("reminder_minutes")
    if reminder_minutes is not None:
        try:
            reminder_minutes = int(reminder_minutes)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail="Reminder time must be a number of minutes.",
            )

        if not 0 <= reminder_minutes <= 10080:
            raise HTTPException(
                status_code=400,
                detail="Reminder time must be between 0 and 10080 minutes.",
            )

    progress = data.get("progress", [])
    if not isinstance(progress, list) or len(progress) > 20:
        raise HTTPException(
            status_code=400,
            detail="Progress must be a list of no more than 20 objectives.",
        )

    clean_progress = []
    for objective in progress:
        if not isinstance(objective, dict):
            raise HTTPException(
                status_code=400,
                detail="Each progress objective must be an object.",
            )

        objective_title = objective.get("title")
        if not isinstance(objective_title, str) or not objective_title.strip():
            raise HTTPException(
                status_code=400,
                detail="Each progress objective needs a title.",
            )

        try:
            current = int(objective.get("current", 0))
            target = int(objective.get("target", 1))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail="Progress values must be whole numbers.",
            )

        if len(objective_title.strip()) > 100 or target < 1 or current < 0:
            raise HTTPException(
                status_code=400,
                detail="A progress objective has invalid values.",
            )

        clean_progress.append({
            "title": objective_title.strip(),
            "current": min(current, target),
            "target": target,
        })
        
    icon_url = data.get("icon_url")

    if icon_url is not None:
        if not isinstance(icon_url, str):
            raise HTTPException(
                status_code=400,
                detail="Event icon URL must be text.",
            )

        icon_url = icon_url.strip() or None

        if icon_url is not None and not re.fullmatch(
            r"/static/uploads/custom-events/[a-f0-9-]{36}\.(?:png|jpg|webp)",
            icon_url,
        ):
            raise HTTPException(
                status_code=400,
                detail="Invalid event icon.",
            )

    return {
        "title": title,
        "description": description,
        "account_scope": account_scope,
        "account_id": account_id,
        "start_at": start_at,
        "end_at": end_at,
        "recurrence": recurrence,
        "colour": colour,
        "reminder_minutes": reminder_minutes,
        "progress": clean_progress,
        "icon_url": icon_url,
    }
    

@app.get(
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
        return RedirectResponse(
            url="/verify?next=/inventory",
            status_code=303,
        )

    user_id = session.user_id
    accounts = await get_accounts(user_id)

    selected_account = next(
        (
            account
            for account in accounts
            if account["id"] == account_id
        ),
        None,
    ) if account_id is not None else None

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


@app.get("/api/inventory")
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
    selected_account = next(
        (
            account
            for account in accounts
            if account["id"] == account_id
        ),
        None,
    )

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
    except RuntimeError as error:
        return JSONResponse(
            status_code=404,
            content={"error": str(error)},
        )
    except Exception:
        logger.exception(
            "Failed to retrieve inventory for account %s",
            selected_account["id"],
        )
        return JSONResponse(
            status_code=502,
            content={
                "error": "Couldn't retrieve inventory from HoYoLAB."
            },
        )

    return {
        "account_id": selected_account["id"],
        "inventory": inventory,
    }


@app.get(
    "/characters",
    response_class=HTMLResponse
)
async def characters_page(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    session = await get_web_session(cyrene_session)

    if session is None:
        return RedirectResponse(
            url="/verify?next=/characters",
            status_code=303,
        )

    user_id = session.user_id
    accounts = await get_accounts(user_id)

    selected_account = next(
        (
            account
            for account in accounts
            if account["id"] == account_id
        ),
        None,
    ) if account_id is not None else None

    if selected_account is None and accounts:
        selected_account = accounts[0]

    characters = []
    character_error = None

    # Build the full character catalogue independently of account ownership.
    character_catalogue = []
    catalogue = CHARACTER_NAMES.get("en-us", {})

    traveler_names = {
        10000005: "Aether",
        10000007: "Lumine",
    }

    for character_id, data in catalogue.items():
        character_id = int(character_id)

        character_catalogue.append({
            "id": character_id,
            "name": traveler_names.get(character_id, data.name),
            "element": data.element,
            "rarity": data.rarity,
            "icon": (
                "https://enka.network/ui/"
                f"UI_AvatarIcon_{data.icon_name}.png"
            ),
        })

    character_catalogue.sort(
        key=lambda character: character["name"].casefold()
    )

    if selected_account is not None:
        client = await get_account_client(
            user_id,
            selected_account["genshin_uid"],
        )

        if client is None:
            character_error = "Unable to load the selected account."
        else:
            try:
                async with client:
                    owned_characters = (
                        await client.get_genshin_characters()
                    )

                # Index the account's characters by their numeric IDs.
                owned_by_id = {
                    int(character.id): character
                    for character in owned_characters
                }
                
                # Get the full character catalogue from genshin.py.
                catalogue = CHARACTER_NAMES.get("en-us", {})

                def get_weapon_type(character, catalogue_data):
                    """Return a normalised Genshin weapon type."""

                    weapon_types = {
                        1: "Sword",
                        10: "Catalyst",
                        11: "Claymore",
                        12: "Bow",
                        13: "Polearm",
                    }

                    for source in (character, catalogue_data):
                        if source is None:
                            continue

                        value = getattr(source, "weapon_type", None)

                        if value is None:
                            continue

                        value = getattr(value, "value", value)

                        try:
                            weapon_id = int(value)
                        except (TypeError, ValueError):
                            continue

                        if weapon_id in weapon_types:
                            return weapon_types[weapon_id]

                    return ""

                for character_id, data in catalogue.items():
                    owned = owned_by_id.get(int(character_id))

                    # Give the two Traveler variants distinct names.
                    traveler_names = {
                        10000005: "Aether",
                        10000007: "Lumine",
                    }

                    name = traveler_names.get(
                        int(character_id),
                        data.name,
                    )

                    # Preserve the library's existing portrait convention.
                    icon = (
                        owned.icon
                        if owned is not None
                        else (
                            "https://enka.network/ui/"
                            f"UI_AvatarIcon_{data.icon_name}.png"
                        )
                    )

                    characters.append({
                        "id": int(character_id),
                        "name": (
                            owned.name
                            if owned is not None
                            else name
                        ),
                        "element": (
                            owned.element
                            if owned is not None
                            else data.element
                        ),
                        "rarity": (
                            owned.rarity
                            if owned is not None
                            else data.rarity
                        ),
                        "icon": icon,
                        "level": (
                            owned.level
                            if owned is not None
                            else None
                        ),
                        "friendship": (
                            owned.friendship
                            if owned is not None
                            else None
                        ),
                        "constellation": (
                            owned.constellation
                            if owned is not None
                            else None
                        ),
                        "weapon": get_weapon_type(owned, data),
                        "owned": owned is not None,
                    })

                # Owned characters first, then highest level to lowest.
                # Unowned characters remain at the bottom.
                characters.sort(
                    key=lambda character: (
                        not character["owned"],
                        -(character["level"] or 0),
                        character["name"].casefold(),
                    )
                )

            except Exception:
                logger.exception(
                    "Failed to retrieve characters for account %s",
                    selected_account["id"],
                )
                character_error = (
                    "Couldn't retrieve characters from HoYoLAB "
                    "or build the character roster. "
                    "Please try again later."
                )

    return templates.TemplateResponse(
        request=request,
        name="characters.html",
        context={
            "request": request,
            "accounts": accounts,
            "selected_account": selected_account,
            "characters": characters,
            "character_error": character_error,
            "character_catalogue": character_catalogue,
        },
    )
    
    
def _normalise_character_plan(plan: object) -> dict | None:
    """Validate the small user-owned payload stored for a planner card."""

    if not isinstance(plan, dict):
        return None

    try:
        character_id = int(plan.get("id"))
        rarity = max(1, min(5, int(plan.get("rarity", 4))))
        constellation = max(0, min(6, int(plan.get("constellation", 0))))
        level = max(1, min(90, int(plan.get("level", 90))))
        weapon_level = max(
            1,
            min(90, int(plan.get("weaponLevel", 90))),
        )
    except (TypeError, ValueError):
        return None

    if character_id <= 0:
        return None

    talents = plan.get("talents")
    if not isinstance(talents, list) or len(talents) != 3:
        talents = [1, 1, 1]

    def optional_int(key: str, minimum: int, maximum: int):
        value = plan.get(key)
        if value is None:
            return None
        try:
            return max(minimum, min(maximum, int(value)))
        except (TypeError, ValueError):
            return None

    def bounded_list(values: object, minimum: int, maximum: int):
        if not isinstance(values, list):
            return None

        result = []
        for value in values[:3]:
            try:
                result.append(max(minimum, min(maximum, int(value))))
            except (TypeError, ValueError):
                return None
        return result if len(result) == 3 else None

    target_talents = bounded_list(talents, 1, 13) or [1, 1, 1]
    current_talents = bounded_list(plan.get("currentTalents"), 1, 15)

    return {
        "id": str(character_id),
        "name": str(plan.get("name") or "Unknown character")[:100],
        "element": str(plan.get("element") or "")[:20],
        "rarity": rarity,
        "icon": str(plan.get("icon") or "")[:1000],
        "notes": str(plan.get("notes") or "")[:2000],
        "constellation": constellation,
        "currentConstellation": optional_int(
            "currentConstellation",
            0,
            6,
        ),
        "level": level,
        "currentLevel": optional_int("currentLevel", 1, 90),
        "talents": target_talents,
        "currentTalents": current_talents,
        "weaponLevel": weapon_level,
        "currentWeaponLevel": optional_int(
            "currentWeaponLevel",
            1,
            90,
        ),
        "currentWeaponRarity": optional_int(
            "currentWeaponRarity",
            1,
            5,
        ),
    }


async def _get_planner_account(user_id: int, account_id: int):
    accounts = await get_accounts(user_id)
    return next(
        (
            account
            for account in accounts
            if int(account["id"]) == account_id
        ),
        None,
    )


@app.get("/api/characters/plans")
async def character_plans_data(
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    """Load database-backed Character Planner entries."""

    session = await get_web_session(cyrene_session)
    if session is None:
        return JSONResponse(status_code=401, content={"error": "Session expired."})
    if account_id is None or await _get_planner_account(session.user_id, account_id) is None:
        return JSONResponse(status_code=404, content={"error": "Account not found."})

    return {"plans": await get_character_plans(session.user_id, account_id)}


@app.put("/api/characters/plans")
async def save_character_plans(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    """Replace database-backed Character Planner entries."""

    session = await get_web_session(cyrene_session)
    if session is None:
        return JSONResponse(status_code=401, content={"error": "Session expired."})
    if account_id is None or await _get_planner_account(session.user_id, account_id) is None:
        return JSONResponse(status_code=404, content={"error": "Account not found."})

    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "Invalid planner data."})

    submitted = payload.get("plans") if isinstance(payload, dict) else None
    if not isinstance(submitted, list) or len(submitted) > 100:
        return JSONResponse(status_code=400, content={"error": "Invalid planner data."})

    plans = [_normalise_character_plan(plan) for plan in submitted]
    if any(plan is None for plan in plans):
        return JSONResponse(status_code=400, content={"error": "Invalid planner entry."})
    character_ids = [plan["id"] for plan in plans]
    if len(character_ids) != len(set(character_ids)):
        return JSONResponse(status_code=400, content={"error": "Duplicate planner entry."})

    await replace_character_plans(session.user_id, account_id, plans)
    return {"saved": len(plans)}


@app.get("/api/characters/{character_id}/showcase")
async def character_showcase_data(
    character_id: int,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    """Retrieve detailed build data for an owned character."""

    session = await get_web_session(cyrene_session)

    if session is None:
        return JSONResponse(
            status_code=401,
            content={"error": "Your session has expired."},
        )

    user_id = session.user_id
    accounts = await get_accounts(user_id)

    # Use the requested account, or the first account by default.
    if account_id is not None:
        selected_account = next(
            (
                account
                for account in accounts
                if int(account["id"]) == account_id
            ),
            None,
        )

        if selected_account is None:
            return JSONResponse(
                status_code=404,
                content={"error": "Account not found."},
            )
    else:
        selected_account = accounts[0] if accounts else None

    if selected_account is None:
        return JSONResponse(
            status_code=404,
            content={"error": "No linked account found."},
        )

    client = await get_account_client(
        user_id,
        selected_account["genshin_uid"],
    )

    if client is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Unable to load the selected account."},
        )

    try:
        async with client:
            # Confirm the character belongs to this account.
            owned_characters = await client.get_genshin_characters()

            if not any(
                int(character.id) == character_id
                for character in owned_characters
            ):
                return JSONResponse(
                    status_code=404,
                    content={
                        "error": "This character isn't owned by this account."
                    },
                )

            # Retrieve detailed data for this character only.
            detailed_characters = (
                await client.get_genshin_detailed_characters(
                    characters=[character_id],
                )
            )

        # Convert Pydantic models into JSON-compatible dictionaries.
        if isinstance(detailed_characters, (list, tuple)):
            character_data = [
                character.model_dump(mode="json")
                if hasattr(character, "model_dump")
                else character
                for character in detailed_characters
            ]
        elif hasattr(detailed_characters, "model_dump"):
            character_data = detailed_characters.model_dump(mode="json")
        else:
            character_data = detailed_characters

        return {
            "character_id": character_id,
            "data": character_data,
        }

    except Exception:
        logger.exception(
            "Failed to retrieve showcase data for character %s "
            "on account %s",
            character_id,
            selected_account["id"],
        )

        return JSONResponse(
            status_code=502,
            content={
                "error": "Couldn't retrieve detailed character data."
            },
        )


@app.get("/api/characters/{character_id}/planner-costs")
async def character_planner_costs(
    character_id: int,
    character_name: str,
    current_level: int,
    target_level: int,
    current_talents: str,
    target_talents: str,
    target_weapon_level: int,
    cyrene_session: str | None = Cookie(default=None),
    weapon_name: str | None = None,
    weapon_rarity: int | None = None,
    current_weapon_level: int | None = None,
    current_ascension: int | None = None,
    weapon_ascension: int | None = None,
):
    """Calculate saved planner goals from the account's current levels."""

    session = await get_web_session(cyrene_session)

    if session is None:
        return JSONResponse(
            status_code=401,
            content={"error": "Your session has expired."},
        )

    try:
        parsed_current_talents = [
            int(level)
            for level in current_talents.split(",")
        ]
        parsed_target_talents = [
            int(level)
            for level in target_talents.split(",")
        ]
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={"error": "Talent levels must be whole numbers."},
        )

    if not 1 <= current_level <= 90 or not 1 <= target_level <= 90:
        return JSONResponse(
            status_code=400,
            content={"error": "Character levels must be between 1 and 90."},
        )

    if not 1 <= target_weapon_level <= 90:
        return JSONResponse(
            status_code=400,
            content={"error": "Weapon levels must be between 1 and 90."},
        )

    if current_weapon_level is not None and not 1 <= current_weapon_level <= 90:
        return JSONResponse(
            status_code=400,
            content={"error": "Weapon levels must be between 1 and 90."},
        )

    if weapon_rarity is not None and weapon_rarity not in (1, 2, 3, 4, 5):
        return JSONResponse(
            status_code=400,
            content={"error": "Weapon rarity must be between 1 and 5."},
        )

    character_name = character_name.strip()

    if not character_name or len(character_name) > 100:
        return JSONResponse(
            status_code=400,
            content={"error": "A valid character name is required."},
        )

    try:
        costs = await calculate_planner_costs(
            character_name=character_name,
            character_level_name={
                10000005: "Aether",
                10000007: "Lumine",
            }.get(character_id),
            current_level=current_level,
            target_level=target_level,
            current_talents=parsed_current_talents,
            target_talents=parsed_target_talents,
            weapon_name=weapon_name,
            weapon_rarity=weapon_rarity,
            current_weapon_level=current_weapon_level,
            target_weapon_level=target_weapon_level,
            current_ascension=current_ascension,
            weapon_ascension=weapon_ascension,
        )
    except ValueError as error:
        return JSONResponse(
            status_code=400,
            content={"error": str(error)},
        )

    return {
        "character_id": character_id,
        "costs": costs,
    }
    
    
# =========================================
# CUSTOM EVENTS — LIST
# =========================================

@app.get("/api/custom-events")
async def api_get_custom_events(
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    user_id = await get_authenticated_user(cyrene_session)

    if account_id is not None:
        accounts = await get_accounts(user_id)

        if not any(
            int(account["id"]) == account_id
            for account in accounts
        ):
            raise HTTPException(
                status_code=404,
                detail="Account not found.",
            )

    events = await get_custom_events(user_id, account_id)

    for event in events:
        event_id = int(event["id"])

        # Objective progress is account-specific on the normal page.
        if account_id is not None:
            account_progress = await get_custom_event_account_progress(
                discord_user_id=user_id,
                event_id=event_id,
                account_id=account_id,
            )

            objectives = event.get("progress") or []

            for index, objective in enumerate(objectives):
                objective["current"] = account_progress.get(index, 0)

        event["completions"] = await get_custom_event_completions(
            discord_user_id=user_id,
            event_id=int(event["id"]),
            account_id=account_id,
        )

    return {"success": True, "events": events}


# =========================================
# CUSTOM EVENTS — CREATE
# =========================================

@app.post("/api/custom-events")
async def api_create_custom_event(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON request.")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object.")

    fields = await validate_custom_event_payload(user_id, data)

    event = await create_custom_event(
        discord_user_id=user_id,
        **fields,
    )

    event["completions"] = []

    return {"success": True, "event": event}


CUSTOM_EVENT_UPLOAD_DIR = (
    BASE_DIR / "website" / "static" / "uploads" / "custom-events"
)

MAX_CUSTOM_EVENT_ICON_SIZE = 5 * 1024 * 1024

CUSTOM_EVENT_IMAGE_TYPES = {
    "png": (b"\x89PNG\r\n\x1a\n",),
    "jpg": (b"\xff\xd8\xff",),
    "webp": (),
}


@app.post("/api/custom-events/icon")
async def upload_custom_event_icon(
    cyrene_session: str | None = Cookie(default=None),
    file: UploadFile = File(...),
):
    # Use the same authentication as the Custom Events API.
    user_id = await get_authenticated_user(cyrene_session)

    contents = await file.read(MAX_CUSTOM_EVENT_ICON_SIZE + 1)
    await file.close()

    if not contents:
        raise HTTPException(
            status_code=400,
            detail="Choose an image to upload.",
        )

    if len(contents) > MAX_CUSTOM_EVENT_ICON_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Event icons cannot exceed 2 MB.",
        )

    extension = None

    if contents.startswith(CUSTOM_EVENT_IMAGE_TYPES["png"][0]):
        extension = "png"

    elif contents.startswith(CUSTOM_EVENT_IMAGE_TYPES["jpg"][0]):
        extension = "jpg"

    elif (
        len(contents) >= 12
        and contents[:4] == b"RIFF"
        and contents[8:12] == b"WEBP"
    ):
        extension = "webp"

    if extension is None:
        raise HTTPException(
            status_code=400,
            detail="Upload a valid PNG, JPEG or WebP image.",
        )

    CUSTOM_EVENT_UPLOAD_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    filename = f"{uuid.uuid4()}.{extension}"
    destination = CUSTOM_EVENT_UPLOAD_DIR / filename

    destination.write_bytes(contents)

    return {
        "success": True,
        "icon_url": f"/static/uploads/custom-events/{filename}",
    }


# =========================================
# CUSTOM EVENTS — REORDER
# =========================================

@app.post("/api/custom-events/reorder")
async def api_reorder_custom_events(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid JSON request.",
        )

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=400,
            detail="Request body must be an object.",
        )

    account_id = data.get("account_id")
    ordered_event_ids = data.get("ordered_event_ids")

    if (
        isinstance(account_id, bool)
        or not isinstance(account_id, int)
        or account_id < 1
    ):
        raise HTTPException(
            status_code=400,
            detail="'account_id' must be a positive integer.",
        )

    if (
        not isinstance(ordered_event_ids, list)
        or not ordered_event_ids
    ):
        raise HTTPException(
            status_code=400,
            detail="'ordered_event_ids' must be a non-empty list.",
        )

    if any(
        isinstance(event_id, bool)
        or not isinstance(event_id, int)
        or event_id < 1
        for event_id in ordered_event_ids
    ):
        raise HTTPException(
            status_code=400,
            detail="Every event ID must be a positive integer.",
        )

    if len(ordered_event_ids) != len(set(ordered_event_ids)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate event IDs are not allowed.",
        )

    saved = await reorder_custom_events(
        discord_user_id=user_id,
        account_id=account_id,
        ordered_event_ids=ordered_event_ids,
    )

    if not saved:
        raise HTTPException(
            status_code=409,
            detail=(
                "The event order could not be saved. "
                "Refresh and try again."
            ),
        )

    return {
        "success": True,
        "account_id": account_id,
        "ordered_event_ids": ordered_event_ids,
    }


# =========================================
# CUSTOM EVENTS — UPDATE
# =========================================

@app.put("/api/custom-events/{event_id}")
async def api_update_custom_event(
    event_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    existing = await get_custom_event(user_id, event_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Custom event not found.")

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON request.")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object.")

    fields = await validate_custom_event_payload(user_id, data)

    event = await update_custom_event(
        discord_user_id=user_id,
        event_id=event_id,
        **fields,
    )

    if event is None:
        raise HTTPException(status_code=404, detail="Custom event not found.")

    event["completions"] = await get_custom_event_completions(
        user_id,
        event_id,
    )

    return {"success": True, "event": event}


# =========================================
# CUSTOM EVENTS — DELETE
# =========================================

@app.delete("/api/custom-events/{event_id}")
async def api_delete_custom_event(
    event_id: int,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    deleted = await delete_custom_event(user_id, event_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Custom event not found.")

    return {"success": True, "deleted_id": event_id}


# =========================================
# CUSTOM EVENTS — COMPLETE OCCURRENCE
# =========================================

@app.post("/api/custom-events/{event_id}/completion")
async def api_set_custom_event_completion(
    event_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid JSON request.",
        )

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=400,
            detail="Request body must be an object.",
        )

    completed = data.get("completed")

    if not isinstance(completed, bool):
        raise HTTPException(
            status_code=400,
            detail="'completed' must be true or false.",
        )

    # If supplied, completion belongs to a specific account.
    account_id = data.get("account_id")

    if account_id is not None:
        if (
            isinstance(account_id, bool)
            or not isinstance(account_id, int)
            or account_id < 1
        ):
            raise HTTPException(
                status_code=400,
                detail="'account_id' must be a valid account ID.",
            )

        accounts = await get_accounts(user_id)

        if not any(
            int(account["id"]) == account_id
            for account in accounts
        ):
            raise HTTPException(
                status_code=404,
                detail="Account not found.",
            )
            
    # Account-specific completion can be shared with any Discord user who has linked the same Genshin UID + server.
    if account_id is not None:
        event = await get_visible_custom_event(
            discord_user_id=user_id,
            event_id=event_id,
            account_id=account_id,
        )
    else:
        # Account-independent Overview completion remains creator-only.
        event = await get_custom_event(
            discord_user_id=user_id,
            event_id=event_id,
        )

    if event is None:
        raise HTTPException(
            status_code=404,
            detail="Custom event not found for this account.",
        )

    occurrence_value = data.get("occurrence_start")

    if occurrence_value:
        occurrence_start = parse_custom_event_datetime(
            occurrence_value,
            "Occurrence start",
        )
    else:
        if event["recurrence"].get("type", "none") != "none":
            raise HTTPException(
                status_code=400,
                detail="Recurring events require an occurrence_start.",
            )

        occurrence_start = event["start_at"]

    updated = await set_custom_event_completion(
        discord_user_id=user_id,
        event_id=event_id,
        occurrence_start=occurrence_start,
        completed=completed,
        account_id=account_id,
    )

    if not updated:
        raise HTTPException(
            status_code=404,
            detail="Custom event not found for this account.",
        )

    return {
        "success": True,
        "event_id": event_id,
        "account_id": account_id,
        "occurrence_start": occurrence_start,
        "completed": completed,
    }
    

# =========================================
# CUSTOM EVENTS — ACCOUNT OBJECTIVE PROGRESS
# =========================================

@app.post("/api/custom-events/{event_id}/progress")
async def api_change_custom_event_account_progress(
    event_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        data = await request.json()
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Invalid JSON request.",
        )

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=400,
            detail="Request body must be an object.",
        )

    account_id = data.get("account_id")
    objective_index = data.get("objective_index")
    amount = data.get("amount")

    # Validate the supplied values before using them.
    if (
        isinstance(account_id, bool)
        or not isinstance(account_id, int)
        or account_id < 1
    ):
        raise HTTPException(
            status_code=400,
            detail="'account_id' must be a valid account ID.",
        )

    if (
        isinstance(objective_index, bool)
        or not isinstance(objective_index, int)
        or objective_index < 0
    ):
        raise HTTPException(
            status_code=400,
            detail="'objective_index' must be a non-negative integer.",
        )

    if (
        isinstance(amount, bool)
        or not isinstance(amount, int)
        or amount not in (-1, 1)
    ):
        raise HTTPException(
            status_code=400,
            detail="'amount' must be -1 or 1.",
        )

    # The account must belong to the authenticated user.
    accounts = await get_accounts(user_id)

    if not any(
        int(account["id"]) == account_id
        for account in accounts
    ):
        raise HTTPException(
            status_code=404,
            detail="Account not found.",
        )

    # The event must be visible to the selected Genshin account.
    # Visibility is checked using Genshin UID + server, not the
    # Discord-specific accounts.id.
    event = await get_visible_custom_event(
        discord_user_id=user_id,
        event_id=event_id,
        account_id=account_id,
    )

    if event is None:
        raise HTTPException(
            status_code=404,
            detail="Custom event not found for this account.",
        )

    objectives = event.get("progress") or []

    if objective_index >= len(objectives):
        raise HTTPException(
            status_code=400,
            detail="Objective not found.",
        )

    objective = objectives[objective_index]
    target = objective.get("target")

    if (
        isinstance(target, bool)
        or not isinstance(target, int)
        or target < 1
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid objective target.",
        )

    current = await change_custom_event_account_progress(
        discord_user_id=user_id,
        event_id=event_id,
        account_id=account_id,
        objective_index=objective_index,
        amount=amount,
        target=target,
    )

    if current is None:
        raise HTTPException(
            status_code=409,
            detail="Objective progress could not be updated. Refresh and try again.",
        )

    return {
        "success": True,
        "event_id": event_id,
        "account_id": account_id,
        "objective_index": objective_index,
        "current": current,
        "target": target,
    }
    
    
@app.get(
    "/wishes",
    response_class=HTMLResponse,
)
async def wishes(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    session = await get_web_session(cyrene_session)
    if session is None:
        return RedirectResponse(
            url="/verify?next=/wishes",
            status_code=303,
        )

    accounts = await get_accounts(session.user_id)
    selected_account = next(
        (account for account in accounts if account["id"] == account_id),
        None,
    ) if account_id is not None else None
    if selected_account is None and accounts:
        selected_account = accounts[0]

    return templates.TemplateResponse(
        request=request,
        name="wishes.html",
        context={
            "request": request,
            "accounts": accounts,
            "selected_account": selected_account,
        },
    )


def _validated_wish_url(value: str) -> str:
    try:
        parsed = urlsplit(value.strip())
        port = parsed.port
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid wish-history URL.") from error

    valid_host = (
        parsed.hostname is not None
        and (
            parsed.hostname.endswith(".hoyoverse.com")
            or parsed.hostname.endswith(".mihoyo.com")
        )
    )
    if (
        parsed.scheme != "https"
        or not valid_host
        or port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {
            "/gacha_info/api/getGachaLog",
            "/gacha_info/api/getLdGachaLog",
        }
    ):
        raise HTTPException(status_code=400, detail="Use a valid HoYoverse wish-history URL.")

    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if not query.get("authkey"):
        raise HTTPException(status_code=400, detail="The wish-history URL has no auth key.")
    return value.strip()


async def _fetch_wishes_from_hoyoverse(source_url: str) -> list[dict]:
    parsed = urlsplit(source_url)
    base_query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    wishes: dict[str, dict] = {}
    timeout = aiohttp.ClientTimeout(total=20)

    async with aiohttp.ClientSession(timeout=timeout) as client:
        for gacha_type in ("100", "200", "301", "400", "302", "500"):
            end_id = "0"
            for _ in range(50):
                query = {
                    **base_query,
                    "gacha_type": gacha_type,
                    "page": "1",
                    "size": "20",
                    "end_id": end_id,
                }
                page_url = urlunsplit((
                    parsed.scheme,
                    parsed.netloc,
                    parsed.path,
                    urlencode(query),
                    "",
                ))
                try:
                    async with client.get(page_url, allow_redirects=False) as response:
                        if response.status != 200:
                            raise HTTPException(status_code=502, detail="HoYoverse rejected the wish-history request.")
                        payload = await response.json(content_type=None)
                except (aiohttp.ClientError, asyncio.TimeoutError) as error:
                    raise HTTPException(status_code=502, detail="Could not contact HoYoverse.") from error

                if not isinstance(payload, dict) or payload.get("retcode") != 0:
                    message = (
                        payload.get("message")
                        if isinstance(payload, dict)
                        else None
                    ) or "The wish-history URL has expired."
                    raise HTTPException(status_code=400, detail=message)

                page = (payload.get("data") or {}).get("list") or []
                if not page:
                    break

                for item in page:
                    wish_id = str(item.get("id") or "")
                    uid = str(item.get("uid") or "")
                    if not wish_id or not uid:
                        continue
                    try:
                        pulled_at = datetime.strptime(
                            str(item.get("time")),
                            "%Y-%m-%d %H:%M:%S",
                        )
                        rank_type = int(item.get("rank_type"))
                    except (TypeError, ValueError):
                        continue
                    wishes[wish_id] = {
                        "id": wish_id,
                        "uid": uid,
                        "gacha_type": str(item.get("gacha_type") or gacha_type),
                        "name": str(item.get("name") or "Unknown item"),
                        "item_type": str(item.get("item_type") or "Item"),
                        "rank_type": rank_type,
                        "pulled_at": pulled_at,
                    }

                next_end_id = str(page[-1].get("id") or "")
                if not next_end_id or next_end_id == end_id or len(page) < 20:
                    break
                end_id = next_end_id

    records = list(wishes.values())
    unique_items = {
        (wish["item_type"].casefold(), wish["name"])
        for wish in records
    }

    async def resolve_icon(item_type: str, name: str) -> tuple[tuple[str, str], str | None]:
        folder = "characters" if item_type == "character" else "weapons"
        try:
            item = await db.get(folder, name)
        except GenshinDBError:
            return (item_type, name), None
        filename = (item.get("images") or {}).get("filename_icon")
        icon_url = f"https://enka.network/ui/{filename}.png" if filename else None
        return (item_type, name), icon_url

    async with aiohttp.ClientSession(timeout=timeout) as catalogue_client:
        db = GenshinDB(catalogue_client)
        resolved = dict(await asyncio.gather(*(
            resolve_icon(item_type, name)
            for item_type, name in unique_items
            if item_type in {"character", "weapon"}
        )))
    for wish in records:
        wish["icon_url"] = resolved.get((wish["item_type"].casefold(), wish["name"]))
    return records


@app.get("/api/wishes")
async def wishes_data(
    account_id: int,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    await _get_achievement_account(user_id, account_id)
    records = await get_wish_history(account_id)
    return {
        "wishes": [
            {
                **record,
                "pulled_at": record["pulled_at"].isoformat(),
            }
            for record in records
        ]
    }


@app.post("/api/wishes/import")
async def import_wishes_api(
    request: Request,
    account_id: int,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    account = await _get_achievement_account(user_id, account_id)
    body = await request.json()
    source_url = _validated_wish_url(str(body.get("url") or ""))
    wishes = await _fetch_wishes_from_hoyoverse(source_url)
    returned_uids = {wish["uid"] for wish in wishes}
    if returned_uids and returned_uids != {str(account["genshin_uid"])}:
        raise HTTPException(
            status_code=409,
            detail="This wish history belongs to a different Genshin account.",
        )
    imported = await import_wish_history(account_id, wishes)
    return {"success": True, "imported": imported, "found": len(wishes)}


@app.get(
    "/achievements",
    response_class=HTMLResponse,
)
async def achievements(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    session = await get_web_session(
        cyrene_session
    )

    if session is None:
        return RedirectResponse(
            url="/verify?next=/achievements",
            status_code=303,
        )

    accounts = await get_accounts(session.user_id)
    selected_account = next(
        (
            account
            for account in accounts
            if account["id"] == account_id
        ),
        None,
    ) if account_id is not None else None

    if selected_account is None and accounts:
        selected_account = accounts[0]

    return templates.TemplateResponse(
        request=request,
        name="achievements.html",
        context={
            "request": request,
            "accounts": accounts,
            "selected_account": selected_account,
        },
    )


async def _get_achievement_account(
    user_id: int,
    account_id: int,
) -> dict:
    accounts = await get_accounts(user_id)
    account = next(
        (
            item
            for item in accounts
            if item["id"] == account_id
        ),
        None,
    )

    if account is None:
        raise HTTPException(
            status_code=404,
            detail="Genshin account not found.",
        )

    return account


@app.get("/api/achievements")
async def achievements_data(
    account_id: int,
    cyrene_session: str | None = Cookie(default=None)
):
    user_id = await get_authenticated_user(
        cyrene_session
    )

    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated."
        )

    await _get_achievement_account(user_id, account_id)

    source_achievements = load_achievements()
    saved_progress = await load_progress(
        user_id,
        account_id,
    )

    achievements = []

    categories = {}

    total_tiers = 0
    completed_tiers = 0

    for source in source_achievements:

        achievement_ids = source.get(
            "id",
            []
        )

        category = source.get(
            "achievementGroupName"
        )

        stage_count = source.get(
            "stages",
            0
        )

        if not achievement_ids or not category:
            continue

        if not isinstance(
            achievement_ids,
            list
        ):
            continue

        if not isinstance(
            stage_count,
            int
        ) or stage_count < 1:
            continue

        tiers = []

        for stage_number in range(
            1,
            stage_count + 1
        ):

            stage_key = (
                f"stage{stage_number}"
            )

            stage = source.get(
                stage_key
            )

            if not isinstance(
                stage,
                dict
            ):
                continue

            if stage_number > len(
                achievement_ids
            ):
                continue

            achievement_id = str(
                achievement_ids[
                    stage_number - 1
                ]
            )

            achievement_progress = (
                saved_progress.get(
                    achievement_id,
                    {}
                )
            )

            tier_progress = (
                achievement_progress.get(
                    "tiers",
                    {}
                )
            )

            tier_key = str(
                stage_number
            )

            saved_tier = (
                tier_progress.get(
                    tier_key,
                    {}
                )
            )

            completed = saved_tier.get(
                "completed",
                False
            )

            current = saved_tier.get(
                "current",
                0
            )

            timestamp = saved_tier.get(
                "timestamp"
            )

            note = saved_tier.get(
                "note"
            )

            reward = stage.get(
                "reward",
                {}
            )

            primogems = reward.get(
                "count",
                0
            )

            tiers.append({
                "tier": stage_number,
                "genshin_id": achievement_id,
                "title": stage.get(
                    "title",
                    source.get(
                        "name",
                        ""
                    )
                ),
                "description": stage.get(
                    "description",
                    ""
                ),
                "progress": stage.get(
                    "progress"
                ),
                "primogems": primogems,
                "completed": completed,
                "current": current,
                "timestamp": timestamp,
                "note": note,
            })

            total_tiers += 1

            if completed:
                completed_tiers += 1

        if not tiers:
            continue

        frontend_achievement = {
            "id": str(
                achievement_ids[0]
            ),
            "name": source.get(
                "name",
                ""
            ),
            "category": category,
            "version": source.get(
                "version"
            ),
            "tiers": tiers,
        }

        achievements.append(
            frontend_achievement
        )

        if category not in categories:
            categories[category] = {
                "total": 0,
                "completed": 0,
            }

        categories[category]["total"] += len(
            tiers
        )

        categories[category]["completed"] += sum(
            1
            for tier in tiers
            if tier["completed"]
        )

    return {
        "achievements": achievements,
        "categories": categories,
        "total": total_tiers,
        "completed": completed_tiers,
    }


@app.patch("/api/achievements/{achievement_id}/tiers/{tier}")
async def update_achievement_tier_api(
    achievement_id: str,
    tier: int,
    account_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(
        cyrene_session
    )

    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated."
        )

    await _get_achievement_account(user_id, account_id)
    body = await request.json()

    completed = body.get("completed")

    if not isinstance(completed, bool):
        raise HTTPException(
            status_code=400,
            detail="The 'completed' field must be a boolean."
        )

    updated = await update_achievement_tier(
        discord_user_id=user_id,
        account_id=account_id,
        achievement_id=achievement_id,
        tier=tier,
        completed=completed,
    )

    return {
        "success": True,
        "updated": updated,
        "achievement_id": achievement_id,
        "tier": tier,
        "completed": completed
    }


@app.patch("/api/achievements/{achievement_id}/tiers/{tier}/note")
async def update_achievement_tier_note_api(
    achievement_id: str,
    tier: int,
    account_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(
        cyrene_session
    )

    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated."
        )

    await _get_achievement_account(user_id, account_id)
    body = await request.json()

    note = body.get("note")

    if note is not None and not isinstance(note, str):
        raise HTTPException(
            status_code=400,
            detail="The 'note' field must be a string or null."
        )

    if isinstance(note, str):
        note = note.strip()

        if not note:
            note = None

    updated = await update_achievement_tier(
        discord_user_id=user_id,
        account_id=account_id,
        achievement_id=achievement_id,
        tier=tier,
        note=note,
    )

    return {
        "success": True,
        "updated": updated,
        "achievement_id": achievement_id,
        "tier": tier,
        "note": note,
    }


@app.post("/api/achievements/import")
async def import_achievements_api(
    request: Request,
    account_id: int,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(
        cyrene_session
    )

    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated."
        )

    await _get_achievement_account(user_id, account_id)
    form = await request.form()

    uploaded_file = form.get(
        "file"
    )

    if uploaded_file is None:
        raise HTTPException(
            status_code=400,
            detail="No achievement export was provided."
        )

    if not hasattr(
        uploaded_file,
        "read"
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid upload."
        )

    with tempfile.NamedTemporaryFile(
        suffix=".json",
        delete=False
    ) as temp_file:

        content = await uploaded_file.read()

        temp_file.write(content)

        temp_path = temp_file.name

    try:

        result = await import_achievements(
            user_id=user_id,
            account_id=account_id,
            export_file=temp_path,
        )

    finally:

        Path(temp_path).unlink(
            missing_ok=True
        )

    return result


@app.get(
    "/challenge/{token}",
    response_class=HTMLResponse,
)
async def challenge(token: str):
    session = get_challenge_session(token)

    if session is None:
        return HTMLResponse(
            content="""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Cyrene • Challenge Expired</title>
            </head>
            <body>
                <h1>Challenge Expired</h1>
                <p>
                    This authentication challenge has expired
                    or is no longer valid.
                </p>
            </body>
            </html>
            """,
            status_code=410,
        )

    if session.completed:
        return HTMLResponse(
            content="""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Cyrene • Challenge Completed</title>
            </head>
            <body>
                <h1>Challenge Already Completed</h1>
                <p>
                    This authentication challenge has already
                    been completed.
                </p>
            </body>
            </html>
            """,
            status_code=410,
        )

    mmt = session.mmt

    print("===== GEETEST MMT =====")
    print(mmt)
    print(mmt.model_dump())
    print(f"Type: {type(mmt).__name__}")
    print("=======================")

    is_v4 = isinstance(mmt, SessionMMTv4)

    if is_v4:
        gt_url = "https://static.geetest.com/v4/gt4.js"

        captcha_script = f"""
        const mmt = {mmt.model_dump_json()};

        const initParams = {{
            captchaId: mmt.captcha_id ?? mmt.gt,
            riskType: mmt.risk_type,
            userInfo: mmt.session_id
                ? JSON.stringify({{
                    mmt_key: mmt.session_id
                }})
                : undefined,
            apiServers: ["api-na.geetest.com"],
            product: "bind",
            language: "en"
        }};

        console.log("===== GEETEST INIT =====");
        console.log(initParams);
        console.log("========================");

        initGeetest4(
            initParams,
            (captcha) => {{

                captcha.onReady(() => {{
                    console.log("Geetest v4 ready");
                    captcha.showCaptcha();
                }});

                captcha.onSuccess(async () => {{

                    const result = captcha.getValidate();

                    console.log("===== GEETEST RESULT =====");
                    console.log(result);
                    console.log("==========================");

                    const response = await fetch(
                        "/challenge/{token}/send-data",
                        {{
                            method: "POST",

                            headers: {{
                                "Content-Type": "application/json"
                            }},

                            body: JSON.stringify({{
                                ...(mmt.session_id && {{
                                    session_id: mmt.session_id
                                }}),

                                ...(mmt.check_id && {{
                                    check_id: mmt.check_id
                                }}),

                                ...result
                            }})
                        }}
                    );

                    if (!response.ok) {{
                        console.error(
                            "Failed to submit CAPTCHA:",
                            await response.text()
                        );
                        return;
                    }}

                    showSuccess();
                }});

                captcha.onError((error) => {{
                    console.error("==== GEETEST ERROR ====");
                    console.error(error);
                    console.error("======================");
                }});
            }}
        );
        """

    else:
        gt_url = "https://static.geetest.com/static/js/gt.0.5.0.js"

        captcha_script = f"""
        const mmt = {mmt.model_dump_json()};

        const initParams = {{
            gt: mmt.gt,
            challenge: mmt.challenge,
            new_captcha: mmt.new_captcha,
            api_server: "api-na.geetest.com",
            https: /^https/i.test(window.location.protocol),
            product: "bind",
            lang: "en"
        }};

        console.log("===== GEETEST INIT =====");
        console.log(initParams);
        console.log("========================");

        initGeetest(
            initParams,
            (captcha) => {{

                captcha.onReady(() => {{
                    console.log("Geetest v3 ready");
                    captcha.verify();
                }});

                captcha.onSuccess(async () => {{

                    const result = captcha.getValidate();

                    console.log("===== GEETEST RESULT =====");
                    console.log(result);
                    console.log("==========================");

                    const response = await fetch(
                        "/challenge/{token}/send-data",
                        {{
                            method: "POST",

                            headers: {{
                                "Content-Type": "application/json"
                            }},

                            body: JSON.stringify({{
                                session_id: mmt.session_id,
                                geetest_challenge:
                                    result.geetest_challenge,
                                geetest_validate:
                                    result.geetest_validate,
                                geetest_seccode:
                                    result.geetest_seccode
                            }})
                        }}
                    );

                    if (!response.ok) {{
                        console.error(
                            "Failed to submit CAPTCHA:",
                            await response.text()
                        );
                        return;
                    }}

                    showSuccess();
                }});

                captcha.onError((error) => {{
                    console.error("==== GEETEST ERROR ====");
                    console.error(error);
                    console.error("======================");
                }});
            }}
        );
        """

    return HTMLResponse(
        content=f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">

            <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
            >

            <meta
                name="referrer"
                content="no-referrer"
            >

            <title>Cyrene • HoYoLAB Verification</title>

            <script src="{gt_url}"></script>

            <style>
                body {{
                    margin: 0;
                    min-height: 100vh;

                    display: flex;
                    align-items: center;
                    justify-content: center;

                    background-color: #0f1117;
                    color: #ffffff;

                    font-family: Arial, sans-serif;
                }}

                .container {{
                    width: min(90%, 500px);
                    padding: 40px;

                    background-color: #181b24;
                    border-radius: 16px;

                    text-align: center;
                    box-sizing: border-box;
                }}

                h1 {{
                    margin-bottom: 16px;
                }}

                p {{
                    color: #b8bdc9;
                    line-height: 1.6;
                }}

                #captcha {{
                    margin-top: 24px;
                }}

                .success-screen {{ min-height:100vh; display:flex; align-items:center; justify-content:center; flex-direction:column; background:#0f1117; text-align:center; animation:success-in 300ms ease-out both; }}
                .success-icon {{ position:relative; width:112px; height:112px; color:#59d58b; }}
                .success-corner {{ position:absolute; width:31px; height:31px; border-color:currentColor; border-style:solid; opacity:0; animation:frame-in 420ms cubic-bezier(.2,.8,.2,1) forwards; }}
                .success-corner.tl {{ top:0; left:0; border-width:4px 0 0 4px; border-radius:14px 0 0; }}
                .success-corner.tr {{ top:0; right:0; border-width:4px 4px 0 0; border-radius:0 14px 0 0; }}
                .success-corner.bl {{ bottom:0; left:0; border-width:0 0 4px 4px; border-radius:0 0 0 14px; }}
                .success-corner.br {{ right:0; bottom:0; border-width:0 4px 4px 0; border-radius:0 0 14px; }}
                .success-scan {{ position:absolute; top:18px; right:16px; left:16px; height:2px; border-radius:999px; background:currentColor; box-shadow:0 0 12px currentColor; opacity:0; animation:scan 700ms 280ms ease-in-out both; }}
                .success-check {{ position:absolute; inset:20px; width:72px; height:72px; }}
                .success-check path {{ fill:none; stroke:currentColor; stroke-width:5; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:50; stroke-dashoffset:50; animation:check-in 440ms 850ms ease-out forwards; }}
                .success-screen h1 {{ margin:24px 0 6px; }}
                .success-screen p {{ margin:0; }}
                @keyframes success-in {{ from {{ opacity:0; transform:scale(.97); }} to {{ opacity:1; transform:scale(1); }} }}
                @keyframes frame-in {{ from {{ opacity:0; transform:scale(.78); }} to {{ opacity:1; transform:scale(1); }} }}
                @keyframes scan {{ 0% {{ opacity:0; transform:translateY(0); }} 18%,82% {{ opacity:.9; }} 100% {{ opacity:0; transform:translateY(74px); }} }}
                @keyframes check-in {{ to {{ stroke-dashoffset:0; }} }}
                @media (prefers-reduced-motion: reduce) {{ .success-screen, .success-corner, .success-scan, .success-check path {{ animation-duration:1ms; animation-delay:0ms; }} }}
            </style>
        </head>

        <body>
            <div class="container">

                <h1>Verification Required</h1>

                <p>
                    Cyrene encountered a CAPTCHA during your
                    HoYoLAB authentication.
                </p>

                <p>
                    Complete the CAPTCHA below to continue.
                </p>

                <div id="captcha"></div>

            </div>

            <script>

                function showSuccess() {{
                    document.body.innerHTML = `
                        <div class="success-screen" role="status">
                            <div class="success-icon" aria-hidden="true">
                                <span class="success-corner tl"></span>
                                <span class="success-corner tr"></span>
                                <span class="success-corner bl"></span>
                                <span class="success-corner br"></span>
                                <span class="success-scan"></span>
                                <svg class="success-check" viewBox="0 0 64 64">
                                    <path d="M17 33.5 27.5 44 48 22"></path>
                                </svg>
                            </div>
                            <h1>CAPTCHA verified</h1>
                            <p>
                                Cyrene will continue automatically. This page
                                will close in <span id="close-countdown">3</span> seconds.
                            </p>
                        </div>
                    `;

                    let secondsRemaining = 3;
                    const countdown = document.getElementById("close-countdown");

                    const countdownTimer = window.setInterval(() => {{
                        secondsRemaining -= 1;

                        if (secondsRemaining > 0) {{
                            countdown.textContent = secondsRemaining;
                            return;
                        }}

                        window.clearInterval(countdownTimer);
                        window.close();
                    }}, 1000);

                }}

                {captcha_script}

            </script>
        </body>
        </html>
        """,
    )


@app.post(
    "/challenge/{token}/send-data",
)
async def challenge_send_data(
    token: str,
    data: dict[str, typing.Any],
):
    session = get_challenge_session(token)

    if session is None:
        raise HTTPException(
            status_code=410,
            detail="This challenge has expired.",
        )

    if session.completed:
        raise HTTPException(
            status_code=410,
            detail="This challenge has already been completed.",
        )

    try:
        if isinstance(session.mmt, SessionMMTv4):
            result = SessionMMTv4Result(**data)
        else:
            result = SessionMMTResult(**data)

    except Exception as error:
        print("===== CAPTCHA RESULT ERROR =====")
        print(f"Type: {type(error).__name__}")
        print(f"Error: {error}")
        print(f"Data: {data}")
        print("================================")

        raise HTTPException(
            status_code=400,
            detail="Invalid CAPTCHA result.",
        ) from error

    complete_challenge(
        token,
        result,
    )

    return {
        "success": True,
    }
