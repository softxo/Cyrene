import discord
import json
from pathlib import Path
from discord import app_commands
from discord.ext import commands
from utils.artifacts.artifacts import load_artifacts
from utils.artifacts.artifact_autocomplete import (
    create_artifact_autocomplete
)
from utils.constants.colours import RARITY_COLOURS


artifacts = load_artifacts()

artifact_autocomplete = create_artifact_autocomplete(
    artifacts
)


class Artifact(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.artifacts = artifacts

        self.artifact_data_path = Path(
            "data/artifacts"
        )

        self.artifact_rarities = {}

        for rarity in (3, 4, 5):
            path = (

                self.artifact_data_path
                / f"{rarity}_star.json"
            )

            with path.open("r", encoding="utf-8") as file:
                data = json.load(file)

            for artifact in data.values():
                icon = artifact.get("icon")

                if icon:
                    self.artifact_rarities[icon] = rarity

        self.set_images = Path(
            "assets/artifacts/sets"
        )

        self.artifact_images = Path(
            "assets/artifacts"
        )

    async def create_embed(self, artifact_name: str):
        selected = next(
            (
                (artifact_id, artifact)
                for artifact_id, artifact in self.artifacts.items()
                if (
                    artifact.get("type") == "artifact_set"
                    and artifact.get("name", "").lower()
                    == artifact_name.lower()
                )
            ),
            None
        )

        if selected is None:
            return None, None, None

        _, artifact = selected

        icon_name = artifact["icon"]

        rarity = self.artifact_rarities.get(icon_name)

        thumbnail_path = None

        if rarity is not None:
            thumbnail_path = (
                    self.artifact_images
                    / f"{rarity}_star"
                    / f"{icon_name}.webp"
            )

        embed = discord.Embed(
            title=artifact["name"],
            color=RARITY_COLOURS.get(rarity, 0x000000)
        )

        embed.add_field(
            name="Rarity",
            value="★" * rarity + "\n\u200b",
            inline=True
        )

        embed.add_field(
            name="Abbreviations",
            value=", ".join(artifact.get("alias", [])) or "None",
            inline=True
        )

        embed.add_field(
            name="2-Piece",
            value=artifact["bonus_2pc"] + "\n\u200b",
            inline=False
        )

        embed.add_field(
            name="4-Piece",
            value=artifact["bonus_4pc"],
            inline=False
        )

        image_path = (
                self.set_images
                / f"{icon_name}_Set.png"
        )

        return embed, thumbnail_path, image_path

    @app_commands.command(
        name="artifact",
        description="Shows an artifact set and its bonuses."
    )
    @app_commands.describe(
        artifact="The artifact set to display."
    )
    @app_commands.autocomplete(
        artifact=artifact_autocomplete
    )
    async def artifact(
        self,
        interaction: discord.Interaction,
        artifact: str
    ):
        embed, thumbnail_path, image_path = (
            await self.create_embed(artifact)
        )

        if embed is None:
            await interaction.response.send_message(
                f"Artifact set `{artifact}` was not found.",
                ephemeral=True
            )
            return

        files = []

        if thumbnail_path and thumbnail_path.exists():
            thumbnail_file = discord.File(
                thumbnail_path,
                filename=thumbnail_path.name
            )

            embed.set_thumbnail(
                url=f"attachment://{thumbnail_path.name}"
            )

            files.append(thumbnail_file)

        if image_path.exists():
            image_file = discord.File(
                image_path,
                filename=image_path.name
            )

            embed.set_image(
                url=f"attachment://{image_path.name}"
            )

            files.append(image_file)

        await interaction.response.send_message(
            embed=embed,
            files=files
        )

    @commands.command(
        name="artifact",
        aliases=["a"]
    )
    async def artifact_prefix(
        self,
        ctx: commands.Context,
        *,
        artifact: str
    ):
        embed, thumbnail_path, image_path = (
            await self.create_embed(artifact)
        )

        if embed is None:
            await ctx.send(
                f"Artifact set `{artifact}` was not found."
            )
            return

        files = []

        if thumbnail_path and thumbnail_path.exists():
            thumbnail_file = discord.File(
                thumbnail_path,
                filename=thumbnail_path.name
            )

            embed.set_thumbnail(
                url=f"attachment://{thumbnail_path.name}"
            )

            files.append(thumbnail_file)

        if image_path.exists():
            image_file = discord.File(
                image_path,
                filename=image_path.name
            )

            embed.set_image(
                url=f"attachment://{image_path.name}"
            )

            files.append(image_file)

        await ctx.send(
            embed=embed,
            files=files
        )


async def setup(bot):
    await bot.add_cog(Artifact(bot))