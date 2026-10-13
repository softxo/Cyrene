import genshin
from .auth import credentials_from_web_login
from .errors import (
    HoYoLABAuthenticationError,
    HoYoLABAccountNotFoundError,
    HoYoLABAccountLockedError,
    HoYoLABAccountMutedError,
    HoYoLABVerificationError,
    HoYoLABCaptchaError,
    HoYoLABRateLimitError,
    HoYoLABUnexpectedError,
)
from utils.web.sessions import (
    create_challenge_session,
    delete_challenge_session,
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

        credentials = credentials_from_web_login(result)

        try:
            completed_cookies = await genshin.complete_cookies(
                result.model_dump()
            )
            
            print(
                "Login result cookie fields:",
                sorted(
                    key
                    for key, value in result.model_dump().items()
                    if value is not None and "cookie" in key.lower()
                )
            )

            for name in (
                "ltuid",
                "ltoken",
                "ltuid_v2",
                "ltoken_v2",
                "ltmid_v2",
                "cookie_token",
                "account_id",
                "cookie_token_v2",
                "account_mid_v2",
                "account_id_v2",
            ):
                value = completed_cookies.get(name)

                if value:
                    setattr(credentials, name, str(value))

        except Exception as error:
            print("===== HOYOLAB COOKIE COMPLETION FAILED =====")
            print(f"Type: {type(error).__name__}")
            print(f"Module: {type(error).__module__}")
            print(f"Error: {error}")
            print("=============================================")

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