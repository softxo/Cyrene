import asyncio
import secrets
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from genshin.models.auth.geetest import SessionMMT, SessionMMTv4

SESSION_TIMEOUT = 10 * 60


@dataclass
class EmailChallenge:
    """A one-use browser prompt for a HoYoLAB email verification code."""

    verify: Callable[[str], Awaitable[None]] | None = None


@dataclass
class ChallengeSession:
    token: str
    user_id: int
    mmt: SessionMMT | SessionMMTv4 | EmailChallenge
    created_at: float
    app_login: bool = False
    link_token: str | None = None
    submitting: bool = False
    validate: Callable[[object], Awaitable[object]] | None = None
    completed: bool = False
    result: object | None = None
    completion_event: asyncio.Event = field(default_factory=asyncio.Event)


_sessions: dict[str, ChallengeSession] = {}


def create_challenge_session(
    user_id: int,
    mmt: SessionMMT | SessionMMTv4 | EmailChallenge,
    *,
    app_login: bool = False,
    link_token: str | None = None,
    validate: Callable[[object], Awaitable[object]] | None = None,
) -> ChallengeSession:
    token = secrets.token_urlsafe(32)

    session = ChallengeSession(
        token=token,
        user_id=user_id,
        mmt=mmt,
        created_at=time.time(),
        app_login=app_login,
        link_token=link_token,
        validate=validate,
    )

    _sessions[token] = session

    return session


def get_challenge_session(token: str) -> ChallengeSession | None:
    session = _sessions.get(token)

    if session is None:
        return None

    if time.time() - session.created_at > SESSION_TIMEOUT:
        _sessions.pop(token, None)
        return None

    return session


def complete_challenge(token: str, result) -> ChallengeSession | None:
    session = get_challenge_session(token)

    if session is None:
        return None

    if session.completed:
        return None

    session.result = result
    session.completed = True
    session.completion_event.set()

    return session


def delete_challenge_session(token: str) -> None:
    _sessions.pop(token, None)
