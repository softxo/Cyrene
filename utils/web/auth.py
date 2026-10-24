import secrets
import time
from datetime import datetime, timedelta, timezone
from dataclasses import dataclass
from utils.hoyolab.database import get_pool


VERIFICATION_TIMEOUT = 5 * 60
WEB_SESSION_TIMEOUT = 30 * 24 * 60 * 60


@dataclass
class VerificationRequest:
    token: str
    code: str
    created_at: float
    user_id: int | None = None


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
) -> bool:
    _cleanup()

    code = code.strip().upper()

    for verification in _verifications.values():

        if verification.code != code:
            continue

        if verification.user_id is not None:
            return False

        verification.user_id = user_id

        return True

    return False


async def create_web_session(
    user_id: int,
) -> WebSession:

    token = secrets.token_urlsafe(48)

    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(
        seconds=WEB_SESSION_TIMEOUT
    )

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
            (
                token,
                user_id,
                now,
                expires_at
            )
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
            (token,)
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
            (token,)
        )