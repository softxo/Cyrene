import discord
import asyncio
import os
import selectors
import traceback
import uvicorn
from pathlib import Path
from discord.ext import commands
from discord import app_commands
from dotenv import load_dotenv
from utils.character.character_loader import (
    load_characters,
    CHARACTERS
)
from utils.weapon.weapons import (
    load_weapons,
    WEAPONS
)
from utils.settings.prefix import get_prefix
from utils.errors.error_handler import (
    handle_app_command_error,
    handle_prefix_command_error
)
from utils.errors.error_database import initialise_database as initialise_error_database
from utils.hoyolab.database import (
    initialise_database as initialise_hoyolab_database,
    close_database as close_hoyolab_database,
    update_discord_user,
    update_discord_server
)
from utils.web.app import app as web_app
from utils.reminders.scheduler import ReminderScheduler
from utils.hoyolab.gift_code_worker import gift_code_worker



load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


load_characters()
load_weapons()



print("========== Data ==========")
print(f"Loaded {len(CHARACTERS)} character(s):")
print(f"  {', '.join(CHARACTERS)}")

print(f"Loaded {len(WEAPONS)} weapon(s):")
print(f"  {', '.join(WEAPONS)}")
print()


intents = discord.Intents.default()
intents.message_content = True


bot = commands.Bot(
    command_prefix=lambda bot, message: get_prefix(
        message.guild.id if message.guild else None
    ),
    intents=intents,
)

bot.tree.allowed_contexts = app_commands.AppCommandContext(
    guild=True,
    dm_channel=True,
    private_channel=True
)

reminder_scheduler = ReminderScheduler(bot)


@bot.tree.interaction_check
async def update_slash_user(
    interaction: discord.Interaction
) -> bool:
    user = interaction.user

    await update_discord_user(
        discord_user_id=user.id,
        discord_username=user.name,
        discord_display_name=user.display_name
    )

    if interaction.guild:
        await update_discord_server(
            discord_user_id=user.id,
            discord_guild_id=interaction.guild.id,
            discord_guild_name=interaction.guild.name
        )

    return True

@bot.before_invoke
async def update_prefix_user(
    ctx: commands.Context
):
    user = ctx.author

    await update_discord_user(
        discord_user_id=user.id,
        discord_username=user.name,
        discord_display_name=user.display_name
    )

    if ctx.guild:
        await update_discord_server(
            discord_user_id=user.id,
            discord_guild_id=ctx.guild.id,
            discord_guild_name=ctx.guild.name
        )


@bot.event
async def setup_hook():
    bot.application_emojis = await bot.fetch_application_emojis()

    print("========= Discord =========")
    print(f"Loaded {len(bot.application_emojis)} application emojis")
    print()

async def load_cogs():
    print("========== Cogs ==========")

    for commands_file in Path("cogs").rglob("*.py"):
        if commands_file.name == "__init__.py":
            continue

        module = ".".join(commands_file.with_suffix("").parts)

        try:
            await bot.load_extension(module)
            print(f"✓ {module}")
        except Exception:
            print(f"✗ {module}")
            traceback.print_exc()

    print()

@bot.event
async def on_ready():
    print("========== Reminder Scheduler ==========")

    print(
        "Scheduler running before start:",
        reminder_scheduler.is_running()
    )

    if not reminder_scheduler.is_running():
        reminder_scheduler.start()

    print(
        "Scheduler running after start:",
        reminder_scheduler.is_running()
    )

    await bot.change_presence(
        activity=discord.Activity(
            type=discord.ActivityType.listening,
            name="I could really use a wish right now"
        )
    )

    print("========= Ready =========")
    print(f"Logged in as {bot.user}")
    print(f"Guilds: {len(bot.guilds)}")
    print(f"Server Emojis: {len(bot.emojis)}")
    print()

    for cmd in bot.tree.get_commands():
        print("COMMAND:", cmd.name)

        if cmd.name == "constellations":
            for option in cmd.parameters:
                print(
                    "OPTION:",
                    option.name,
                    "autocomplete:",
                    option.autocomplete
                )

    synced = await bot.tree.sync()
    print(f"Synced {len(synced)} command(s).")


async def main():
    initialise_error_database()
    await initialise_hoyolab_database()

    if TOKEN is None:
        await close_hoyolab_database()
        raise RuntimeError("DISCORD_TOKEN is not set.")

    config = uvicorn.Config(
        web_app,
        host="0.0.0.0",
        port=26199,
        log_level="info",
    )

    web_server = uvicorn.Server(config)
    gift_code_task = None

    try:
        async with bot:
            await load_cogs()

            gift_code_task = asyncio.create_task(
                gift_code_worker(),
                name="gift-code-worker",
            )

            await asyncio.gather(
                bot.start(TOKEN),
                web_server.serve(),
            )

    finally:
        if gift_code_task is not None:
            gift_code_task.cancel()

            await asyncio.gather(
                gift_code_task,
                return_exceptions=True,
            )

        await reminder_scheduler.stop()
        await close_hoyolab_database()


@bot.tree.error
async def on_app_command_error(
        interaction: discord.Interaction,
        error: app_commands.AppCommandError
):
    await handle_app_command_error(interaction, error)

@bot.event
async def on_command_error(
        ctx: commands.Context,
        error: commands.CommandError
):
    await handle_prefix_command_error(ctx, error)

if __name__ == "__main__":
    if os.name == "nt":
        asyncio.run(
            main(),
            loop_factory=lambda: asyncio.SelectorEventLoop(
                selectors.SelectSelector()
            )
        )
    else:
        asyncio.run(main())