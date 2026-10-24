from typing import Awaitable, Callable
from genshin.models.auth.geetest import (
    SessionMMT,
    SessionMMTResult,
)
from utils.web.sessions import (
    create_challenge_session,
    delete_challenge_session,
)


ChallengeNotifier = Callable[
    [str],
    Awaitable[None]
]


async def solve_geetest(
    mmt: SessionMMT,
    *,
    user_id: int,
    notify: ChallengeNotifier,
) -> SessionMMTResult:
    session = create_challenge_session(
        user_id=user_id,
        mmt=mmt,
    )

    challenge_url = (
        f"https://cyrene.apps.bot-hosting.cloud/challenge/{session.token}"
    )

    try:
        await notify(challenge_url)

        await session.completion_event.wait()

        if session.result is None:
            raise RuntimeError(
                "CAPTCHA challenge completed without a result."
            )

        return session.result

    finally:
        delete_challenge_session(session.token)