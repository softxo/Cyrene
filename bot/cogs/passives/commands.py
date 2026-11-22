import discord
from discord import app_commands
from discord.ext import commands

from bot.utils.characters.characters import character_autocomplete, get_character
from bot.utils.errors.error_handler import lookup_entity
from bot.utils.icons import get_character_icon, get_talent_emoji
from bot.utils.talents.talents_format import format_description


class Passives(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_passives(
        self,
        destination,
        character: str,
        *,
        interaction: discord.Interaction | None = None,
        ctx: commands.Context | None = None,
    ):
        data = await lookup_entity(
            get_character, character, "Character", interaction=interaction, ctx=ctx
        )

        if data is None:
            return

        thumbnail = discord.File(get_character_icon(data["id"]), filename="character.png")
        emojis = self.bot.emojis
        embed = discord.Embed(
            title=f"Passives • {data['name']}", colour=discord.Colour.from_str(data["colour"])
        )

        embed.set_thumbnail(url="attachment://character.png")

        for passive in data["passives"]:
            unlock = passive["unlock"].lower()

            embed.add_field(
                name=(
                    f"{get_talent_emoji(emojis, data['id'], unlock)} "
                    f"{passive['unlock']} • {passive['name']}"
                ),
                value=format_description(passive["description"]) + "\n\u200b",
                inline=False,
            )

        await destination.send(embed=embed, file=thumbnail)

    @app_commands.allowed_installs(users=True, guilds=True)
    @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
    @app_commands.command(name="passives", description="Shows a character's passive talents.")
    @app_commands.autocomplete(character=character_autocomplete)
    async def passives_slash(self, interaction: discord.Interaction, character: str):
        await interaction.response.defer()

        await self._send_passives(interaction.followup, character, interaction=interaction)

    @commands.command(name="passives", aliases=["passive", "p"])
    async def passives(self, ctx: commands.Context, *, character: str):
        await self._send_passives(ctx, character, ctx=ctx)


async def setup(bot):
    await bot.add_cog(Passives(bot))
