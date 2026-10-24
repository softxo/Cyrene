DEFAULT_ACCOUNT_LIMIT = 3
PREMIUM_ACCOUNT_LIMIT = 10

PREMIUM_USER_IDS ={

}

SPECIAL_USER_IDS = {
    465610916873109504,
    979934316429738035,
    718579165938319421
}


def get_account_limit(user_id: int) -> int | None:
    if user_id in SPECIAL_USER_IDS:
        return None

    if user_id in PREMIUM_USER_IDS:
        return PREMIUM_ACCOUNT_LIMIT

    return DEFAULT_ACCOUNT_LIMIT