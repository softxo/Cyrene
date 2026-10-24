import genshin


async def get_genshin_accounts(
    client: genshin.Client
) -> list[dict]:
    accounts = await client.get_game_accounts()

    return [
        {
            "game_uid": str(account.uid),
            "region": account.server,
            "region_name": account.server_name,
            "nickname": account.nickname,
            "level": account.level
        }
        for account in accounts
        if account.game == genshin.types.Game.GENSHIN
    ]