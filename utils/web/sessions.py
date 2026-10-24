import asyncio
import secrets
import time
from dataclasses import dataclass, field
from genshin.models.auth.geetest import SessionMMT

SESSION_TIMEOUT = 10 * 60


@dataclass
class ChallengeSession:
    token: str
    user_id: int
    mmt: SessionMMT
    created_at: float
    completed: bool = False
    result: object | None = None
    completion_event: asyncio.Event = field(
        default_factory=asyncio.Event
    )


_sessions: dict[str, ChallengeSession] = {}


def create_challenge_session(
    user_id: int,
    mmt: SessionMMT
) -> ChallengeSession:
    token = secrets.token_urlsafe(32)

    session = ChallengeSession(
        token=token,
        user_id=user_id,
        mmt=mmt,
        created_at=time.time()
    )

    _sessions[token] = session

    return session


def get_challenge_session(
    token: str
) -> ChallengeSession | None:
    session = _sessions.get(token)

    if session is None:
        return None

    if time.time() - session.created_at > SESSION_TIMEOUT:
        _sessions.pop(token, None)
        return None

    return session


def complete_challenge(
    token: str,
    result
) -> ChallengeSession | None:
    session = get_challenge_session(token)

    if session is None:
        return None

    if session.completed:
        return None

    session.result = result
    session.completed = True
    session.completion_event.set()

    return session


def delete_challenge_session(
    token: str
) -> None:
    _sessions.pop(token, None)