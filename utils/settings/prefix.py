from utils.settings.guild_settings_manager import (
    get_guild_settings,
    save_settings
)


def get_prefix(guild_id):
    if guild_id is None:
        return "?"

    guild = get_guild_settings(guild_id)

    return guild.get(
        "prefix",
        "?"
    )


def set_prefix(guild_id, prefix):
    guild = get_guild_settings(guild_id)

    guild["prefix"] = prefix

    save_settings()