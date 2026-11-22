import asyncio
import logging
from datetime import datetime, timedelta, timezone

from .client import HoYoLABClient

logger = logging.getLogger(__name__)

REFRESH_INTERVAL = timedelta(minutes=15)
WORKER_INTERVAL_SECONDS = 15 * 60
REQUEST_TIMEOUT_SECONDS = 8
MAX_CONCURRENT_REFRESHES = 4

MAX_NICKNAME_LENGTH = 100
MAX_ADVENTURE_RANK = 60

_semaphore = asyncio.Semaphore(MAX_CONCURRENT_REFRESHES)
_pending: dict[tuple[str, str], asyncio.Task] = {}


async def _fetch_game_roles(account: dict) -> dict:
    async with _semaphore:
        async with asyncio.timeout(REQUEST_TIMEOUT_SECONDS):
            async with HoYoLABClient(account["credentials"]) as client:
                try:
                    response = await client.get_game_roles()
                except Exception:
                    response = None

                if not response or response.get("retcode") != 0:
                    response = await client.get_game_roles_by_ltoken()

    return response


def _is_linked_role(role: dict, account: dict) -> bool:
    return (
        role.get("game_biz") == "hk4e_global"
        and str(role.get("game_uid")) == str(account["genshin_uid"])
        and role.get("region") == account["genshin_server"]
    )


def _find_linked_role(response: dict, account: dict) -> dict:
    roles = response.get("data", {}).get("list", [])

    for role in roles:
        if _is_linked_role(role, account):
            return role

    raise ValueError("Linked role is absent from the response")


def _profile_from_role(role: dict) -> dict:
    nickname = role.get("nickname")
    level = int(role.get("level"))

    if not isinstance(nickname, str) or not nickname.strip():
        raise ValueError("Invalid game profile")

    if not 1 <= level <= MAX_ADVENTURE_RANK:
        raise ValueError("Invalid game profile")

    return {"nickname": nickname.strip()[:MAX_NICKNAME_LENGTH], "level": level}


async def _fetch_profile(account: dict) -> dict:
    response = await _fetch_game_roles(account)

    if response.get("retcode") != 0:
        raise ValueError("HoYoLAB rejected the profile request")

    role = _find_linked_role(response, account)

    return _profile_from_role(role)


async def _save_profile(connection, account: dict, profile: dict, checked_at: datetime) -> None:
    await connection.execute(
        """
        UPDATE accounts
        SET nickname = %s, level = %s, profile_checked_at = %s
        WHERE genshin_uid = %s
            AND genshin_server = %s
            AND EXISTS (
                SELECT 1
                FROM accounts source
                WHERE source.id = %s
                    AND source.genshin_uid = %s
                    AND source.genshin_server = %s
            )
        """,
        (
            profile["nickname"],
            profile["level"],
            checked_at,
            account["genshin_uid"],
            account["genshin_server"],
            account["id"],
            account["genshin_uid"],
            account["genshin_server"],
        ),
    )


async def _save_check_time(connection, account: dict, checked_at: datetime) -> None:
    await connection.execute(
        "UPDATE accounts SET profile_checked_at = %s WHERE id = %s",
        (checked_at, account["id"]),
    )


async def _refresh(account: dict) -> dict | None:
    from shared.storage.database import get_pool

    now = datetime.now(timezone.utc)
    profile = None

    try:
        profile = await _fetch_profile(account)
    except Exception:
        logger.warning(
            "Could not refresh game profile for UID %s; keeping saved details.",
            account["genshin_uid"],
        )

    async with get_pool().connection() as connection:
        if profile:
            await _save_profile(connection, account, profile, now)
        else:
            await _save_check_time(connection, account, now)

        await connection.commit()

    return profile


def _recently_checked(account: dict) -> bool:
    checked = account.get("profile_checked_at")

    return bool(checked) and datetime.now(timezone.utc) - checked < REFRESH_INTERVAL


def _shared_refresh_task(account: dict) -> asyncio.Task:
    key = (str(account["genshin_uid"]), account["genshin_server"])
    task = _pending.get(key)

    if task is not None:
        return task

    task = asyncio.create_task(_refresh(account))
    _pending[key] = task

    def forget(done: asyncio.Task) -> None:
        if _pending.get(key) is done:
            _pending.pop(key, None)

    task.add_done_callback(forget)

    return task


async def _refresh_one(account: dict) -> None:
    if _recently_checked(account):
        return

    task = _shared_refresh_task(account)

    try:
        profile = await asyncio.shield(task)

        if profile:
            account.update(profile)
    except Exception:
        logger.exception("Account profile refresh failed for UID %s.", account["genshin_uid"])


async def refresh_account_profiles(accounts: list[dict]) -> None:
    await asyncio.gather(*(_refresh_one(account) for account in accounts))


async def _linked_discord_users() -> list[dict]:
    from shared.storage.database import get_pool

    async with get_pool().connection() as connection:
        result = await connection.execute("SELECT DISTINCT discord_user_id FROM accounts")

        return await result.fetchall()


async def _refresh_all_users() -> None:
    from shared.storage.database import get_accounts

    for user in await _linked_discord_users():
        try:
            await get_accounts(user["discord_user_id"])
        except Exception:
            logger.exception("Could not load accounts for periodic profile refresh.")


async def account_profile_worker() -> None:
    while True:
        try:
            await _refresh_all_users()
        except Exception:
            logger.exception("Periodic account profile refresh failed.")

        await asyncio.sleep(WORKER_INTERVAL_SECONDS)
