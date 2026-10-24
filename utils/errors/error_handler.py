import re
import uuid
import discord
from discord.ext import commands
from discord import app_commands
from genshin import errors as genshin_errors
from utils.constants.emojis import ERROR_EMOJIS, ERROR_TYPE_EMOJIS
from utils.constants.colours import ERROR_COLOURS, ERROR_TYPE_COLOURS
from utils.errors.error_logger import log_error
from utils.errors.error_explanations import explain_error
from utils.errors.hoyolab_errors import get_hoyolab_error


def create_error_embed(
        title: str,
        description: str,
        error_type: str,
) -> discord.Embed:

    emoji = ERROR_TYPE_EMOJIS.get(
        error_type,
        ERROR_EMOJIS["error"]
    )

    colour = discord.Colour(
        ERROR_TYPE_COLOURS.get(
            error_type,
            ERROR_COLOURS["error"]
        )
    )

    return discord.Embed(
        title=f"{emoji} {title}",
        description=description,
        colour=colour
    )


NOT_YOUR_COMMAND_IMAGE = "assets/fun/Cyrene_Lock_In.jpg"


async def send_not_your_command(interaction: discord.Interaction):
    await interaction.response.send_message(
        "This interaction is not yours.",
        file=discord.File(
            NOT_YOUR_COMMAND_IMAGE,
            filename="Lock_In.jpg"
        ),
        ephemeral=True
    )


async def send_interaction_error(
        interaction: discord.Interaction,
        title: str,
        description: str,
        error_type: str,
        *,
        ephemeral: bool = True
):
    embed = create_error_embed(
        title,
        description,
        error_type
    )

    if interaction.response.is_done():
        await interaction.followup.send(
            embed=embed,
            ephemeral=ephemeral
        )
    else:
        await interaction.response.send_message(
            embed=embed,
            ephemeral=ephemeral
        )


async def send_context_error(
        ctx: commands.Context,
        title: str,
        description: str,
        error_type: str
):
    embed = create_error_embed(
        title,
        description,
        error_type
    )

    await ctx.send(embed=embed)


async def send_missing_argument(
        ctx: commands.Context,
        usage: str,
        argument: str | None = None
):
    if argument:
        description = (
            f"You're missing the required argument `{argument}`.\n\n"
            f"**Usage:** `{usage}`"
        )
    else:
        description = (
            "You're missing one or more required arguments.\n\n"
            f"**Usage:** `{usage}`"
        )

    await send_context_error(
        ctx,
        "Missing Argument",
        description,
        "missing_argument"
    )


async def send_invalid_input(
        ctx: commands.Context,
        description: str,
):
    await send_context_error(
        ctx,
        "Invalid Input",
        description,
        "invalid_input"
    )


async def send_not_found(
        ctx: commands.Context,
        description: str,
):
    await send_context_error(
        ctx,
        "Not Found",
        description,
        "not_found"
    )


async def send_permission_error(
        ctx: commands.Context,
        description: str,
):
    await send_context_error(
        ctx,
        "Permission Denied",
        description,
        "permission"
    )


async def send_bot_permission_error(
        ctx: commands.Context,
        description: str,
):
    await send_context_error(
        ctx,
        "Missing Bot Permissions",
        description,
        "bot_permission"
    )


def generate_error_id() -> str:
    return uuid.uuid4().hex[:6].upper()


def get_hoyolab_retcode(
        error
) -> int | None:

    response = getattr(
        error,
        "response",
        None
    )

    if response is not None:

        if isinstance(response, dict):
            retcode = response.get("retcode")

            if isinstance(retcode, int):
                return retcode

        retcode = getattr(
            response,
            "retcode",
            None
        )

        if isinstance(retcode, int):
            return retcode

    match = re.search(
        r"\[(-?\d+)\]",
        str(error)
    )

    if match:
        return int(match.group(1))

    return None


def get_command_name(
        command
) -> str | None:

    if command is None:
        return None

    return getattr(
        command,
        "qualified_name",
        None
    )


async def handle_hoyolab_error(
        interaction_or_ctx,
        error,
        *,
        command: str | None,
        user_id: int,
        guild_id: int | None,
        channel_id: int | None,
        interaction: bool
) -> bool:

    if not isinstance(
        error,
        genshin_errors.GenshinException
    ):
        return False

    retcode = get_hoyolab_retcode(
        error
    )

    if retcode is None:
        return False

    error_info = get_hoyolab_error(
        retcode
    )

    error_id = generate_error_id()

    log_error(
        error,
        error_id,
        code=error_info["code"],
        command=command,
        user_id=user_id,
        guild_id=guild_id,
        channel_id=channel_id
    )

    description = (
        f"{error_info['description']}\n\n"
        f"**Error Code:** `{error_info['code']}`\n"
        f"**Error ID:** `{error_id}`"
    )

    if interaction:
        await send_interaction_error(
            interaction_or_ctx,
            error_info["title"],
            description,
            error_info["type"]
        )
    else:
        await send_context_error(
            interaction_or_ctx,
            error_info["title"],
            description,
            error_info["type"]
        )

    return True


async def handle_app_command_error(
        interaction: discord.Interaction,
        error: app_commands.AppCommandError
):

    if isinstance(
        error,
        app_commands.CommandInvokeError
    ):
        original = error.original
    else:
        original = error


    if await handle_hoyolab_error(
        interaction,
        original,
        command=get_command_name(
            interaction.command
        ),
        user_id=interaction.user.id,
        guild_id=interaction.guild.id
        if interaction.guild
        else None,
        channel_id=interaction.channel.id
        if interaction.channel
        else None,
        interaction=True
    ):
        return


    if isinstance(
        error,
        app_commands.MissingPermissions
    ):
        permissions = ", ".join(
            permission.replace(
                "_",
                " "
            ).title()
            for permission in error.missing_permissions
        )

        await send_interaction_error(
            interaction,
            "Permission Denied",
            (
                "You do not have the required permissions "
                "to use this command.\n\n"
                f"**Required:** {permissions}"
            ),
            "permission"
        )
        return


    if isinstance(
        error,
        app_commands.BotMissingPermissions
    ):
        permissions = ", ".join(
            permission.replace(
                "_",
                " "
            ).title()
            for permission in error.missing_permissions
        )

        await send_interaction_error(
            interaction,
            "Missing Bot Permissions",
            (
                "I don't have the permissions required "
                "to execute this command.\n\n"
                f"**Required:** {permissions}"
            ),
            "bot_permission"
        )
        return


    if isinstance(
        error,
        app_commands.CommandOnCooldown
    ):
        await send_interaction_error(
            interaction,
            "Slow Down",
            (
                "You're using this command too quickly.\n\n"
                f"Please try again in **"
                f"{error.retry_after:.1f} seconds**."
            ),
            "cooldown"
        )
        return


    if isinstance(
        error,
        app_commands.CheckFailure
    ):
        await send_interaction_error(
            interaction,
            "Command Unavailable",
            "You are not currently allowed to use this command.",
            "error"
        )
        return


    if isinstance(
        error,
        app_commands.TransformerError
    ):
        await send_interaction_error(
            interaction,
            "Invalid Input",
            (
                "One of the values you provided is invalid.\n\n"
                "Please check your input and try again."
            ),
            "invalid_input"
        )
        return


    if isinstance(
        original,
        discord.Forbidden
    ):
        await send_interaction_error(
            interaction,
            "Permission Error",
            (
                "Discord prevented me from completing this action "
                "because I don't have the required permissions."
            ),
            "permission"
        )
        return

    if isinstance(
        original,
        discord.NotFound
    ):
        await send_interaction_error(
            interaction,
            "Not Found",
            "The requested Discord resource could not be found.",
            "not_found"
        )
        return

    if isinstance(
            original,
            discord.HTTPException
    ):
        await send_interaction_error(
            interaction,
            "Discord Error",
            (
                "Discord encountered a problem while processing "
                "this request.\n\n"
                "Please try again in a moment."
            ),
            "error"
        )
        return

    error_id = generate_error_id()

    error_type = type(original).__name__

    error_info = explain_error(
        error_type
    )

    error_code = error_info["code"]
    error_description = error_info["description"]

    log_error(
        original,
        error_id,
        code=error_code,
        command=get_command_name(
            interaction.command
        ),
        user_id=interaction.user.id,
        guild_id=interaction.guild.id
        if interaction.guild
        else None,
        channel_id=interaction.channel.id
        if interaction.channel
        else None
    )

    await send_interaction_error(
        interaction,
        "Unexpected Error",
        (
            "Something went wrong while executing the command.\n\n"
            f"{error_description}\n\n"
            "Please try again later.\n\n"
            f"**Error Code:** `{error_code}`\n"
            f"**Error ID:** `{error_id}`"
        ),
        "unexpected"
    )


async def handle_prefix_command_error(
        ctx: commands.Context,
        error: commands.CommandError
):

    if getattr(
        error,
        "handled",
        False
    ):
        return

    if isinstance(
        error,
        commands.CommandInvokeError
    ):
        original = error.original
    else:
        original = error


    if await handle_hoyolab_error(
        ctx,
        original,
        command=get_command_name(
            ctx.command
        ),
        user_id=ctx.author.id,
        guild_id=ctx.guild.id
        if ctx.guild
        else None,
        channel_id=ctx.channel.id
        if ctx.channel
        else None,
        interaction=False
    ):
        return


    if isinstance(
        error,
        commands.MissingRequiredArgument
    ):
        await send_context_error(
            ctx,
            "Missing Argument",
            (
                f"You're missing the required argument "
                f"`{error.param.name}`.\n\n"
                f"**Usage:** `{ctx.prefix}"
                f"{ctx.command.qualified_name} "
                f"{' '.join(f'<{p.name}>' for p in ctx.command.clean_params.values())}`"
            ),
            "missing_argument"
        )
        return


    if isinstance(
        error,
        commands.BadArgument
    ):
        await send_context_error(
            ctx,
            "Invalid Input",
            (
                "One or more of the values you provided "
                "could not be understood.\n\n"
                "Please check your arguments and try again."
            ),
            "invalid_input"
        )
        return


    if isinstance(
        error,
        commands.MissingPermissions
    ):
        permissions = ", ".join(
            permission.replace(
                "_",
                " "
            ).title()
            for permission in error.missing_permissions
        )

        await send_context_error(
            ctx,
            "Permission Denied",
            (
                "You do not have the required permissions "
                "to use this command.\n\n"
                f"**Required:** {permissions}"
            ),
            "permission"
        )
        return


    if isinstance(
        error,
        commands.BotMissingPermissions
    ):
        permissions = ", ".join(
            permission.replace(
                "_",
                " "
            ).title()
            for permission in error.missing_permissions
        )

        await send_context_error(
            ctx,
            "Missing Bot Permissions",
            (
                "I don't have the permissions required "
                "to execute this command.\n\n"
                f"**Required:** {permissions}"
            ),
            "bot_permission"
        )
        return


    if isinstance(
        error,
        commands.CommandOnCooldown
    ):
        await send_context_error(
            ctx,
            "Slow Down",
            (
                "You're using this command too quickly.\n\n"
                f"Please try again in **"
                f"{error.retry_after:.1f} seconds**."
            ),
            "cooldown"
        )
        return


    if isinstance(
        error,
        commands.CheckFailure
    ):
        await send_context_error(
            ctx,
            "Command Unavailable",
            "You are not currently allowed to use this command.",
            "error"
        )
        return


    if isinstance(
        original,
        discord.NotFound
    ):
        await send_context_error(
            ctx,
            "Not Found",
            "The requested Discord resource could not be found.",
            "not_found"
        )
        return

    if isinstance(
        original,
        discord.Forbidden
    ):
        await send_context_error(
            ctx,
            "Permission Error",
            (
                "Discord prevented me from completing this action "
                "because I don't have the required permissions."
            ),
            "permission"
        )
        return

    if isinstance(
        original,
        discord.HTTPException
    ):
        await send_context_error(
            ctx,
            "Discord Error",
            (
                "Discord encountered a problem while processing "
                "this request.\n\n"
                "Please try again in a moment."
            ),
            "error"
        )
        return

    error_id = generate_error_id()

    error_type = type(original).__name__

    error_info = explain_error(
        error_type
    )

    error_code = error_info["code"]
    error_description = error_info["description"]

    log_error(
        original,
        error_id,
        code=error_code,
        command=get_command_name(
            ctx.command
        ),
        user_id=ctx.author.id,
        guild_id=ctx.guild.id
        if ctx.guild
        else None,
        channel_id=ctx.channel.id
        if ctx.channel
        else None
    )

    await send_context_error(
        ctx,
        "Unexpected Error",
        (
            "Something went wrong while executing the command.\n\n"
            f"{error_description}\n\n"
            "Please try again later.\n\n"
            f"**Error Code:** `{error_code}`\n"
            f"**Error ID:** `{error_id}`"
        ),
        "unexpected"
    )