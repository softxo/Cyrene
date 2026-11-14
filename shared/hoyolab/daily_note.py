def get_daily_note_data(response: dict) -> dict:
    if response.get("retcode") != 0:
        raise RuntimeError(response.get("message", "Failed to retrieve Genshin daily note."))

    data = response.get("data")

    if not data:
        raise RuntimeError("Genshin daily note data is unavailable.")

    return data


RESIN_REGEN_SECONDS = 480


def get_resin(response: dict) -> tuple[int, int, int]:
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

    return (current_resin, max_resin, recovery_time)


def get_expeditions(response: dict) -> list[dict]:
    data = get_daily_note_data(response)

    return data.get("expeditions", [])


def get_home_coin(response: dict) -> tuple[int, int, int]:
    data = get_daily_note_data(response)
    current = int(data["current_home_coin"])
    maximum = int(data["max_home_coin"])
    recovery = int(data["home_coin_recovery_time"])
    if current < 0 or maximum <= 0 or recovery < 0:
        raise ValueError("Invalid Realm Currency data.")
    if current < maximum and recovery == 0:
        raise ValueError("Realm Currency recovery time is unavailable.")
    return current, maximum, recovery if current < maximum else 0


def get_transformer(response: dict) -> dict:
    data = get_daily_note_data(response)

    return data.get("transformer", {})


def get_transformer_status(response: dict) -> dict:
    transformer = get_transformer(response)
    if not isinstance(transformer, dict) or not isinstance(transformer.get("obtained"), bool):
        raise ValueError("Parametric Transformer data is unavailable.")
    if not transformer["obtained"]:
        return {"obtained": False, "remaining_seconds": 0}
    recovery = transformer.get("recovery_time")
    if not isinstance(recovery, dict):
        raise ValueError("Parametric Transformer recovery time is unavailable.")
    seconds = 0
    for field, multiplier in (("Day", 86400), ("Hour", 3600), ("Minute", 60), ("Second", 1)):
        value = recovery.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError("Invalid Parametric Transformer recovery time.")
        seconds += value * multiplier
    return {"obtained": True, "remaining_seconds": seconds}
