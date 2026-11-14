"""Account ownership checks shared by the web routes."""

from fastapi import HTTPException

from shared.storage.database import get_accounts


def find_account_by_id(accounts: list[dict], account_id: int | None) -> dict | None:
    return next((item for item in accounts if item["id"] == account_id), None)


async def get_owned_account(user_id: int, account_id: int) -> dict:
    accounts = await get_accounts(user_id)
    account = find_account_by_id(accounts, account_id)

    if account is None:
        raise HTTPException(status_code=404, detail="Genshin account not found.")

    return account
