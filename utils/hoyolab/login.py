import genshin

from utils.web.sessions import (
    create_challenge_session,
    delete_challenge_session,
)

from .auth import credentials_from_web_login
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

WEB_BASE_URL = "https://cyrene.apps.bot-hosting.cloud"


async def login_with_password(
    account: str,
    password: str,
    *,
    user_id: int,
    notify,
):
    client = genshin.Client()

    async def geetest_solver(mmt):
        session = create_challenge_session(
            user_id=user_id,
            mmt=mmt,
        )

        challenge_url = (
            f"{WEB_BASE_URL}/challenge/{session.token}"
        )

        print("===== CAPTCHA CHALLENGE CREATED =====")
        print(f"User ID: {user_id}")
        print(f"URL: {challenge_url}")
        print("=====================================")

        await notify(challenge_url)

        try:
            await session.completion_event.wait()

            if session.result is None:
                raise HoYoLABCaptchaError(mmt)

            return session.result

        finally:
            delete_challenge_session(session.token)

    try:
        result = await client.login_with_password(
            account,
            password,
            geetest_solver=geetest_solver,
        )

        stoken = None
        cookies = getattr(client.cookie_manager, "cookies", None)

        if isinstance(cookies, dict):
            stoken = cookies.get("stoken")

        credentials = credentials_from_web_login(
            result,
            stoken=stoken,
        )

        return client, credentials

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
        print(f"Error: {error}")
        print(f"Attributes: {vars(error)}")
        print("===================================")

        raise HoYoLABUnexpectedError from error
