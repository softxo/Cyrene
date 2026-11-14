import discord
from discord import app_commands
from discord.ext import commands

from bot.utils.enemies.enemies import enemy_autocomplete, get_enemy
from bot.utils.enemies.enemy_format import format_elements, format_values
from bot.utils.enemies.ward_format import format_wards
from bot.utils.errors.error_handler import lookup_entity
from bot.utils.icons import get_enemy_icon, get_enemy_splash
from shared.constants.colours import ENEMY_ELEMENT_COLOURS
from shared.constants.elements import ELEMENT_NAMES
from shared.constants.emojis import COLOURED_ELEMENT_EMOJIS
from shared.constants.enemies import ENEMY_CATEGORY_NAMES


class Enemy(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_enemy(
        self,
        destination: discord.Interaction | commands.Context,
        enemy: str,
        *,
        interaction: discord.Interaction | None = None,
        ctx: commands.Context | None = None,
    ):
        data = await lookup_entity(
            get_enemy, enemy, "Enemy", interaction=interaction, ctx=ctx, normalise=str.lower
        )

        if not data:
            return

        colour = ENEMY_ELEMENT_COLOURS.get(data["element"][0], discord.Colour.light_grey())
        embed = discord.Embed(
            title=f"{ENEMY_CATEGORY_NAMES[data['category']]}\n • {data['name']}", colour=colour
        )
        icon = discord.File(get_enemy_icon(data, data["category"]), filename="enemy.webp")
        splash = discord.File(get_enemy_splash(data, data["category"]), filename="splash.webp")

        embed.set_thumbnail(url="attachment://enemy.webp")
        embed.set_image(url="attachment://splash.webp")

        if "element" in data:
            elements = ", ".join(
                f"{COLOURED_ELEMENT_EMOJIS.get(element, '')} "
                f"**{ELEMENT_NAMES.get(element, element.title())}**"
                for element in data["element"]
            )

            embed.add_field(name="Element", value=elements + "\n\u200b", inline=False)

        states = list(data["res"].values())
        base = states[0]["resistance_values"]

        embed.add_field(name="**RES**", value="", inline=False)

        embed.add_field(name="Element", value=format_elements(base) + "\n\u200b", inline=True)

        embed.add_field(
            name=states[0]["display_name"] + " RES",
            value=format_values(states[0]["resistance_values"], states[0].get("immune")),
            inline=True,
        )

        if len(states) > 1:
            embed.add_field(
                name=states[1]["display_name"] + " RES",
                value=format_values(states[1]["resistance_values"], states[1].get("immune")),
                inline=True,
            )

        if "ward" in data:
            embed.add_field(name="Ward", value=format_wards(data["ward"]), inline=False)

        if isinstance(destination, discord.Interaction):
            await destination.response.send_message(embed=embed, files=[icon, splash])
        else:
            await destination.send(embed=embed, files=[icon, splash])

    @app_commands.allowed_installs(users=True, guilds=True)
    @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
    @app_commands.command(name="enemy", description="Shows enemy information.")
    @app_commands.autocomplete(enemy=enemy_autocomplete)
    async def enemy(self, interaction: discord.Interaction, enemy: str):
        await self._send_enemy(interaction, enemy, interaction=interaction)

    @commands.command(name="enemy", aliases=["e"])
    async def enemy_prefix(self, ctx: commands.Context, *, enemy: str):
        await self._send_enemy(ctx, enemy, ctx=ctx)


async def setup(bot):
    await bot.add_cog(Enemy(bot))
