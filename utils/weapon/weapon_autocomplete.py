from discord import app_commands
from utils.weapon.weapons import get_all_weapons


async def weapon_autocomplete(
    interaction,
    current: str,
):
    weapons = get_all_weapons()

    results = []

    for weapon in weapons.values():
        if current.lower() in weapon["name"].lower():
            results.append(
                app_commands.Choice(
                    name=weapon["name"],
                    value=weapon["id"]
                )
            )

    return results[:25]