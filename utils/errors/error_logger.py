import traceback
from utils.errors.error_database import save_error


def log_error(
    error,
    error_id: str,
    *,
    code: str | None = None,
    command: str | None = None,
    user_id: int | None = None,
    guild_id: int | None = None,
    channel_id: int | None = None
):
    traceback_text = "".join(
        traceback.format_exception(
            type(error),
            error,
            error.__traceback__
        )
    )

    save_error(
        error_id,
        type(error).__name__,
        str(error),
        traceback_text,
        code=code,
        command=command,
        user_id=user_id,
        guild_id=guild_id,
        channel_id=channel_id
    )

    return {
        "error_id": error_id,
        "code": code,
        "type": type(error).__name__,
        "message": str(error),
        "traceback": traceback_text,
    }