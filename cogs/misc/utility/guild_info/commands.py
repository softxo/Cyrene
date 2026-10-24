import discord
from discord import app_commands
from discord.ext import commands


async def create_guild_embed(
    guild: discord.Guild
) -> discord.Embed:
    owner = guild.owner

    if owner is None:
        try:
            owner = await guild.fetch_member(guild.owner_id)
        except discord.NotFound:
            owner = None

    embed = discord.Embed(
        title=guild.name,
        colour=discord.Colour.gold()
    )

    if guild.icon:
        embed.set_thumbnail(url=guild.icon.url)

    embed.add_field(
        name="Server ID",
        value=f"`{guild.id}`" + "\n\u200b",
        inline=False
    )

    embed.add_field(
        name="Owner",
        value=owner.mention if owner else f"`{guild.owner_id}`" + "\n\u200b",
        inline=True
    )

    embed.add_field(
        name="Members",
        value=f"{guild.member_count:,}" + "\n\u200b",
        inline=True
    )

    embed.add_field(
        name="Created",
        value=discord.utils.format_dt(
            guild.created_at,
            style="F"
        ) + "\n\u200b",
        inline=False
    )

    embed.add_field(
        name="Boosts",
        value=(
            f"Level {guild.premium_tier}\n"
            f"{guild.premium_subscription_count or 0} boosts"
        ),
        inline=True
    )

    embed.add_field(
        name="Verification",
        value=guild.verification_level.name.title(),
        inline=True
    )

    return embed


class GuildInfo(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    @commands.command(name="guild")
    async def guild_prefix(self, ctx: commands.Context):
        guild = ctx.guild

        if guild is None:
            return

        embed = await create_guild_embed(guild)

        await ctx.send(embed=embed)

    @app_commands.command(
        name="guild",
        description="Show information about this server."
    )
    async def guild_slash(
        self,
        interaction: discord.Interaction
    ):
        guild = interaction.guild

        if guild is None:
            return

        embed = await create_guild_embed(guild)

        await interaction.response.send_message(
            embed=embed
        )


async def setup(bot):
    await bot.add_cog(GuildInfo(bot))