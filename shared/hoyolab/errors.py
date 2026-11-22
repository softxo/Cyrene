import discord

from shared.constants.colours import ERROR_COLOURS, ERROR_TYPE_COLOURS
from shared.constants.emojis import ERROR_EMOJIS, ERROR_TYPE_EMOJIS


class HoYoLABError(Exception):
    pass


class HoYoLABAuthenticationError(HoYoLABError):
    pass


class HoYoLABAccountNotFoundError(HoYoLABError):
    pass


class HoYoLABAccountLockedError(HoYoLABError):
    pass


class HoYoLABAccountMutedError(HoYoLABError):
    pass


class HoYoLABVerificationError(HoYoLABError):
    def __init__(self, public_message: str | None = None):
        self.public_message = public_message
        super().__init__(public_message or "HoYoLAB verification could not be completed.")


class HoYoLABCaptchaError(HoYoLABError):
    def __init__(self, mmt: dict):
        self.mmt = mmt

        super().__init__()


class HoYoLABRateLimitError(HoYoLABError):
    pass


class HoYoLABCookieError(HoYoLABError):
    pass


class HoYoLABUnexpectedError(HoYoLABError):
    pass


def build_hoyolab_error_embed(error_type: str, title: str, description: str) -> discord.Embed:
    emoji = ERROR_TYPE_EMOJIS.get(error_type, ERROR_EMOJIS.get(error_type, ERROR_EMOJIS["error"]))
    colour = ERROR_TYPE_COLOURS.get(
        error_type, ERROR_COLOURS.get(error_type, ERROR_COLOURS["error"])
    )

    return discord.Embed(title=f"{emoji} {title}", description=description, colour=colour)
