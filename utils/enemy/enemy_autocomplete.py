from utils.enemy.enemies import ENEMIES, normalise
from discord import app_commands

async def enemy_autocomplete(
    interaction,
    current: str
):
    current = normalise(current)

    results = []

    for enemy_id, data in ENEMIES.items():

        if (
            current in normalise(enemy_id)
            or current in normalise(data["name"])
            or any (
                current in normalise(alias)
                for alias in data.get("aliases", [])
            )
        ):
            results.append(
                app_commands.Choice(
                    name=data["name"],
                    value=enemy_id
                )
            )

        if len(results) >= 25:
            break

    return results