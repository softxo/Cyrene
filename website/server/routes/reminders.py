"""Reminders page and the reminder APIs."""

import asyncio
import logging
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

import aiohttp
from fastapi import APIRouter, Cookie, HTTPException, Request
from fastapi.responses import HTMLResponse
from psycopg.errors import UniqueViolation

from shared.genshin_db import GenshinDB, GenshinDBError
from shared.hoyolab.account_client import get_account_client
from shared.hoyolab.daily_note import (
    get_expeditions,
    get_home_coin,
    get_resin,
    get_transformer_status,
)
from shared.hoyolab.expedition_icons import EXPEDITION_ICONS
from shared.storage.database import (
    create_reminder,
    delete_reminder,
    get_accounts,
    get_reminder,
    get_reminders,
    update_reminder,
)
from website.server.core.auth import get_authenticated_user, get_web_session, verification_redirect
from website.server.core.templating import templates

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get(
    "/reminders",
    response_class=HTMLResponse,
)
async def planner(request: Request, cyrene_session: str | None = Cookie(default=None)):
    session = await get_web_session(cyrene_session)

    if session is None:
        return verification_redirect("/reminders")

    return templates.TemplateResponse(
        request=request,
        name="reminders.html",
        context={
            "request": request,
            "accounts": await get_accounts(session.user_id),
        },
    )


def _planner_expedition_icon(icon_url: str) -> tuple[str, str, str | None]:
    try:
        parsed = urlsplit(icon_url)
        port = parsed.port
    except ValueError:
        return "", "Unknown", None

    hostname = (parsed.hostname or "").lower().rstrip(".")
    trusted_domains = ("mihoyo.com", "hoyoverse.com", "hoyolab.com", "enka.network")
    trusted_host = any(
        hostname == domain or hostname.endswith(f".{domain}") for domain in trusted_domains
    )
    filename = parsed.path.rstrip("/").rsplit("/", 1)[-1]
    icon_hash = filename[:-4].lower() if filename.lower().endswith(".png") else ""
    character_name = EXPEDITION_ICONS.get(icon_hash, "Unknown")

    if (
        parsed.scheme != "https"
        or not trusted_host
        or port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or not re.fullmatch(r"[a-f0-9]{32}", icon_hash)
        or character_name == "Unknown"
        or filename.lower() != f"{icon_hash}.png"
    ):
        return "", character_name, None

    return icon_hash, character_name, parsed.geturl()


_planner_character_icon_cache: dict[str, tuple[float, str | None]] = {}
_planner_character_icon_tasks: dict[str, asyncio.Task] = {}
_planner_character_icon_semaphore = asyncio.Semaphore(4)


async def _planner_character_portrait(character_name: str, catalogue: GenshinDB) -> str | None:
    cache_key = character_name.strip().casefold()
    if not cache_key or cache_key == "unknown":
        return None

    now = time.monotonic()
    cached = _planner_character_icon_cache.get(cache_key)
    if cached and cached[0] > now:
        return cached[1]

    portrait = None
    try:
        character = await asyncio.wait_for(
            catalogue.get("characters", character_name),
            timeout=2.5,
        )
        filename = (character.get("images") or {}).get("filename_icon")
        if isinstance(filename, str) and re.fullmatch(r"[A-Za-z0-9_]+", filename):
            portrait = f"https://enka.network/ui/{filename}.png"
    except GenshinDBError, asyncio.TimeoutError, aiohttp.ClientError, ValueError, TypeError:
        pass

    cache_ttl = 24 * 60 * 60 if portrait else 60
    _planner_character_icon_cache[cache_key] = (now + cache_ttl, portrait)
    return portrait


async def _refresh_planner_character_portrait(character_name: str, cache_key: str) -> None:
    try:
        async with _planner_character_icon_semaphore:
            async with aiohttp.ClientSession() as catalogue_client:
                await _planner_character_portrait(
                    character_name,
                    GenshinDB(catalogue_client),
                )
    except Exception:
        logger.warning(
            "Could not refresh the planner portrait for %s.", character_name, exc_info=True
        )
        _planner_character_icon_cache[cache_key] = (
            time.monotonic() + 60,
            None,
        )
    finally:
        task = asyncio.current_task()
        if _planner_character_icon_tasks.get(cache_key) is task:
            _planner_character_icon_tasks.pop(cache_key, None)


def _schedule_planner_character_portrait(character_name: str) -> asyncio.Task | None:
    cache_key = character_name.strip().casefold()
    if not cache_key or cache_key == "unknown":
        return None

    cached = _planner_character_icon_cache.get(cache_key)
    if cached and cached[0] > time.monotonic():
        return None

    task = _planner_character_icon_tasks.get(cache_key)
    if task and not task.done():
        return task

    task = asyncio.create_task(_refresh_planner_character_portrait(character_name, cache_key))
    _planner_character_icon_tasks[cache_key] = task
    return task


@router.get("/api/reminders")
async def planner_data(cyrene_session: str | None = Cookie(default=None)):
    user_id = await get_authenticated_user(cyrene_session)
    accounts, reminders = await asyncio.gather(
        get_accounts(user_id),
        get_reminders(user_id),
    )
    portrait_tasks = set()

    async def load_planner_account(account):
        client = await get_account_client(user_id, account["genshin_uid"])

        if client is None:
            return None

        try:
            async with client:
                response = await client.get_genshin_daily_note(
                    client.genshin_uid, client.genshin_server
                )

            current_resin, max_resin, recovery = get_resin(response)
            raw_expeditions = get_expeditions(response)

        except Exception:
            logger.exception("Could not read the daily note for the reminders page.")

            return None

        now = int(time.time())
        expeditions = []
        for slot, expedition in enumerate(
            raw_expeditions if isinstance(raw_expeditions, list) else []
        ):
            if not isinstance(expedition, dict):
                continue

            try:
                remaining_seconds = max(0, int(expedition.get("remained_time", 0) or 0))
            except TypeError, ValueError:
                remaining_seconds = 0

            status = str(expedition.get("status") or "Unknown")
            if status == "Ongoing" and remaining_seconds == 0:
                status = "Finished"

            icon_url = str(expedition.get("avatar_side_icon") or "")
            icon_hash, character_name, fallback_icon = _planner_expedition_icon(icon_url)
            lookup_name = character_name.replace("_", " ")
            if icon_hash:
                portrait_task = _schedule_planner_character_portrait(lookup_name)
                if portrait_task:
                    portrait_tasks.add(portrait_task)

            expeditions.append(
                {
                    "slot": slot,
                    "character_name": lookup_name,
                    "character_icon_hash": icon_hash,
                    "character_icon": fallback_icon,
                    "character_icon_fallback": fallback_icon,
                    "status": status,
                    "remaining_seconds": remaining_seconds,
                    "finishes_at": now + remaining_seconds if status == "Ongoing" else None,
                }
            )

        teapot = None
        try:
            current_coin, max_coin, coin_recovery = get_home_coin(response)
            teapot = {
                "current": current_coin,
                "maximum": max_coin,
                "full_at": now + coin_recovery if current_coin < max_coin else None,
            }
        except KeyError, TypeError, ValueError:
            pass

        transformer = None
        try:
            transformer = get_transformer_status(response)
            transformer["ready_at"] = (
                now + transformer.pop("remaining_seconds") if transformer["obtained"] else None
            )
        except KeyError, TypeError, ValueError:
            pass

        replenished_at = None
        full_resin_at = None

        if current_resin < max_resin:
            remaining_resin = max_resin - current_resin
            replenished_at = int(time.time()) + recovery
            full_resin_at = int(time.time()) + recovery + ((remaining_resin - 1) * 480)

        return {
            "genshin_uid": account["genshin_uid"],
            "nickname": account.get("nickname"),
            "cyrene_nickname": account.get("cyrene_nickname"),
            "level": account.get("level"),
            "genshin_server": account["genshin_server"],
            "current_resin": current_resin,
            "max_resin": max_resin,
            "replenished_at": replenished_at,
            "full_resin_at": full_resin_at,
            "expeditions": expeditions,
            "teapot": teapot,
            "transformer": transformer,
        }

    loaded_accounts = await asyncio.gather(*(load_planner_account(account) for account in accounts))
    if portrait_tasks:
        await asyncio.gather(*portrait_tasks)

    for account in loaded_accounts:
        if account is None:
            continue
        for expedition in account["expeditions"]:
            cache_key = expedition["character_name"].strip().casefold()
            cached_portrait = _planner_character_icon_cache.get(cache_key)
            if cached_portrait and cached_portrait[0] > time.monotonic() and cached_portrait[1]:
                expedition["character_icon"] = cached_portrait[1]
    planner_accounts = [account for account in loaded_accounts if account is not None]
    planner_reminders = []

    for reminder in reminders:
        if not reminder.get("enabled"):
            continue

        config = reminder.get("config") or {}
        account = next(
            (account for account in accounts if account["genshin_uid"] == reminder["genshin_uid"]),
            None,
        )

        planner_reminders.append(
            {
                "id": reminder["id"],
                "account_nickname": (
                    account.get("cyrene_nickname") or account.get("nickname") if account else None
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


def _validate_realm_currency_amount(value, maximum=2400) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise HTTPException(
            status_code=400,
            detail=f"Realm Currency must be a whole number between 1 and {maximum}.",
        )
    return value


async def _realm_currency_capacity(user_id: int, uid: str) -> int:
    try:
        client = await get_account_client(user_id, uid)
        if client is None:
            raise ValueError("Account is unavailable")
        async with client:
            response = await client.get_genshin_daily_note(
                client.genshin_uid, client.genshin_server
            )
        _, maximum, _ = get_home_coin(response)
        return maximum
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Could not verify this account's Realm Currency capacity. Please refresh and try again.",
        ) from None


@router.post("/api/reminders")
async def create_planner_reminder(data: dict, cyrene_session: str | None = Cookie(default=None)):
    user_id = await get_authenticated_user(cyrene_session)
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
        raise HTTPException(status_code=400, detail="Invalid reminder type.")

    if reminder_mode not in valid_modes:
        raise HTTPException(status_code=400, detail="Invalid reminder mode.")

    if delivery_type not in valid_delivery_types:
        raise HTTPException(status_code=400, detail="Invalid delivery type.")

    if not isinstance(config, dict):
        raise HTTPException(status_code=400, detail="Invalid reminder configuration.")

    accounts = await get_accounts(user_id)

    if not accounts:
        raise HTTPException(status_code=404, detail="No Genshin account linked.")

    if not genshin_uid:
        raise HTTPException(status_code=400, detail="A Genshin account is required.")

    account = next(
        (account for account in accounts if account["genshin_uid"] == genshin_uid),
        None,
    )

    if account is None:
        raise HTTPException(status_code=400, detail="Invalid Genshin account.")

    if reminder_type == "resin":
        amount = config.get("amount")

        try:
            amount = int(amount)
        except TypeError, ValueError:
            raise HTTPException(status_code=400, detail="Invalid Resin amount.")

        if not 1 <= amount <= 200:
            raise HTTPException(status_code=400, detail="Resin must be between 1 and 200.")

        config["amount"] = amount

    if reminder_type == "teapot":
        maximum = await _realm_currency_capacity(user_id, genshin_uid)
        config = {"amount": _validate_realm_currency_amount(config.get("amount", maximum), maximum)}

    if reminder_mode == "automatic":
        if reminder_type == "custom":
            raise HTTPException(
                status_code=400, detail="Custom reminders cannot use automatic mode."
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


@router.patch("/api/reminders/{reminder_id}")
async def update_planner_reminder(
    reminder_id: int, data: dict, cyrene_session: str | None = Cookie(default=None)
):
    user_id = await get_authenticated_user(cyrene_session)
    reminder = await get_reminder(user_id, reminder_id)

    if reminder is None:
        raise HTTPException(status_code=404, detail="Reminder not found.")

    enabled = data.get("enabled")
    config = data.get("config")
    reminder_mode = data.get("mode")

    if enabled is not None:
        if not isinstance(enabled, bool):
            raise HTTPException(status_code=400, detail="Invalid enabled value.")

    if config is not None:
        if not isinstance(config, dict):
            raise HTTPException(status_code=400, detail="Invalid reminder configuration.")

        if reminder["reminder_type"] == "resin":
            amount = config.get("amount")

            try:
                amount = int(amount)
            except TypeError, ValueError:
                raise HTTPException(status_code=400, detail="Invalid Resin amount.")

            if not 1 <= amount <= 200:
                raise HTTPException(status_code=400, detail="Resin must be between 1 and 200.")

            config["amount"] = amount

        if reminder["reminder_type"] == "teapot":
            maximum = await _realm_currency_capacity(user_id, reminder["genshin_uid"])
            config = {"amount": _validate_realm_currency_amount(config.get("amount"), maximum)}

    if reminder_mode is not None:
        if reminder_mode not in {"automatic", "manual"}:
            raise HTTPException(status_code=400, detail="Invalid reminder mode.")
        if reminder_mode == "automatic" and reminder["reminder_type"] == "custom":
            raise HTTPException(
                status_code=400, detail="Custom reminders cannot use automatic mode."
            )

        if reminder_mode != reminder["reminder_mode"]:
            existing = await get_reminders(user_id)
            if any(
                str(item["id"]) != str(reminder["id"])
                and item.get("genshin_uid") == reminder.get("genshin_uid")
                and item.get("reminder_type") == reminder.get("reminder_type")
                and item.get("reminder_mode") == reminder_mode
                for item in existing
            ):
                raise HTTPException(
                    status_code=409,
                    detail=f"A {reminder_mode} reminder of this type already exists for this account.",
                )

    try:
        updated = await update_reminder(
            discord_user_id=user_id,
            reminder_id=reminder_id,
            enabled=enabled,
            config=config,
            reminder_mode=reminder_mode,
        )
    except UniqueViolation:
        raise HTTPException(
            status_code=409,
            detail=f"A {reminder_mode} reminder of this type already exists for this account.",
        ) from None

    if not updated:
        raise HTTPException(status_code=400, detail="Nothing to update.")

    return {
        "success": True,
    }


@router.delete("/api/reminders/{reminder_id}")
async def delete_planner_reminder(
    reminder_id: int, cyrene_session: str | None = Cookie(default=None)
):
    user_id = await get_authenticated_user(cyrene_session)
    deleted = await delete_reminder(user_id, reminder_id)

    if not deleted:
        raise HTTPException(status_code=404, detail="Reminder not found.")

    return {
        "success": True,
    }
