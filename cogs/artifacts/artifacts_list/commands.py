import discord
from discord import app_commands
from discord.ext import commands

from utils.artifacts.artifacts import load_artifacts


class ArtifactsList(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.artifacts = load_artifacts()

    async def create_embed(self):
        artifacts = [
            artifact
            for artifact in self.artifacts.values()
            if artifact.get("type") == "artifact_set"
        ]

        artifacts.sort(
            key=lambda artifact: artifact["name"].lower()
        )

        if not artifacts:
            return None

        application_emojis = await self.bot.fetch_application_emojis()

        emoji_map = {
            emoji.name: str(emoji)
            for emoji in application_emojis
        }

        ranges = [
            ("A", "D"),
            ("E", "I"),
            ("J", "O"),
            ("P", "S"),
            ("T", "V"),
            ("W", "Z"),
        ]

        embed = discord.Embed(
            title="Artifact Sets",
            description="All currently available artifact sets.\n\u200b"
        )

        for index, (start, end) in enumerate(ranges):
            column = [
                artifact
                for artifact in artifacts
                if start <= artifact["name"][0].upper() <= end
            ]

            if not column:
                continue

            value = []

            for artifact in column:
                emoji = emoji_map.get(
                    artifact["emoji"],
                    ""
                )

                value.append(
                    f"> {emoji} {artifact['name']}"
                )

            embed.add_field(
                name=f"{start} – {end}",
                value="\n".join(value),
                inline=True
            )

            if index % 2 == 1 and index < len(ranges) - 1:
                embed.add_field(
                    name="\u200b",
                    value="",
                    inline=False
                )

        return embed

    @app_commands.command(
        name="artifacts-list",
        description="Lists all available artifact sets."
    )
    async def artifacts_list(
        self,
        interaction: discord.Interaction
    ):
        embed = await self.create_embed()

        if embed is None:
            await interaction.response.send_message(
                "No artifact sets are available.",
                ephemeral=True
            )
            return

        await interaction.response.send_message(
            embed=embed
        )

    @commands.command(
        name="artifacts-list",
        aliases=["artifacts", "alist", "al"]
    )
    async def artifacts_list_prefix(
        self,
        ctx: commands.Context
    ):
        embed = await self.create_embed()

        if embed is None:
            await ctx.send(
                "No artifact sets are available."
            )
            return

        await ctx.send(
            embed=embed
        )


async def setup(bot):
    await bot.add_cog(ArtifactsList(bot))