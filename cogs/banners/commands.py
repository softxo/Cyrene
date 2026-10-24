import aiohttp
import discord

from pathlib import Path
from discord import app_commands
from discord.ext import commands
from datetime import datetime, timezone, timedelta

from utils.banners.banners import get_current_banner
from utils.character.characters import get_character
from utils.constants.emojis import COLOURED_ELEMENT_EMOJIS


BASE_DIR = Path(__file__).resolve().parents[2]
BANNER_ASSETS = BASE_DIR / "assets" / "banners"


SERVER_OFFSETS = {
    "NA": -5,
    "EU": 1,
    "AS": 8,
}


BANNER_DATA_URL = (
    "https://raw.githubusercontent.com/"
    "UIGF-org/CurrentBannerWatcher/main/banner-data.json"
)


class Banners(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _get_banner_image(
        self,
        banner: dict
    ) -> str | None:

        try:
            timeout = aiohttp.ClientTimeout(total=10)

            async with aiohttp.ClientSession(
                timeout=timeout
            ) as session:

                async with session.get(
                    BANNER_DATA_URL
                ) as response:

                    response.raise_for_status()

                    banner_data = await response.json()

        except (
            aiohttp.ClientError,
            TimeoutError,
            ValueError
        ):
            return None

        banner_characters = []

        for character_id in banner["characters"]["5_star"]:
            character = get_character(character_id)

            if character is not None:
                banner_characters.append(
                    character["name"]
                )

        if not banner_characters:
            return None

        for data in banner_data.values():

            english = data.get("en-us", {})

            banner_name = english.get(
                "banner_name",
                ""
            )

            banner_image = english.get(
                "banner_image"
            )

            if not banner_image:
                continue

            # The banner name itself is not guaranteed
            # to contain the character name, so also use
            # the banner's pool information where possible.

            if any(
                name.lower() in banner_name.lower()
                for name in banner_characters
            ):
                return banner_image

        return None

    async def _download_banner_image(
        self,
        image_url: str,
        filename: str
    ) -> discord.File | None:

        try:
            timeout = aiohttp.ClientTimeout(total=15)

            async with aiohttp.ClientSession(
                timeout=timeout
            ) as session:

                async with session.get(
                    image_url
                ) as response:

                    response.raise_for_status()

                    image_data = await response.read()

        except (
            aiohttp.ClientError,
            TimeoutError
        ):
            return None

        return discord.File(
            fp=__import__("io").BytesIO(image_data),
            filename=filename
        )

    async def _build_banner(self):

        banner = get_current_banner()

        version = banner["version"]
        phase = banner["phase"]

        embed = discord.Embed(
            title=f"Version {version} | {phase}",
            colour=discord.Colour.gold()
        )

        banner_file = None

        banner_image_url = await self._get_banner_image(
            banner
        )

        if banner_image_url:

            banner_file = await self._download_banner_image(
                banner_image_url,
                "current_banner.jpg"
            )

        # Fallback to the old local banner if the
        # dynamic artwork cannot be retrieved.

        if banner_file is not None:

            embed.set_image(
                url="attachment://current_banner.jpg"
            )

        else:

            banner_file = discord.File(
                BANNER_ASSETS / "7.0_first_half.gif",
                filename="banner_fallback.gif"
            )

            embed.set_image(
                url="attachment://banner_fallback.gif"
            )

        embed.set_footer(
            text="The times are converted to match your timezone."
        )

        five_star_lines = []

        for character_id in banner["characters"]["5_star"]:

            character = get_character(character_id)

            if character is None:
                five_star_lines.append(character_id)
                continue

            name = character["name"]
            element = character["element"]

            emoji = COLOURED_ELEMENT_EMOJIS.get(
                element.lower(),
                ""
            )

            five_star_lines.append(
                f"{emoji} **{name}**"
            )

        embed.add_field(
            name="Promotional 5★ Characters",
            value=(
                "\n".join(five_star_lines)
                or "None"
            ),
            inline=True
        )

        four_star_lines = []

        for character_id in banner["characters"]["4_star"]:

            character = get_character(character_id)

            if character is None:
                four_star_lines.append(character_id)
                continue

            name = character["name"]
            element = character["element"]

            emoji = COLOURED_ELEMENT_EMOJIS.get(
                element.lower(),
                ""
            )

            four_star_lines.append(
                f"{emoji} **{name}**"
            )

        embed.add_field(
            name="Featured 4★ Characters",
            value="\n".join(four_star_lines) or "None",
            inline=True
        )

        start = datetime.fromisoformat(
            banner["duration"]["start"]
        )

        end = datetime.fromisoformat(
            banner["duration"]["end"]
        )

        duration = (
            f"**{start.strftime('%d/%m/%Y %H:%M')}** - "
            f"**{end.strftime('%d/%m/%Y %H:%M')}** | [UTC+1]"
        )

        embed.add_field(
            name="Duration",
            value=duration + "\n\u200b",
            inline=False
        )

        def regional_timestamp(dt, offset):

            naive = dt.replace(
                tzinfo=None
            )

            regional_dt = naive.replace(
                tzinfo=timezone(
                    timedelta(hours=offset)
                )
            )

            return int(
                regional_dt.timestamp()
            )

        time_mode = banner.get(
            "time_mode",
            "regional"
        )

        started_lines = []

        if time_mode == "fixed":

            timestamp = int(
                start.timestamp()
            )

            for region in SERVER_OFFSETS:

                started_lines.append(
                    f"{region}: <t:{timestamp}:R>"
                )

        else:

            for region, offset in SERVER_OFFSETS.items():

                timestamp = regional_timestamp(
                    start,
                    offset
                )

                started_lines.append(
                    f"{region}: <t:{timestamp}:R>"
                )

        embed.add_field(
            name="Start",
            value="\n".join(started_lines),
            inline=True
        )

        ending_lines = []

        for region, offset in SERVER_OFFSETS.items():

            timestamp = regional_timestamp(
                end,
                offset
            )

            ending_lines.append(
                f"{region}: <t:{timestamp}:R>"
            )

        embed.add_field(
            name="End",
            value="\n".join(ending_lines),
            inline=True
        )

        return embed, banner_file

    @app_commands.command(
        name="banners",
        description="Shows the current character event banners."
    )
    async def banners(
        self,
        interaction: discord.Interaction
    ):

        await interaction.response.defer()

        embed, banner_file = await self._build_banner()

        await interaction.followup.send(
            embed=embed,
            file=banner_file
        )

    @commands.command(
        name="banners"
    )
    async def banners_prefix(
        self,
        ctx: commands.Context
    ):

        embed, banner_file = await self._build_banner()

        await ctx.send(
            embed=embed,
            file=banner_file
        )


async def setup(bot):
    await bot.add_cog(Banners(bot))