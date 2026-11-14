DEFAULT_ACCOUNT_LIMIT = 3
PREMIUM_ACCOUNT_LIMIT = 10

PREMIUM_USER_IDS = {
    1244442657544081419,
}

SPECIAL_USER_IDS = {
    1557792995179495497,
    1554226490462183505,
}

STAFF_USER_IDS: set[int] = {
    1244442657544081419,
}

ASSIGNED_STAFF_IDS: set[int] = set()


def is_staff(user_id: int | None) -> bool:
    return user_id is not None and (
        user_id in SPECIAL_USER_IDS or user_id in STAFF_USER_IDS or user_id in ASSIGNED_STAFF_IDS
    )


def get_account_type(user_id: int) -> str:
    if user_id in SPECIAL_USER_IDS:
        return "special"
    if is_staff(user_id):
        return "staff"
    if user_id in PREMIUM_USER_IDS:
        return "premium"
    return "normal"


def get_account_limit(user_id: int) -> int | None:
    if user_id in SPECIAL_USER_IDS:
        return None

    if user_id in PREMIUM_USER_IDS:
        return PREMIUM_ACCOUNT_LIMIT

    return DEFAULT_ACCOUNT_LIMIT
