import discord

from shared.constants.emojis import ERROR_EMOJIS, HOYOLAB_EMOJIS


def find_account(accounts: list[dict], genshin_uid: str) -> dict | None:
    return next((account for account in accounts if account["genshin_uid"] == genshin_uid), None)


def create_account_options(accounts: list[dict]) -> list[discord.SelectOption]:
    options = []

    for account in accounts:
        options.append(
            discord.SelectOption(
                label=(account.get("nickname") or account["genshin_uid"]),
                description=(
                    f"UID: {account['genshin_uid']}"
                    + (f" • AR: {account['level']}" if account.get("level") is not None else "")
                ),
                value=account["genshin_uid"],
            )
        )

    return options


def get_account_reminders(reminders: list[dict], genshin_uid: str) -> list[dict]:
    return [reminder for reminder in reminders if reminder["genshin_uid"] == genshin_uid]


def get_resin_reminders(reminders: list[dict], genshin_uid: str) -> tuple[dict | None, dict | None]:
    resin = [
        reminder
        for reminder in get_account_reminders(reminders, genshin_uid)
        if reminder["reminder_type"] == "resin"
    ]
    manual, automatic = (
        next((reminder for reminder in resin if reminder["reminder_mode"] == mode), None)
        for mode in ("manual", "automatic")
    )

    return manual, automatic


def get_reminder_display(reminder: dict | None) -> tuple[str, str]:
    if reminder is None or not reminder["enabled"]:
        return (f"{ERROR_EMOJIS['error']} Disabled", "\u200b")

    config = reminder.get("config") or {}
    status = f"{ERROR_EMOJIS['success']} Enabled"

    if reminder["reminder_type"] == "resin":
        amount = config.get("amount")

        if amount is not None:
            return (status, f"{HOYOLAB_EMOJIS['original_resin']} **{amount} Resin**")

    elif reminder["reminder_type"] == "custom":
        message = config.get("message")

        if message:
            return status, f'"{message}"'

    return status, "\u200b"


def get_account_name(account: dict) -> str:
    return (
        account.get("cyrene_nickname") or account.get("nickname") or f"UID {account['genshin_uid']}"
    )


def format_account_info(account: dict) -> str:
    name = get_account_name(account)

    return (
        f"- **Name**: {name}\n"
        f"- **UID**: {account['genshin_uid']}\n"
        f"- **AR**: {account.get('level') or 'Unknown'}"
    )
