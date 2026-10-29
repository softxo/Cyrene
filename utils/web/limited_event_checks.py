import hashlib
import hmac
import os
import re
import time

from utils.web.announcement_events import normalise_name


def annotate_daily_events(events: list[dict], reset_time: int) -> None:
    # Explicit recurring reward campaigns, not ordinary events mentioning daily tasks.
    campaigns = (
        "overflowing favor",
        "overflowing favour",
        "ley line overflow",
        "overflowing mastery",
        "overflowing abundance",
    )
    for event in events:
        name = normalise_name(event["name"])
        if any(name == campaign or name.startswith(campaign + " ") for campaign in campaigns):
            event["category"] = "Daily"
            event["daily_reset_time"] = reset_time

    # Keep active ordinary events first, followed by the categories with title pills.
    # Upcoming entries remain last, and each group keeps chronological order.
    events.sort(
        key=lambda event: (
            bool(event.get("is_upcoming")),
            bool(event.get("category") or event.get("is_tcg")),
            event.get("start_time", 0) if event.get("is_upcoming") else event["end_time"],
        )
    )


def completion_key(event: dict) -> str:
    # Preserve a check when an announcement later appears in HoYoLAB's calendar,
    # while keeping subsequent runs of the same named event independent.
    identity = f"{normalise_name(event['name'])}|{int(event['end_time'])}"
    if event.get("daily_reset_time"):
        identity += f"|daily:{int(event['daily_reset_time'])}"
    return "limited:v1:" + hashlib.sha256(identity.encode()).hexdigest()


def apply_completion_checks(events: list[dict], checks: dict[str, bool]) -> None:
    for event in events:
        key = completion_key(event)
        event["completion_key"] = key
        event["automatic_finished"] = event["is_finished"]
        event["manual_checked"] = checks.get(key)
        event["is_finished"] = checks.get(key, event["is_finished"])


def completion_token(user_id: int, uid: str, key: str, expires: int) -> str:
    secret = os.environ["HOYOLAB_ENCRYPTION_KEY"].encode()
    message = f"cyrene-limited-check-v1|{user_id}|{uid}|{key}|{expires}".encode()
    return f"{expires}." + hmac.new(secret, message, hashlib.sha256).hexdigest()


def valid_completion_token(token, user_id: int, uid: str, key) -> bool:
    if not isinstance(key, str) or not re.fullmatch(r"limited:v1:[a-f0-9]{64}", key):
        return False
    try:
        expires = int(token.split(".", 1)[0])
        if expires <= time.time() or expires > time.time() + 7 * 86400 + 60:
            return False
        return hmac.compare_digest(token, completion_token(user_id, uid, key, expires))
    except AttributeError, TypeError, ValueError, KeyError:
        return False
