import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo

import genshin

from .account_client import get_account_client
from .database import (
    get_daily_checkin_accounts,
    get_daily_checkin_settings,
    update_daily_checkin_status,
)


CHECK_INTERVAL = 15 * 60
HOYOLAB_TIMEZONE = ZoneInfo("Asia/Shanghai")

_checkin_wakeup = asyncio.Event()


def request_daily_checkin() -> None:
    """Wake the worker to check enabled accounts immediately."""
    _checkin_wakeup.set()


async def process_daily_checkin_account(
    account: dict,
) -> None:
    account_id = account["account_id"]

    today = datetime.now(HOYOLAB_TIMEZONE).date()
    today_key = today.isoformat()

    settings = await get_daily_checkin_settings(account_id)

    # Recheck the setting in case it was disabled after the
    # worker retrieved its list of enabled accounts.
    if not settings["auto_checkin_enabled"]:
        return

    # A successful claim or an already-claimed result means
    # this account does not need another attempt today.
    if settings["last_claimed_date"] == today_key:
        return

    client = await get_account_client(
        account["discord_user_id"],
        account["genshin_uid"],
    )

    if client is None:
        await update_daily_checkin_status(
            account_id,
            status="error",
            message="Could not load the account. Reconnect it and try again.",
        )
        return

    try:
        async with client:
            reward = await client.claim_daily_reward()

        reward_name = getattr(reward, "name", "Daily reward")
        reward_amount = getattr(reward, "amount", None)

        if reward_amount is not None:
            message = (
                f"Claimed {reward_amount}x {reward_name}."
            )
        else:
            message = f"Daily reward claimed: {reward_name}."

        await update_daily_checkin_status(
            account_id,
            status="claimed",
            message=message,
            claimed_date=today,
        )

        print(
            f"[Daily Check-In] Account {account_id}: {message}"
        )

    except genshin.AlreadyClaimed:
        await update_daily_checkin_status(
            account_id,
            status="already_claimed",
            message="Today's HoYoLAB daily reward was already claimed.",
            claimed_date=today,
        )

        print(
            f"[Daily Check-In] Account {account_id}: "
            "Today's reward was already claimed."
        )

    except Exception as exc:
        print(
            f"[Daily Check-In] Failed for account {account_id}: "
            f"{type(exc).__name__}: {exc}"
        )

        await update_daily_checkin_status(
            account_id,
            status="error",
            message=(
                "Unable to claim the daily reward. "
                "Check the account connection and try again."
            ),
        )


async def daily_checkin_worker() -> None:
    while True:
        try:
            accounts = await get_daily_checkin_accounts()

            for account in accounts:
                try:
                    await process_daily_checkin_account(account)

                except asyncio.CancelledError:
                    raise

                except Exception:
                    # Continue processing other accounts if one fails.
                    continue

        except asyncio.CancelledError:
            raise

        except Exception:
            # Retry on the next scheduled check if the database fails.
            pass

        _checkin_wakeup.clear()

        try:
            await asyncio.wait_for(
                _checkin_wakeup.wait(),
                timeout=CHECK_INTERVAL,
            )
        except asyncio.TimeoutError:
            pass