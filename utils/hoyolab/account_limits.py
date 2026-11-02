DEFAULT_ACCOUNT_LIMIT = 3
PREMIUM_ACCOUNT_LIMIT = 10

PREMIUM_USER_IDS = {}

SPECIAL_USER_IDS = {
    1557792995179495497,  # Everly - notinlonesplendor
    1554226490462183505,  # Alice - narcisssorolegium
}


def get_account_type(user_id: int) -> str:
    if user_id in SPECIAL_USER_IDS:
        return "special"
    if user_id in PREMIUM_USER_IDS:
        return "premium"
    return "normal"


def get_account_limit(user_id: int) -> int | None:
    if user_id in SPECIAL_USER_IDS:
        return None

    if user_id in PREMIUM_USER_IDS:
        return PREMIUM_ACCOUNT_LIMIT

    return DEFAULT_ACCOUNT_LIMIT
