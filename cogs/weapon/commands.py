import discord
from discord.ext import commands
from discord import app_commands
from utils.weapon.weapons import get_weapon
from utils.weapon.weapon_autocomplete import weapon_autocomplete
from utils.constants.colours import WEAPON_RARITY_COLOURS
from utils.constants.stats import STAT_NAMES, PERCENT_STATS
from utils.icons import get_weapon_icon
from utils.errors.error_handler import send_interaction_error, send_not_found, send_missing_argument


class Weapon(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_weapon(
            self,
            destination,
            weapon: str,
            refinement: int = 1,
            *,
            interaction: discord.Interaction | None = None,
            ctx: commands.Context | None = None
    ):
        original_weapon = weapon

        weapon = weapon.lower().replace(" ", "_")

        data = get_weapon(weapon)

        if data is None:
            if interaction is not None:
                await send_interaction_error(
                    interaction,
                    "Weapon Not Found.",
                    f"The weapon `{original_weapon}` could not be found.",
                    "not_found",
                )
            else:
                assert ctx is not None

                await send_not_found(
                    ctx,
                    f"The weapon `{original_weapon}` could not be found.",
                )

            return

        embed = discord.Embed(
            title=data["name"],
            description=data["description"] + "\n\u200b",
            colour=WEAPON_RARITY_COLOURS[data["rarity"]]
        )

        embed.add_field(
            name="Weapon Type",
            value=data["weapon_type"].replace("_", " ").title(),
            inline=True
        )

        embed.add_field(
            name="Rarity",
            value="★" * data["rarity"],
            inline=True
        )

        embed.add_field(
            name="Max Level",
            value=str(data["max_level"]) + "\n\u200b",
            inline=True
        )

        embed.add_field(
            name=STAT_NAMES[data["main_stat"]["type"]],
            value=str(data["main_stat"]["value"]),
            inline=True
        )

        embed.add_field(
            name="\n\u200b",
            value="\n\u200b",
            inline=True
        )

        secondary = data["secondary_stat"]

        if secondary is None:
            secondary_text = "None"
        else:
            value = secondary["value"]

            if secondary["type"] in PERCENT_STATS:
                value = f"{value}%"

            secondary_text = (
                f'{STAT_NAMES[secondary["type"]]} +{value}'
            )

        embed.add_field(
            name="Secondary Stat",
            value=secondary_text + "\n\u200b",
            inline=True
        )

        if data["passive"] is None:
            passive_text = "None"
        else:
            passive = data["passive"]
            passive_text = (
                f'**{passive["name"]}**\n'
                f'{passive["description"][f"r{refinement}"]}'
            )

        embed.add_field(
            name="",
            value=passive_text,
            inline=False
        )

        embed.set_footer(
            text=f"Refinement Rank {refinement} • Level {data['max_level']}"
        )

        icon_path = get_weapon_icon(data)

        if icon_path.exists():
            file = discord.File(
                icon_path,
                filename="weapon.webp"
            )
            embed.set_thumbnail(url="attachment://weapon.webp")

            await destination.send(
                embed=embed,
                file=file
            )
        else:
            await destination.send(
                embed=embed
            )

    @app_commands.allowed_installs(
        users=True,
        guilds=True
    )
    @app_commands.allowed_contexts(
        guilds=True,
        dms=True,
        private_channels=True
    )
    @app_commands.command(
        name="weapon",
        description="Shows information about a weapon."
    )
    @app_commands.autocomplete(
        weapon=weapon_autocomplete
    )
    async def weapon(
        self,
        interaction: discord.Interaction,
        weapon: str,
        refinement: app_commands.Range[int, 1, 5] = 1
    ):
        await interaction.response.defer()
        await self._send_weapon(
            interaction.followup,
            weapon,
            refinement,
            interaction=interaction
        )

    @commands.command(
            name="weapon",
            aliases=["w"]
    )
    async def weapon_prefix(
            self,
            ctx: commands.Context,
            *,
            weapon: str
    ):
        refinement = 1

        parts = weapon.split()

        if parts[-1].isdigit():
            value = int(parts[-1])

            if 1 <= value <= 5:
                refinement = value
                weapon = " ".join(parts[:-1])

        if not weapon.strip():
            await send_missing_argument(
                ctx,
                f"{ctx.prefix}w <weapon> [refinement]",
                "weapon"
            )
            return

        await self._send_weapon(
            ctx,
            weapon,
            refinement,
            ctx=ctx
        )


async def setup(bot):
    await bot.add_cog(Weapon(bot))