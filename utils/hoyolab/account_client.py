from .database import get_account, update_account_cookie_token
from .client import HoYoLABClient


async def get_account_client(
    discord_user_id: int,
    genshin_uid: str
) -> HoYoLABClient | None:

    account = await get_account(
        discord_user_id,
        genshin_uid
    )

    if account is None:
        return None

    async def save_refreshed_cookie_token(token: str) -> None:
        await update_account_cookie_token(
            discord_user_id,
            genshin_uid,
            token,
        )

    client = HoYoLABClient(
        account["credentials"],
        on_cookie_token_update=save_refreshed_cookie_token,
    )

    client.genshin_uid = account["genshin_uid"]
    client.genshin_server = account["genshin_server"]

    return client
