import discord
from discord.ext import commands
from discord import app_commands
from utils.icons import get_enemy_icon, get_enemy_splash
from utils.enemy.enemies import get_enemy
from utils.enemy.enemy_autocomplete import enemy_autocomplete
from utils.enemy.enemy_format import format_elements, format_values
from utils.enemy.ward_format import format_wards
from utils.constants.colours import ENEMY_ELEMENT_COLOURS
from utils.constants.emojis import COLOURED_ELEMENT_EMOJIS
from utils.constants.elements import ELEMENT_NAMES
from utils.constants.enemies import ENEMY_CATEGORY_NAMES
from utils.errors.error_handler import send_interaction_error, send_not_found


class Enemy(commands.Cog):

    def __init__(self, bot):
        self.bot = bot

    async def _send_enemy(
            self,
            destination: discord.Interaction | commands.Context,
            enemy: str,
            *,
            interaction: discord.Interaction | None = None,
            ctx: commands.Context | None = None
    ):
        """Builds and sends an enemy embed."""

        original_enemy = enemy

        enemy = enemy.lower()

        data = get_enemy(enemy)

        if not data:
            if interaction is not None:
                await send_interaction_error(
                    interaction,
                    "Enemy Not Found.",
                    f"The enemy `{original_enemy}` could not be found.",
                    "not_found",
                )
            else:
                assert ctx is not None

                await send_not_found(
                    ctx,
                    f"The enemy `{original_enemy}` could not be found.",
                )

            return

        colour = ENEMY_ELEMENT_COLOURS.get(
            data["element"][0],
            discord.Colour.light_grey()
        )

        embed = discord.Embed(
            title=f"{ENEMY_CATEGORY_NAMES[data['category']]}\n • {data['name']}",
            colour=colour
        )

        icon = discord.File(
            get_enemy_icon(data, data["category"]),
            filename="enemy.webp"
        )

        splash = discord.File(
            get_enemy_splash(data, data["category"]),
            filename="splash.png"
        )

        embed.set_thumbnail(url="attachment://enemy.webp")
        embed.set_image(url="attachment://splash.png")

        if "element" in data:
            elements = ", ".join(
                f"{COLOURED_ELEMENT_EMOJIS.get(element, '')} "
                f"**{ELEMENT_NAMES.get(element, element.title())}**"
                for element in data["element"]
            )

            embed.add_field(
                name="Element",
                value=elements + "\n\u200b",
                inline=False
            )

        states = list(data["res"].values())
        base = states[0]["resistance_values"]

        embed.add_field(
            name="**RES**",
            value="",
            inline=False
        )

        embed.add_field(
            name="Element",
            value=format_elements(base) + "\n\u200b",
            inline=True
        )

        embed.add_field(
            name=states[0]["display_name"] + " RES",
            value=format_values(
                states[0]["resistance_values"],
                states[0].get("immune")
            ),
            inline=True
        )

        if len(states) > 1:
            embed.add_field(
                name=states[1]["display_name"] + " RES",
                value=format_values(
                    states[1]["resistance_values"],
                    states[1].get("immune")
                ),
                inline=True
            )

        if "ward" in data:
            embed.add_field(
                name="Ward",
                value=format_wards(data["ward"]),
                inline=False
            )

        if isinstance(destination, discord.Interaction):
            await destination.response.send_message(
                embed=embed,
                files=[icon, splash]
            )
        else:
            await destination.send(
                embed=embed,
                files=[icon, splash]
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
        name="enemy",
        description="Shows enemy information."
    )
    @app_commands.autocomplete(enemy=enemy_autocomplete)
    async def enemy(
        self,
        interaction: discord.Interaction,
        enemy: str
    ):
        await self._send_enemy(
            interaction,
            enemy,
            interaction=interaction
        )

    @commands.command(
        name="enemy",
        aliases=["e"]
    )
    async def enemy_prefix(
            self,
            ctx: commands.Context,
            *,
            enemy: str
    ):
        await self._send_enemy(
            ctx,
            enemy,
            ctx=ctx
        )


async def setup(bot):
    await bot.add_cog(Enemy(bot))