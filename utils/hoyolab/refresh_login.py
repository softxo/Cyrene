"""Interactive app login for the pinned genshin.py authentication API."""

import hashlib
import hmac
import logging
import os

import genshin
from genshin.models.auth import ActionTicket, AppLoginResult
from genshin.models.auth.geetest import SessionMMT, SessionMMTv4

from .errors import HoYoLABVerificationError

logger = logging.getLogger(__name__)


def _device_id(client, account):
    key = os.getenv("HOYOLAB_ENCRYPTION_KEY")
    if not key:
        return client.generate_app_device_id()
    # Keep the same installation/account device identity across reconnects.
    return hmac.new(key.encode(), account.strip().casefold().encode(), hashlib.sha256).hexdigest()[
        :16
    ]


async def _login_step(stage, operation):
    try:
        return await operation
    except Exception as error:
        # Do not log exception text, request bodies, cookies or challenge answers.
        logger.warning(
            "HoYoLAB login failed: stage=%s exception=%s retcode=%s",
            stage,
            type(error).__name__,
            error.retcode if isinstance(error, genshin.errors.GenshinException) else None,
        )
        raise


async def _send_email_code(client, ticket, **options):
    try:
        return await client._send_verification_email(ticket, **options)
    except genshin.errors.VerificationCodeRateLimited as error:
        if error.retcode != -3206:
            raise
        # A resend cooldown does not establish whether delivery succeeded.
        # Keep the current ticket and let HoYoLAB validate the received code.
        logger.info(
            "HoYoLAB email resend is cooling down; continuing with code entry retcode=-3206"
        )
        return None


async def login_with_refresh_credentials(client, account, password, *, solve, email_code):
    # The SDK's public app login reads email codes from stdin. Keep its protocol,
    # but route every challenge through the browser instead of the bot console.
    options = {"device_id": _device_id(client, account)}

    result = await _login_step("app-login", client._app_login(account, password, **options))
    if isinstance(result, (SessionMMT, SessionMMTv4)):

        async def validate(answer):
            checked = await _login_step(
                "captcha-validation",
                client._app_login(account, password, **options, mmt_result=answer),
            )
            if isinstance(checked, (SessionMMT, SessionMMTv4)):
                logger.warning(
                    "HoYoLAB login failed: stage=captcha-validation result=rejected retcode=-3101 captcha=%s",
                    type(checked).__name__,
                )
                raise HoYoLABVerificationError(
                    "HoYoLAB rejected the completed login CAPTCHA. Cyrene has stopped this login attempt."
                )
            return checked

        result = await solve(result, validate)
    if isinstance(result, ActionTicket):
        ticket = result
        challenge = await _login_step("send-email", _send_email_code(client, ticket))
        if challenge is not None:

            async def validate_email_captcha(answer):
                remaining = await _login_step(
                    "send-email-captcha", _send_email_code(client, ticket, mmt_result=answer)
                )
                if remaining is not None:
                    raise HoYoLABVerificationError(
                        "HoYoLAB rejected the email-verification CAPTCHA. Cyrene has stopped this login attempt."
                    )
                return True

            await solve(challenge, validate_email_captcha)

        async def verify(code):
            await _login_step("verify-email", client._verify_email(code, ticket))

        await email_code(verify)
        # CAPTCHA answers are single-use. Resume with the verified ticket only,
        # matching the pinned SDK's public app-login protocol.
        result = await _login_step(
            "resume-verified-login", client._app_login(account, password, **options, ticket=ticket)
        )
        if isinstance(result, (SessionMMT, SessionMMTv4)):
            logger.warning(
                "HoYoLAB login failed: stage=resume-verified-login result=captcha-required retcode=-3101"
            )
            raise HoYoLABVerificationError(
                "HoYoLAB requested another CAPTCHA after email verification. Cyrene has stopped this login attempt."
            )

    if not isinstance(result, AppLoginResult) or not result.stoken:
        raise HoYoLABVerificationError("HoYoLAB did not provide refresh credentials.")

    cookies = result.model_dump()
    cookies.update(
        await _login_step(
            "mint-cookies", genshin.fetch_cookie_with_stoken_v2(cookies, token_types=[2, 4])
        )
    )
    if not cookies.get("ltoken_v2") or not cookies.get("cookie_token_v2"):
        raise HoYoLABVerificationError("HoYoLAB did not provide login cookies.")
    client.set_cookies(cookies)
    return cookies
