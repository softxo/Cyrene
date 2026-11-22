import discord
from discord import app_commands
from discord.ext import commands

from bot.utils.errors.error_handler import lookup_entity
from bot.utils.icons import get_weapon_icon
from bot.utils.weapons.weapon_materials_format import build_ascension_materials_embed
from bot.utils.weapons.weapons import get_weapon, weapon_autocomplete


class Weapons(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_weapon_materials(
        self,
        destination,
        weapon: str,
        *,
        interaction: discord.Interaction | None = None,
        ctx: commands.Context | None = None,
    ):
        data = await lookup_entity(get_weapon, weapon, "Weapon", interaction=interaction, ctx=ctx)

        if data is None:
            return

        embed = build_ascension_materials_embed(data, self.bot.application_emojis)
        icon_path = get_weapon_icon(data)

        if icon_path.exists():
            file = discord.File(icon_path, filename="weapon.webp")

            await destination.send(embed=embed, file=file)
        else:
            await destination.send(embed=embed)

    @app_commands.allowed_installs(users=True, guilds=True)
    @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
    @app_commands.command(name="weapon-materials", description="Shows a weapon's misc materials.")
    @app_commands.autocomplete(weapon=weapon_autocomplete)
    async def weaponmaterials(self, interaction: discord.Interaction, weapon: str):
        await self._send_weapon_materials(interaction.followup, weapon, interaction=interaction)

    @commands.command(name="weaponmaterials", aliases=["wm"])
    async def weaponmaterials_prefix(self, ctx: commands.Context, *, weapon: str):
        await self._send_weapon_materials(ctx, weapon, ctx=ctx)


async def setup(bot):
    await bot.add_cog(Weapons(bot))
