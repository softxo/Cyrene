"""HoYoLAB account linking and management APIs."""

import asyncio
import logging
import time
import typing
import uuid

from fastapi import APIRouter, Cookie, HTTPException
from fastapi.responses import JSONResponse

from shared.hoyolab.challenge_sessions import EmailChallenge, get_challenge_session
from shared.hoyolab.errors import (
    HoYoLABAccountLockedError,
    HoYoLABAccountMutedError,
    HoYoLABAccountNotFoundError,
    HoYoLABAuthenticationError,
    HoYoLABCaptchaError,
    HoYoLABError,
    HoYoLABRateLimitError,
    HoYoLABVerificationError,
)
from shared.hoyolab.login import login_with_password
from shared.storage.account_limits import get_account_limit
from shared.storage.accounts import get_genshin_accounts
from shared.storage.database import (
    delete_account,
    get_account,
    get_account_count,
    get_accounts,
    save_account,
    update_account_nickname,
)
from website.server.core.auth import get_account_discord_access, get_authenticated_user

logger = logging.getLogger(__name__)

router = APIRouter()

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
        return (
            error.public_message or "HoYoLAB verification could not be completed. Please try again."
        )
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
        challenge_session = get_challenge_session(challenge_url.rsplit("/", 1)[-1])
        attempt["status"] = (
            "email"
            if challenge_session and isinstance(challenge_session.mmt, EmailChallenge)
            else "captcha"
        )
        attempt["challenge_url"] = challenge_url

    async def challenge_complete() -> None:
        attempt["status"] = "authenticating"
        attempt["challenge_url"] = None

    try:
        client, credentials = await login_with_password(
            account,
            password,
            user_id=attempt["user_id"],
            notify=notify,
            link_token=token,
            on_challenge_complete=challenge_complete,
        )
        accounts = await get_genshin_accounts(client)

        if not accounts:
            attempt["status"] = "error"
            attempt["error"] = "No Genshin accounts are linked to this HoYoLAB account."
            return

        attempt["credentials"] = credentials
        attempt["accounts"] = accounts
        attempt["status"] = "select"

    except HoYoLABError as error:
        attempt["status"] = "error"
        attempt["error"] = _account_link_error(error)

    except Exception as error:
        logger.exception("Linking a HoYoLAB account from the website failed.")

        attempt["status"] = "error"
        attempt["error"] = _account_link_error(error)


@router.post("/api/hoyolab/link/start")
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
    task = asyncio.create_task(_run_web_account_login(token, account, password))
    _account_link_tasks.add(task)
    task.add_done_callback(_account_link_tasks.discard)

    return {"success": True, "token": token}


@router.get("/api/hoyolab/accounts")
async def web_hoyolab_accounts(
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    accounts = await get_accounts(user_id)
    discord_access = await get_account_discord_access(user_id) if accounts else {}

    return {
        "accounts": [
            {
                "uid": account["genshin_uid"],
                "nickname": account["nickname"],
                "cyrene_nickname": account["cyrene_nickname"],
                "level": account["level"],
                "server": account["genshin_server"],
                "discord_access": discord_access.get(
                    (str(account["genshin_uid"]), account["genshin_server"]), []
                ),
            }
            for account in accounts
        ],
    }


@router.patch("/api/hoyolab/accounts/{uid}")
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


@router.delete("/api/hoyolab/accounts/{uid}")
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


@router.get("/api/hoyolab/link/status")
async def hoyolab_link_status(
    token: str,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    attempt = _get_account_link_attempt(token, user_id)
    response = {"status": attempt["status"]}

    if attempt["status"] == "captcha":
        response["challenge_url"] = attempt["challenge_url"]
    elif attempt["status"] == "email":
        challenge_token = attempt["challenge_url"].rsplit("/", 1)[-1]
        response["submission_url"] = f"/challenge/{challenge_token}/send-data"
    elif attempt["status"] == "select":
        response["accounts"] = attempt["accounts"]
    elif attempt["status"] == "error":
        response["error"] = attempt["error"]
    elif attempt["status"] == "complete":
        response["result"] = attempt["result"]

    return JSONResponse(response, headers={"Cache-Control": "no-store"})


@router.post("/api/hoyolab/link/complete")
async def complete_hoyolab_link(
    data: dict[str, typing.Any],
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    token = str(data.get("token") or "")
    attempt = _get_account_link_attempt(token, user_id)
    async with attempt.setdefault("completion_lock", asyncio.Lock()):
        if attempt["status"] == "complete":
            if str(data.get("uid") or "") != attempt["result"]["account"]["game_uid"]:
                raise HTTPException(
                    status_code=409, detail="This login has already linked an account."
                )
            return attempt["result"]
        return await _save_hoyolab_link(data, user_id, attempt)


async def _save_hoyolab_link(data: dict, user_id: int, attempt: dict):
    selected_uid = str(data.get("uid") or "")

    if attempt["status"] != "select":
        raise HTTPException(
            status_code=409,
            detail="The HoYoLAB login is not ready for account selection.",
        )

    account = next(
        (item for item in attempt["accounts"] if item["game_uid"] == selected_uid),
        None,
    )

    if account is None:
        raise HTTPException(status_code=400, detail="Select a valid account.")

    existing_account = await get_account(user_id, selected_uid)
    account_count = await get_account_count(user_id)
    account_limit = get_account_limit(user_id)

    if existing_account is None and account_limit is not None and account_count >= account_limit:
        raise HTTPException(
            status_code=409,
            detail=f"You have reached your limit of {account_limit} linked accounts.",
        )

    await save_account(
        user_id,
        attempt["credentials"],
        discord_username=(existing_account["discord_username"] if existing_account else None),
        discord_display_name=(
            existing_account["discord_display_name"] if existing_account else None
        ),
        discord_guild_id=(existing_account["discord_guild_id"] if existing_account else None),
        discord_guild_name=(existing_account["discord_guild_name"] if existing_account else None),
        genshin_uid=account["game_uid"],
        genshin_server=account["region"],
        nickname=account["nickname"],
        cyrene_nickname=(existing_account["cyrene_nickname"] if existing_account else None),
        level=account["level"],
    )

    result = {
        "success": True,
        "account": account,
        "reconnected": existing_account is not None,
    }
    attempt["status"] = "complete"
    attempt["result"] = result
    attempt["credentials"] = None
    return result
