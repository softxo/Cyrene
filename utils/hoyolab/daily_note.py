def get_daily_note_data(
        response: dict
) -> dict:
    if response.get("retcode") != 0:
        raise RuntimeError(
            response.get(
                "message",
                "Failed to retrieve Genshin daily note."
            )
        )

    data = response.get("data")

    if not data:
        raise RuntimeError(
            "Genshin daily note data is unavailable."
        )

    return data


RESIN_REGEN_SECONDS = 480


def get_resin(
    response: dict
) -> tuple[int, int, int]:
    data = get_daily_note_data(response)

    current_resin = int(data["current_resin"])
    max_resin = int(data["max_resin"])
    recovery_time = int(data["resin_recovery_time"])

    if current_resin >= max_resin:
        recovery_time = 0
    else:
        recovery_time %= RESIN_REGEN_SECONDS

        if recovery_time == 0:
            recovery_time = RESIN_REGEN_SECONDS

    return (
        current_resin,
        max_resin,
        recovery_time
    )


def get_expeditions(
    response: dict
) -> list[dict]:
    data = get_daily_note_data(response)

    return data.get(
        "expeditions",
        []
    )


def format_expedition_time(
        seconds: int
) -> str:
    seconds = max(0, int(seconds))

    if seconds == 0:
        return "Finished"

    hours, remainder = divmod(seconds, 3600)
    minutes, _ = divmod(remainder, 60)

    if hours:
        return f"{hours}h{minutes}m"

    return f"{minutes}m"


def get_home_coin(
    response: dict
) -> tuple[int, int, int]:
    data = get_daily_note_data(response)

    return (
        data["current_home_coin"],
        data["max_home_coin"],
        int(data["home_coin_recovery_time"])
    )


def get_daily_tasks(
    response: dict
) -> dict:
    data = get_daily_note_data(response)

    return data.get(
        "daily_task",
        {}
    )


def get_transformer(
    response: dict
) -> dict:
    data = get_daily_note_data(response)

    return data.get(
        "transformer",
        {}
    )


def get_weekly_progress(
    response: dict
) -> dict:
    data = get_daily_note_data(response)

    return data.get(
        "week_active_progress",
        {}
    )