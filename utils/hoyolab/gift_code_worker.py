import asyncio
from datetime import datetime, timedelta, timezone

import aiohttp

from utils.hoyolab.account_client import get_account_client
from utils.hoyolab.database import (
    get_gift_code_auto_claim_accounts,
    get_gift_code_redemptions,
    update_gift_code_redemption,
)


GIFT_CODES_URL = "https://hoyo-codes.seria.moe/codes?game=genshin"

# Check for new codes every 15 minutes.
CHECK_INTERVAL = 15 * 60

REDEMPTION_DELAY_SECONDS = 6

# A processing record older than this is considered abandoned, for example if the application stopped during a redemption.
STALE_PROCESSING_AFTER = timedelta(minutes=30)


async def fetch_active_gift_codes() -> list[dict]:
    """Fetch gift codes currently marked OK by the code feed."""

    timeout = aiohttp.ClientTimeout(total=20)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(GIFT_CODES_URL) as response:
            response.raise_for_status()
            data = await response.json(content_type=None)

    if not isinstance(data, dict) or not isinstance(
        data.get("codes"), list
    ):
        raise ValueError("Unexpected gift-code feed response.")

    active_codes = []
    seen_codes = set()

    for item in data["codes"]:
        if not isinstance(item, dict):
            continue

        code = item.get("code")

        if (
            not isinstance(code, str)
            or not code.strip()
            or item.get("status") != "OK"
        ):
            continue

        code = code.strip().upper()

        if code in seen_codes:
            continue

        seen_codes.add(code)
        active_codes.append(
            {
                "code": code,
                "rewards": item.get(
                    "rewards",
                    "Rewards not listed",
                ),
            }
        )

    return active_codes


def should_skip_automatic_attempt(
    redemption: dict | None,
) -> bool:
    """Avoid repeating completed submissions or recent attempts."""

    if redemption is None:
        return False

    status = redemption.get("status")

    # These codes have already been handled and should not be retried automatically.
    if status in {"submitted", "failed"}:
        return True

    # Cooldown failures can be retried during a later worker cycle.
    if status == "cooldown":
        return False

    if status == "processing":
        attempted_at = redemption.get("attempted_at")

        if not attempted_at:
            return True

        try:
            attempted_at = datetime.fromisoformat(attempted_at)

            if attempted_at.tzinfo is None:
                attempted_at = attempted_at.replace(
                    tzinfo=timezone.utc
                )

        except (TypeError, ValueError):
            return True

        age = datetime.now(timezone.utc) - attempted_at

        # Avoid duplicating an attempt that may still be running.
        return age < STALE_PROCESSING_AFTER

    # Unknown statuses are skipped conservatively.
    return True


async def process_account(
    account: dict,
    active_codes: list[dict],
) -> None:
    """Attempt new codes for one opted-in Genshin account."""

    account_id = account["account_id"]
    user_id = account["discord_user_id"]
    genshin_uid = account["genshin_uid"]

    redemptions = await get_gift_code_redemptions(account_id)

    for item in active_codes:
        code = item["code"]
        previous = redemptions.get(code)

        if should_skip_automatic_attempt(previous):
            continue

        # Save before making the request, preventing another worker cycle from immediately attempting the same code.
        await update_gift_code_redemption(
            account_id,
            code,
            "processing",
            "Automatic redemption is in progress.",
        )

        try:
            client = await get_account_client(
                user_id,
                genshin_uid,
            )

            if client is None:
                raise RuntimeError(
                    "Could not load the account client."
                )

            async with client:
                await client.redeem_genshin_code(code)

            message = (
                "The automatic redemption request completed "
                "successfully. Check the game to confirm the reward."
            )

            await update_gift_code_redemption(
                account_id,
                code,
                "submitted",
                message,
            )

            redemptions[code] = {
                "status": "submitted",
                "message": message,
                "attempted_at": datetime.now(
                    timezone.utc
                ).isoformat(),
            }

            print(
                f"[Gift Codes] Submitted {code} "
                f"for account {account_id} ({genshin_uid})."
            )

        except Exception as exc:
            error_text = str(exc)
            error_type = type(exc).__name__

            # HoYoLAB limits how frequently codes can be redeemed.
            if (
                error_type == "RedemptionCooldown"
                or "RedemptionCooldown" in error_text
                or "[-2016]" in error_text
            ):
                status = "cooldown"
                message = (
                    "HoYoLAB redemption cooldown. "
                    "This code can be retried automatically later."
                )

            # This code has already been claimed or used.
            elif (
                error_type == "RedemptionClaimed"
                or "[-2017]" in error_text
            ):
                status = "failed"
                message = (
                    "This code has already been redeemed or is "
                    "no longer available for this account."
                )

            else:
                status = "failed"
                message = (
                    "Automatic redemption failed. The code may be "
                    "expired, unavailable for this region, or the "
                    "account may need to be reconnected."
                )

            print(
                f"[Gift Codes] {status.capitalize()} for {code} "
                f"on account {account_id}: "
                f"{error_type}: {error_text}"
            )

            try:
                await update_gift_code_redemption(
                    account_id,
                    code,
                    status,
                    message,
                )
            except Exception:
                print(
                    f"[Gift Codes] Could not save {status} status "
                    f"for account {account_id}, code {code}."
                )

            redemptions[code] = {
                "status": status,
                "message": message,
                "attempted_at": datetime.now(
                    timezone.utc
                ).isoformat(),
            }

        # Wait after every attempt, whether it succeeded or failed.
        await asyncio.sleep(REDEMPTION_DELAY_SECONDS)


async def gift_code_worker() -> None:
    """Periodically process opted-in accounts until cancelled."""

    print("[Gift Codes] Automatic claiming worker started.")

    while True:
        try:
            accounts = await get_gift_code_auto_claim_accounts()

            if accounts:
                active_codes = await fetch_active_gift_codes()

                if active_codes:
                    print(
                        f"[Gift Codes] Checking {len(accounts)} "
                        f"enabled account(s) against "
                        f"{len(active_codes)} active code(s)."
                    )

                    for account in accounts:
                        try:
                            await process_account(
                                account,
                                active_codes,
                            )
                        except Exception as exc:
                            print(
                                f"[Gift Codes] Error processing "
                                f"account {account['account_id']}: "
                                f"{type(exc).__name__}: {exc}"
                            )

            # No opted-in accounts means no need to fetch the feed.

        except asyncio.CancelledError:
            print("[Gift Codes] Automatic claiming worker stopped.")
            raise

        except Exception as exc:
            print(
                f"[Gift Codes] Worker cycle failed: "
                f"{type(exc).__name__}: {exc}"
            )

        await asyncio.sleep(CHECK_INTERVAL)