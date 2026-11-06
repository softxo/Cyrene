"""Refresh game-owned profile fields without changing local account aliases."""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from .client import HoYoLABClient

logger = logging.getLogger(__name__)
REFRESH_INTERVAL = timedelta(minutes=15)
_semaphore = asyncio.Semaphore(4)
_pending: dict[tuple[str, str], asyncio.Task] = {}


async def _refresh(account: dict) -> dict | None:
    from .database import get_pool

    now = datetime.now(timezone.utc)
    profile = None
    try:
        async with _semaphore:
            async with asyncio.timeout(8):
                async with HoYoLABClient(account["credentials"]) as client:
                    try:
                        response = await client.get_game_roles()
                    except Exception:
                        response = None
                    if not response or response.get("retcode") != 0:
                        response = await client.get_game_roles_by_ltoken()
        if response.get("retcode") != 0:
            raise ValueError("HoYoLAB rejected the profile request")
        role = next(
            (
                item
                for item in response.get("data", {}).get("list", [])
                if item.get("game_biz") == "hk4e_global"
                and str(item.get("game_uid")) == str(account["genshin_uid"])
                and item.get("region") == account["genshin_server"]
            ),
            None,
        )
        if role is None:
            raise ValueError("Linked role is absent from the response")
        nickname = role.get("nickname")
        level = int(role.get("level"))
        if not isinstance(nickname, str) or not nickname.strip() or not 1 <= level <= 60:
            raise ValueError("Invalid game profile")
        profile = {"nickname": nickname.strip()[:100], "level": level}
    except Exception:
        logger.warning(
            "Could not refresh game profile for UID %s; keeping saved details.",
            account["genshin_uid"],
        )

    async with get_pool().connection() as connection:
        if profile:
            await connection.execute(
                """UPDATE accounts SET nickname=%s, level=%s, profile_checked_at=%s
                   WHERE genshin_uid=%s AND genshin_server=%s
                   AND EXISTS (SELECT 1 FROM accounts source WHERE source.id=%s
                       AND source.genshin_uid=%s AND source.genshin_server=%s)""",
                (
                    profile["nickname"],
                    profile["level"],
                    now,
                    account["genshin_uid"],
                    account["genshin_server"],
                    account["id"],
                    account["genshin_uid"],
                    account["genshin_server"],
                ),
            )
        else:
            await connection.execute(
                "UPDATE accounts SET profile_checked_at=%s WHERE id=%s", (now, account["id"])
            )
        await connection.commit()
    return profile


async def refresh_account_profiles(accounts: list[dict]) -> None:
    async def refresh(account):
        checked = account.get("profile_checked_at")
        if checked and datetime.now(timezone.utc) - checked < REFRESH_INTERVAL:
            return
        key = (str(account["genshin_uid"]), account["genshin_server"])
        task = _pending.get(key)
        if task is None:
            task = asyncio.create_task(_refresh(account))
            _pending[key] = task
            task.add_done_callback(
                lambda done: _pending.pop(key, None) if _pending.get(key) is done else None
            )
        try:
            profile = await asyncio.shield(task)
            if profile:
                account.update(profile)
        except Exception:
            logger.exception("Account profile refresh failed for UID %s.", account["genshin_uid"])

    await asyncio.gather(*(refresh(account) for account in accounts))


async def account_profile_worker() -> None:
    from .database import get_accounts, get_pool

    while True:
        try:
            async with get_pool().connection() as connection:
                result = await connection.execute("SELECT DISTINCT discord_user_id FROM accounts")
                users = await result.fetchall()
            for user in users:
                try:
                    await get_accounts(user["discord_user_id"])
                except Exception:
                    logger.exception("Could not load accounts for periodic profile refresh.")
        except Exception:
            logger.exception("Periodic account profile refresh failed.")
        await asyncio.sleep(15 * 60)
