HOYOLAB_ERRORS = {
    10307: {
        "code": "HY-10307",
        "title": "HoYoLAB Data Error",
        "description": (
            "HoYoLAB was unable to retrieve the requested Genshin Impact "
            "data. This is usually a temporary problem with HoYoLAB's "
            "backend rather than an issue with your account."
        ),
        "type": "hoyolab",
    },
}


DEFAULT_HOYOLAB_ERROR = {
    "code": "HY-UNKNOWN",
    "title": "HoYoLAB Error",
    "description": (
        "HoYoLAB returned an error while processing the request. "
        "Please try again later."
    ),
    "type": "hoyolab",
}


def get_hoyolab_error(
    retcode: int
) -> dict:
    return HOYOLAB_ERRORS.get(
        retcode,
        DEFAULT_HOYOLAB_ERROR
    )