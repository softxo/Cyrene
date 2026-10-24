import discord
from utils.constants.emojis import ERROR_EMOJIS, ERROR_TYPE_EMOJIS
from utils.constants.colours import ERROR_COLOURS, ERROR_TYPE_COLOURS


class HoYoLABError(Exception):
    """Base exception for HoYoLAB-related errors."""


class HoYoLABAuthenticationError(HoYoLABError):
    """HoYoLAB credentials were rejected."""


class HoYoLABAccountNotFoundError(HoYoLABError):
    """The HoYoLAB account could not be found."""


class HoYoLABAccountLockedError(HoYoLABError):
    """The HoYoLAB account is locked."""


class HoYoLABAccountMutedError(HoYoLABError):
    """The HoYoLAB account is restricted."""


class HoYoLABVerificationError(HoYoLABError):
    """HoYoLAB verification failed or was rate-limited."""


class HoYoLABCaptchaError(HoYoLABError):
    """HoYoLAB CAPTCHA verification failed or is required."""

    def __init__(
            self,
            mmt: dict
    ):
        self.mmt = mmt

        super().__init__()


class HoYoLABRateLimitError(HoYoLABError):
    """HoYoLAB rate-limited the request."""


class HoYoLABCookieError(HoYoLABError):
    """The HoYoLAB cookies are invalid."""


class HoYoLABConnectionError(HoYoLABError):
    """A connection to HoYoLAB could not be established."""


class HoYoLABUnexpectedError(HoYoLABError):
    """An unexpected HoYoLAB error occurred."""


def build_hoyolab_error_embed(
    error_type: str,
    title: str,
    description: str
) -> discord.Embed:
    
    emoji = ERROR_TYPE_EMOJIS.get(
        error_type,
        ERROR_EMOJIS.get(error_type, ERROR_EMOJIS["error"])
    )

    colour = ERROR_TYPE_COLOURS.get(
        error_type,
        ERROR_COLOURS.get(error_type, ERROR_COLOURS["error"])
    )

    return discord.Embed(
        title=f"{emoji} {title}",
        description=description,
        colour=colour
    )