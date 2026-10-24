import discord
import json
from discord.ext import commands
from discord import app_commands
from utils.character.characters import get_character
from utils.character.character_autocomplete import character_autocomplete
from utils.icons import get_character_icon
from pathlib import Path

BUILDS_PATH = Path("data/builds")
DATA_PATH = Path("data")

def load_json(folder, filename):
    with open(
        DATA_PATH / folder / filename,
        encoding="utf-8"
    ) as f:
        return json.load(f)

# WEAPONS = load_json("weapons", "weapons.json")
# ARTIFACTS = load_json("artifacts", "artifacts.json")
STATS = load_json("stats", "stats.json")

def load_build(character_id):
    with open(
        BUILDS_PATH / f"{character_id}.json",
        encoding="utf-8"
    ) as f:
        return json.load(f)


def get_weapon(weapon_id):
    return WEAPONS[weapon_id]

def get_artifact_set(artifact_id):
    return ARTIFACTS[artifact_id]

def get_stat(stat_id):
    return STATS[stat_id]


def get_alternative_weapons(build):
    lines = []

    for weapon_data in build["alternative_weapons"]:
        weapon = get_weapon(weapon_data["id"])

        suffix = weapon_data.get("suffix", "")

        lines.append(
            f"{weapon['name']}{suffix}"
        )

    return "\n".join(lines)

def get_best_f2p_weapon(build):
    weapon = get_weapon(build["best_f2p_weapon"]["id"])
    return weapon["name"]

def get_artifacts(build):
    lines = []

    for recommendation in build["artifacts"]["best"]:
        sets = []

        for piece in recommendation["sets"]:
            if piece["type"] == "set":
                name = get_artifact_set(piece["id"])["name"]
            else:
                name = get_stat(piece["id"])["name"]

            sets.append(f"{piece['bonus']} {name}")

        lines.append(" + ".join(sets))

    return "\n".join(lines)

def get_main_stats(build):
    stats = build["main_stats"]

    sands = " / ".join(
        get_stat(stat)["name"]
        for stat in stats["sands"]
    )

    goblet = " / ".join(
        get_stat(stat)["name"]
        for stat in stats["goblet"]
    )

    circlet = " / ".join(
        get_stat(stat)["name"]
        for stat in stats["circlet"]
    )

    return (
        f"**Sands:** {sands}\n"
        f"**Goblet:** {goblet}\n"
        f"**Circlet:** {circlet}"
    )


def build_embed(data, build):
    embed = discord.Embed(
        title=f"{data['name']} • {build['name']}",
        colour=discord.Colour.from_str(data["colour"])
    )

    embed.set_thumbnail(url="attachment://character.png")

    weapon = get_weapon(build["best_weapon"]["id"])

    embed.add_field(
        name="Best Weapon",
        value=weapon["name"],
        inline=True
    )

    embed.add_field(
        name="Alternative Weapons",
        value=get_alternative_weapons(build),
        inline=True
    )

    embed.add_field(
        name="Best F2P",
        value=get_best_f2p_weapon(build),
        inline=False
    )

    embed.add_field(
        name="Artifacts",
        value=get_artifacts(build),
        inline=False
    )

    embed.add_field(
        name="Main Stats",
        value=get_main_stats(build),
        inline=True
    )

    embed.add_field(
        name="Sub Stats",
        value="Coming soon",
        inline=True
    )

    embed.add_field(
        name="Talent Priority",
        value="Coming soon",
        inline=False
    )

    embed.add_field(
        name="Notes",
        value="Coming soon",
        inline=False
    )
    return embed


class Build(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @app_commands.command(
        name="build",
        description="Shows a character's recommended builds."
    )
    @app_commands.autocomplete(character=character_autocomplete)
    async def build(
        self,
        interaction: discord.Interaction,
        character: str
    ):
        data = get_character(character)

        if not data:
            await interaction.response.send_message(
                "Character not found.",
                ephemeral=True
            )
            return

        builds = load_build(data["id"])

        recommended = next(
            build
            for build in builds["builds"]
            if build.get("recommended", False)
        )

        thumbnail = discord.File(
            get_character_icon(data["id"]),
            filename="character.png"
        )

        embed = build_embed(data, recommended)

        await interaction.response.send_message(
            embed=embed,
            file=thumbnail
        )


async def setup(bot):
    await bot.add_cog(Build(bot))