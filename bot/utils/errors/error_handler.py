import re
import uuid

import discord
from discord import app_commands
from discord.ext import commands
from genshin import errors as genshin_errors

from bot.utils.errors.error_explanations import explain_error
from bot.utils.errors.error_logger import log_error
from bot.utils.errors.hoyolab_errors import get_hoyolab_error
from shared.constants.colours import ERROR_COLOURS, ERROR_TYPE_COLOURS
from shared.constants.emojis import ERROR_EMOJIS, ERROR_TYPE_EMOJIS


def create_error_embed(
    title: str,
    description: str,
    error_type: str,
) -> discord.Embed:
    emoji = ERROR_TYPE_EMOJIS.get(error_type, ERROR_EMOJIS["error"])
    colour = discord.Colour(ERROR_TYPE_COLOURS.get(error_type, ERROR_COLOURS["error"]))

    return discord.Embed(title=f"{emoji} {title}", description=description, colour=colour)


NOT_YOUR_COMMAND_IMAGE = "assets/fun/Cyrene_Lock_In.jpg"


async def send_not_your_command(interaction: discord.Interaction):
    await interaction.response.send_message(
        "This interaction is not yours.",
        file=discord.File(NOT_YOUR_COMMAND_IMAGE, filename="Lock_In.jpg"),
        ephemeral=True,
    )


async def send_interaction_error(
    interaction: discord.Interaction,
    title: str,
    description: str,
    error_type: str,
    *,
    ephemeral: bool = True,
):
    embed = create_error_embed(title, description, error_type)

    if interaction.response.is_done():
        await interaction.followup.send(embed=embed, ephemeral=ephemeral)
    else:
        await interaction.response.send_message(embed=embed, ephemeral=ephemeral)


async def send_context_error(ctx: commands.Context, title: str, description: str, error_type: str):
    embed = create_error_embed(title, description, error_type)

    await ctx.send(embed=embed)


async def send_missing_argument(ctx: commands.Context, usage: str, argument: str | None = None):
    if argument:
        description = f"You're missing the required argument `{argument}`.\n\n**Usage:** `{usage}`"
    else:
        description = f"You're missing one or more required arguments.\n\n**Usage:** `{usage}`"

    await send_context_error(ctx, "Missing Argument", description, "missing_argument")


async def send_invalid_input(
    ctx: commands.Context,
    description: str,
):
    await send_context_error(ctx, "Invalid Input", description, "invalid_input")


async def send_not_found(
    ctx: commands.Context,
    description: str,
):
    await send_context_error(ctx, "Not Found", description, "not_found")


def normalise_query(query: str) -> str:
    return query.lower().replace(" ", "_")


async def lookup_entity(
    getter, query: str, entity: str, *, interaction=None, ctx=None, normalise=normalise_query
):
    data = getter(normalise(query))

    if data is None:
        description = f"The {entity.lower()} `{query}` could not be found."

        if interaction is not None:
            await send_interaction_error(
                interaction, f"{entity} Not Found", description, "not_found"
            )
        else:
            await send_not_found(ctx, description)

    return data


def generate_error_id() -> str:
    return uuid.uuid4().hex[:6].upper()


def get_hoyolab_retcode(error) -> int | None:
    response = getattr(error, "response", None)

    if response is not None:
        if isinstance(response, dict):
            retcode = response.get("retcode")

            if isinstance(retcode, int):
                return retcode

        retcode = getattr(response, "retcode", None)

        if isinstance(retcode, int):
            return retcode

    match = re.search(r"\[(-?\d+)\]", str(error))

    if match:
        return int(match.group(1))

    return None


def get_command_name(command) -> str | None:
    if command is None:
        return None

    return getattr(command, "qualified_name", None)


def format_permissions(error) -> str:
    return ", ".join(
        permission.replace("_", " ").title() for permission in error.missing_permissions
    )


def classify_error(error, original, family, ctx=None) -> tuple[str, str, str] | None:
    """Describe an expected error as (title, description, error type), or None if unexpected.

    ``family`` is ``app_commands`` for slash commands and ``commands`` for prefix commands.
    """

    if ctx is not None and isinstance(error, commands.MissingRequiredArgument):
        usage = " ".join(f"<{p.name}>" for p in ctx.command.clean_params.values())

        return (
            "Missing Argument",
            (
                f"You're missing the required argument `{error.param.name}`.\n\n"
                f"**Usage:** `{ctx.prefix}{ctx.command.qualified_name} {usage}`"
            ),
            "missing_argument",
        )

    if family is commands and isinstance(error, commands.BadArgument):
        return (
            "Invalid Input",
            (
                "One or more of the values you provided could not be understood.\n\n"
                "Please check your arguments and try again."
            ),
            "invalid_input",
        )

    if isinstance(error, family.MissingPermissions):
        return (
            "Permission Denied",
            (
                "You do not have the required permissions to use this command.\n\n"
                f"**Required:** {format_permissions(error)}"
            ),
            "permission",
        )

    if isinstance(error, family.BotMissingPermissions):
        return (
            "Missing Bot Permissions",
            (
                "I don't have the permissions required to execute this command.\n\n"
                f"**Required:** {format_permissions(error)}"
            ),
            "bot_permission",
        )

    if isinstance(error, family.CommandOnCooldown):
        return (
            "Slow Down",
            (
                "You're using this command too quickly.\n\n"
                f"Please try again in **{error.retry_after:.1f} seconds**."
            ),
            "cooldown",
        )

    if isinstance(error, family.CheckFailure):
        return (
            "Command Unavailable",
            "You are not currently allowed to use this command.",
            "error",
        )

    if family is app_commands and isinstance(error, app_commands.TransformerError):
        return (
            "Invalid Input",
            (
                "One of the values you provided is invalid.\n\n"
                "Please check your input and try again."
            ),
            "invalid_input",
        )

    if isinstance(original, discord.Forbidden):
        return (
            "Permission Error",
            (
                "Discord prevented me from completing this action "
                "because I don't have the required permissions."
            ),
            "permission",
        )

    if isinstance(original, discord.NotFound):
        return "Not Found", "The requested Discord resource could not be found.", "not_found"

    if isinstance(original, discord.HTTPException):
        return (
            "Discord Error",
            (
                "Discord encountered a problem while processing this request.\n\n"
                "Please try again in a moment."
            ),
            "error",
        )

    return None


async def report_error(
    send,
    error,
    original,
    family,
    *,
    command: str | None,
    user_id: int,
    guild_id: int | None,
    channel_id: int | None,
    ctx=None,
):
    """Send ``(title, description, error type)`` to the user through ``send``."""

    log_details = {
        "command": command,
        "user_id": user_id,
        "guild_id": guild_id,
        "channel_id": channel_id,
    }

    if isinstance(original, genshin_errors.GenshinException):
        retcode = get_hoyolab_retcode(original)

        if retcode is not None:
            error_info = get_hoyolab_error(retcode)
            error_id = generate_error_id()

            log_error(original, error_id, code=error_info["code"], **log_details)

            await send(
                error_info["title"],
                (
                    f"{error_info['description']}\n\n"
                    f"**Error Code:** `{error_info['code']}`\n"
                    f"**Error ID:** `{error_id}`"
                ),
                error_info["type"],
            )
            return

    classified = classify_error(error, original, family, ctx)

    if classified is not None:
        await send(*classified)
        return

    error_id = generate_error_id()
    error_info = explain_error(type(original).__name__)

    log_error(original, error_id, code=error_info["code"], **log_details)

    await send(
        "Unexpected Error",
        (
            "Something went wrong while executing the command.\n\n"
            f"{error_info['description']}\n\n"
            "Please try again later.\n\n"
            f"**Error Code:** `{error_info['code']}`\n"
            f"**Error ID:** `{error_id}`"
        ),
        "unexpected",
    )


async def handle_app_command_error(
    interaction: discord.Interaction, error: app_commands.AppCommandError
):
    original = error.original if isinstance(error, app_commands.CommandInvokeError) else error

    async def send(title, description, error_type):
        await send_interaction_error(interaction, title, description, error_type)

    await report_error(
        send,
        error,
        original,
        app_commands,
        command=get_command_name(interaction.command),
        user_id=interaction.user.id,
        guild_id=interaction.guild.id if interaction.guild else None,
        channel_id=interaction.channel.id if interaction.channel else None,
    )


async def handle_prefix_command_error(ctx: commands.Context, error: commands.CommandError):
    if getattr(error, "handled", False):
        return

    original = error.original if isinstance(error, commands.CommandInvokeError) else error

    async def send(title, description, error_type):
        await send_context_error(ctx, title, description, error_type)

    await report_error(
        send,
        error,
        original,
        commands,
        command=get_command_name(ctx.command),
        user_id=ctx.author.id,
        guild_id=ctx.guild.id if ctx.guild else None,
        channel_id=ctx.channel.id if ctx.channel else None,
        ctx=ctx,
    )
