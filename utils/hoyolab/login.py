import asyncio

import genshin

from utils.web.sessions import (
    SESSION_TIMEOUT,
    EmailChallenge,
    create_challenge_session,
    delete_challenge_session,
)

from .auth import HoYoLABCredentials
from .errors import (
    HoYoLABAccountLockedError,
    HoYoLABAccountMutedError,
    HoYoLABAccountNotFoundError,
    HoYoLABAuthenticationError,
    HoYoLABCaptchaError,
    HoYoLABRateLimitError,
    HoYoLABUnexpectedError,
    HoYoLABVerificationError,
)
from .refresh_login import login_with_refresh_credentials

WEB_BASE_URL = "https://cyrene-teyvat.xyz"


async def login_with_password(
    account: str,
    password: str,
    *,
    user_id: int,
    notify,
    link_token: str | None = None,
    on_challenge_complete=None,
):
    client = genshin.Client()

    async def geetest_solver(mmt, validate=None):
        session = create_challenge_session(
            user_id=user_id,
            mmt=mmt,
            app_login=True,
            link_token=link_token,
            validate=validate,
        )

        challenge_url = f"{WEB_BASE_URL}/challenge/{session.token}"

        try:
            await notify(challenge_url)
            await asyncio.wait_for(session.completion_event.wait(), timeout=SESSION_TIMEOUT)

            if session.result is None:
                raise HoYoLABCaptchaError(mmt)
            if isinstance(session.result, Exception):
                raise session.result

            if on_challenge_complete is not None:
                await on_challenge_complete()
            return session.result

        finally:
            delete_challenge_session(session.token)

    async def email_code(verify):
        return await geetest_solver(EmailChallenge(verify=verify))

    try:
        cookies = await login_with_refresh_credentials(
            client,
            account,
            password,
            solve=geetest_solver,
            email_code=email_code,
        )

        credentials = HoYoLABCredentials(**cookies)

        return client, credentials

    except HoYoLABVerificationError:
        raise

    except asyncio.TimeoutError as error:
        raise HoYoLABVerificationError("HoYoLAB verification expired.") from error

    except genshin.errors.AccountDoesNotExist as error:
        raise HoYoLABAccountNotFoundError from error

    except genshin.errors.AccountLoginFail as error:
        raise HoYoLABAuthenticationError from error

    except genshin.errors.AccountHasLocked as error:
        raise HoYoLABAccountLockedError from error

    except genshin.errors.AccountMuted as error:
        raise HoYoLABAccountMutedError from error

    except (
        genshin.errors.WrongOTP,
        genshin.errors.VerificationCodeRateLimited,
        genshin.errors.OTPRateLimited,
    ) as error:
        raise HoYoLABVerificationError from error

    except genshin.errors.TooManyRequests as error:
        raise HoYoLABRateLimitError from error

    except genshin.errors.GenshinException as error:
        if "[-3006]" in str(error):
            raise HoYoLABRateLimitError from error

        raise HoYoLABUnexpectedError from error

    except Exception as error:
        print("===== HOYOLAB LOGIN EXCEPTION =====")
        print(f"Type: {type(error).__name__}")
        print(f"Module: {type(error).__module__}")
        print("===================================")

        raise HoYoLABUnexpectedError from error
