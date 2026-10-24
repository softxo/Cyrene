import discord
import io
from discord.ext import commands
from discord import app_commands
from utils.errors.error_database import get_error
from utils.errors.error_explanations import explain_error
from utils.errors.error_handler import send_interaction_error, send_not_found
from utils.errors.error_permissions import ERROR_TRACE_USERS


class Error(commands.Cog):

    def __init__(self, bot):
        self.bot = bot

    def build_error_embed(
            self,
            error_data: dict
    ) -> discord.Embed:

        error_id = error_data["error_id"]
        error_type = error_data["type"]

        error_info = explain_error(
            error_type
        )

        error_code = error_data.get(
            "code"
        ) or error_info["code"]

        explanation = error_info["description"]

        embed = discord.Embed(
            title=f"Error • {error_id}",
            description=explanation,
            colour=discord.Colour.from_rgb(0, 0, 0)
        )

        command = error_data.get("command")

        if command:
            embed.add_field(
                name="Command",
                value=f"`{command}`",
                inline=True
            )

        embed.add_field(
            name="Code",
            value=f"`{error_code}`",
            inline=True
        )

        embed.add_field(
            name="Error Type",
            value=f"`{error_type}`",
            inline=True
        )

        message = error_data.get("message")

        if message:
            if len(message) > 1024:
                message = message[:1021] + "..."

            embed.add_field(
                name="Details",
                value=f"```{message}```",
                inline=False
            )

        timestamp = error_data.get("timestamp")

        if timestamp:
            embed.add_field(
                name="Occurred",
                value=(
                    f"<t:{int(discord.utils.parse_time(timestamp).timestamp())}:F>"
                ),
                inline=False
            )

        embed.set_footer(
            text=f"Error ID: {error_id}"
        )

        return embed

    async def _send_error(
            self,
            destination,
            error_id: str,
            *,
            interaction: discord.Interaction | None = None,
            ctx: commands.Context | None = None
    ):

        error_id = error_id.upper()

        error_data = get_error(error_id)

        if error_data is None:

            if interaction is not None:
                await send_interaction_error(
                    interaction,
                    "Error Not Found.",
                    f"No error with the ID `{error_id}` could be found.",
                    "not_found",
                )

            else:
                assert ctx is not None

                await send_not_found(
                    ctx,
                    f"No error with the ID `{error_id}` could be found.",
                )

            return

        embed = self.build_error_embed(
            error_data
        )

        await destination.send(
            embed=embed
        )

    async def _send_error_trace(
            self,
            destination,
            error_id: str
    ):
        error_id = error_id.upper()

        error_data = get_error(
            error_id
        )

        if error_data is None:
            await destination.send(
                embed=discord.Embed(
                    title="Error Not Found.",
                    description=(
                        f"No error with the ID `{error_id}` could be found."
                    ),
                    colour=discord.Colour.from_rgb(0, 0, 0)
                )
            )
            return

        traceback_text = error_data.get(
            "traceback"
        )

        if not traceback_text:
            await destination.send(
                embed=discord.Embed(
                    title="Traceback Not Found.",
                    description=(
                        f"No traceback was stored for error "
                        f"`{error_id}`."
                    ),
                    colour=discord.Colour.from_rgb(0, 0, 0)
                )
            )
            return

        file = discord.File(
            io.BytesIO(
                traceback_text.encode("utf-8")
            ),
            filename=f"{error_id}.txt"
        )

        await destination.send(
            content=f"Traceback for error `{error_id}`:",
            file=file
        )


    @app_commands.command(
        name="error",
        description="Looks up an error using its ID."
    )
    @app_commands.describe(
        error_id="The Error ID shown when the error occurred."
    )
    @app_commands.default_permissions(
        manage_guild=True
    )
    @app_commands.checks.has_permissions(
        manage_guild=True
    )
    async def error_slash(
            self,
            interaction: discord.Interaction,
            error_id: str
    ):
        await interaction.response.defer(
            ephemeral=True
        )

        await self._send_error(
            interaction.followup,
            error_id,
            interaction=interaction
        )

    @commands.command(
        name="error",
        aliases=["err"]
    )
    @commands.has_guild_permissions(
        manage_guild=True
    )
    async def error_prefix(
            self,
            ctx: commands.Context,
            error_id: str
    ):
        await self._send_error(
            ctx,
            error_id,
            ctx=ctx
        )

    @app_commands.command(
        name="errortrace",
        description="Retrieves the full traceback for an error."
    )
    @app_commands.describe(
        error_id="The Error ID shown when the error occurred."
    )
    async def errortrace_slash(
            self,
            interaction: discord.Interaction,
            error_id: str
    ):
        if interaction.user.id not in ERROR_TRACE_USERS:
            await send_interaction_error(
                interaction,
                "Permission Denied.",
                "You are not authorised to access error tracebacks.",
                "permission"
            )
            return

        await interaction.response.defer(
            ephemeral=True
        )

        await self._send_error_trace(
            interaction.followup,
            error_id
        )

    @commands.command(
        name="errortrace",
        aliases=["errtrace"]
    )
    async def errortrace_prefix(
            self,
            ctx: commands.Context,
            error_id: str
    ):
        if ctx.author.id not in ERROR_TRACE_USERS:
            await send_context_error(
                ctx,
                "Permission Denied.",
                "You are not authorised to access error tracebacks.",
                "permission"
            )
            return

        await self._send_error_trace(
            ctx,
            error_id
        )


async def setup(bot):
    await bot.add_cog(Error(bot))