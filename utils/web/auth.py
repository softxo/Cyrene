import re
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from utils.hoyolab.database import get_pool

VERIFICATION_TIMEOUT = 5 * 60
WEB_SESSION_TIMEOUT = 30 * 24 * 60 * 60


@dataclass
class VerificationRequest:
    token: str
    code: str
    created_at: float
    user_id: int | None = None
    username: str | None = None
    display_name: str | None = None
    avatar_hash: str | None = None


@dataclass
class WebSession:
    token: str
    user_id: int
    created_at: float


_verifications: dict[str, VerificationRequest] = {}


def _cleanup() -> None:
    now = time.time()

    expired_verifications = [
        token
        for token, verification in _verifications.items()
        if now - verification.created_at > VERIFICATION_TIMEOUT
    ]

    for token in expired_verifications:
        _verifications.pop(token, None)


def create_verification() -> VerificationRequest:
    _cleanup()

    token = secrets.token_urlsafe(32)

    code = (
        f"{secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')}"
        f"{secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')}"
        f"{secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')}"
        f"{secrets.randbelow(10)}"
        f"{secrets.randbelow(10)}"
        f"{secrets.randbelow(10)}"
    )

    verification = VerificationRequest(
        token=token,
        code=code,
        created_at=time.time(),
    )

    _verifications[token] = verification

    return verification


def get_verification(
    token: str,
) -> VerificationRequest | None:
    _cleanup()

    return _verifications.get(token)


def claim_verification(
    code: str,
    user_id: int,
    username: str | None = None,
    display_name: str | None = None,
    avatar_hash: str | None = None,
) -> bool:
    _cleanup()

    code = code.strip().upper()

    for verification in _verifications.values():
        if verification.code != code:
            continue

        if verification.user_id is not None:
            return False

        verification.username = username
        verification.display_name = display_name
        verification.avatar_hash = avatar_hash
        verification.user_id = user_id

        return True

    return False


async def create_web_session(
    user_id: int,
) -> WebSession:

    token = secrets.token_urlsafe(48)

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=WEB_SESSION_TIMEOUT)

    async with get_pool().connection() as connection:
        await connection.execute(
            """
            INSERT INTO web_sessions (
                token,
                discord_user_id,
                created_at,
                expires_at
            )
            VALUES (
                %s, %s, %s, %s
            )
            """,
            (token, user_id, now, expires_at),
        )

    return WebSession(
        token=token,
        user_id=user_id,
        created_at=now.timestamp(),
    )


async def get_web_session(
    token: str | None,
) -> WebSession | None:

    if not token:
        return None

    async with get_pool().connection() as connection:
        result = await connection.execute(
            """
            SELECT
                token,
                discord_user_id,
                created_at,
                expires_at
            FROM web_sessions
            WHERE token = %s
            AND expires_at > NOW()
            LIMIT 1
            """,
            (token,),
        )

        row = await result.fetchone()

    if row is None:
        return None

    return WebSession(
        token=row["token"],
        user_id=row["discord_user_id"],
        created_at=row["created_at"].timestamp(),
    )


async def delete_web_session(
    token: str,
) -> None:

    async with get_pool().connection() as connection:
        await connection.execute(
            """
            DELETE FROM web_sessions
            WHERE token = %s
            """,
            (token,),
        )


async def save_discord_profile(verification: VerificationRequest):
    if not verification.username:
        return
    async with get_pool().connection() as connection:
        await connection.execute(
            """INSERT INTO web_discord_profiles (discord_user_id, username, display_name, avatar_hash)
            VALUES (%s, %s, %s, %s) ON CONFLICT (discord_user_id) DO UPDATE
            SET username=EXCLUDED.username, display_name=EXCLUDED.display_name,
                avatar_hash=EXCLUDED.avatar_hash, updated_at=NOW()""",
            (
                verification.user_id,
                verification.username,
                verification.display_name,
                verification.avatar_hash,
            ),
        )


async def get_discord_profile(user_id: int):
    async with get_pool().connection() as connection:
        result = await connection.execute(
            "SELECT username, display_name, avatar_hash FROM web_discord_profiles WHERE discord_user_id=%s",
            (user_id,),
        )
        row = await result.fetchone()
        if row is None:
            result = await connection.execute(
                """SELECT discord_username AS username, discord_display_name AS display_name
                FROM accounts WHERE discord_user_id=%s ORDER BY updated_at DESC LIMIT 1""",
                (user_id,),
            )
            row = await result.fetchone()
    profile = dict(row) if row else {}
    avatar_hash = profile.get("avatar_hash")
    avatar_url = "/static/images/ui/ui_icons/Discord.png"
    if isinstance(avatar_hash, str) and re.fullmatch(r"(?:a_)?[a-f0-9]{16,64}", avatar_hash):
        avatar_url = f"https://cdn.discordapp.com/avatars/{int(user_id)}/{avatar_hash}.png?size=128"
    return {
        "id": str(user_id),
        "username": profile.get("username") or "",
        "display_name": profile.get("display_name") or profile.get("username") or "Discord account",
        "avatar_url": avatar_url,
    }
