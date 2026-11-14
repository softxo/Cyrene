"""Embeds and the live now playing message."""

import asyncio
import time
from io import BytesIO

import aiohttp
import discord
from PIL import Image

from bot.utils.music.state import GuildMusicState
from shared.constants.emojis import MUSIC_EMOJIS as EMOJIS


class MusicDisplayMixin:
    async def get_dominant_colour_from_url(self, url: str) -> discord.Colour:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        return discord.Colour.red()

                    data = await resp.read()

            with Image.open(BytesIO(data)).convert("RGB") as img:
                img = img.resize((64, 64))
                colours = img.getcolors(64 * 64)
                if not colours:
                    return discord.Colour.red()

                colours.sort(key=lambda x: x[0], reverse=True)

                for _, (r, g, b) in colours:
                    if max(r, g, b) < 35:
                        continue
                    if min(r, g, b) > 235:
                        continue
                    if abs(r - g) < 10 and abs(g - b) < 10:
                        continue

                    return discord.Colour.from_rgb(r, g, b)

                _, (r, g, b) = colours[0]
                return discord.Colour.from_rgb(r, g, b)

        except Exception:
            return discord.Colour.red()

    def make_embed(
        self, description: str, colour: discord.Colour, *, title: str | None = None
    ) -> discord.Embed:
        embed = discord.Embed(title=title, description=description, colour=colour)
        embed.timestamp = discord.utils.utcnow()
        return embed

    def success_embed(self, description: str, *, title: str = "Success") -> discord.Embed:
        return self.make_embed(f"{description}", discord.Colour.green(), title=title)

    def error_embed(self, description: str, *, title: str = "Error") -> discord.Embed:
        return self.make_embed(f"{description}", discord.Colour.red(), title=title)

    def warning_embed(self, description: str, *, title: str = "Warning") -> discord.Embed:
        return self.make_embed(f"{description}", discord.Colour.orange(), title=title)

    def info_embed(self, description: str, *, title: str = "Info") -> discord.Embed:
        return self.make_embed(f"{description}", discord.Colour.blurple(), title=title)

    def format_time(self, seconds: float | int) -> str:
        seconds = max(0, int(seconds))
        minutes, secs = divmod(seconds, 60)
        hours, minutes = divmod(minutes, 60)

        if hours > 0:
            return f"{hours}:{minutes:02d}:{secs:02d}"
        return f"{minutes}:{secs:02d}"

    def build_progress_bar(self, position: float, duration: int, length: int = 16) -> str:
        if duration <= 0:
            return "🔴 LIVE"

        position = max(0.0, min(position, float(duration)))
        ratio = position / duration if duration else 0.0
        filled = int(ratio * length)

        if filled >= length:
            filled = length - 1

        return "█" * filled + "🔘" + "─" * (length - filled - 1)

    def get_mode_text(self, state: GuildMusicState) -> str:
        parts = []

        if state.slowed_mode:
            parts.append("Slowed")
        elif state.sped_mode:
            parts.append("Sped")

        if state.bassboost_mode:
            parts.append("BassBoost")

        return " + ".join(parts) if parts else "Normal"

    def get_current_playback_position(self, state: GuildMusicState) -> float:
        if state.play_started_at is None:
            return 0.0

        if state.paused_at is not None:
            elapsed = state.paused_at - state.play_started_at - state.paused_total
        else:
            elapsed = time.monotonic() - state.play_started_at - state.paused_total

        return max(0.0, elapsed)

    async def build_now_playing_embed(self, state: GuildMusicState) -> discord.Embed:
        song = state.current_song
        if song is None:
            return discord.Embed(title="Nothing Playing", description="No active track.")

        title = song.get("title", "Unknown")
        webpage_url = song.get("webpage_url", "")
        duration = song.get("duration") or 0
        thumbnail = song.get("thumbnail")
        uploader = song.get("uploader") or "Unknown"
        views = song.get("views")
        likes = song.get("likes")
        requester = song.get("requester")
        source_platform = song.get("source_platform", "youtube")
        position = self.get_current_playback_position(state)
        progress_bar = self.build_progress_bar(position, duration)
        duration_text = self.format_time(duration) if duration > 0 else "LIVE"
        elapsed_text = self.format_time(position)
        status_text = "Paused" if state.paused_at is not None else "Playing"
        mode_text = self.get_mode_text(state)
        embed_colour = song.get("embed_colour", discord.Colour.red())
        embed = discord.Embed(
            title="Now Playing",
            description=f"**[{title}]({webpage_url})**" if webpage_url else f"**{title}**",
            colour=embed_colour,
        )

        embed.add_field(
            name=f"{EMOJIS['musicduration']} Duration", value=duration_text, inline=True
        )
        embed.add_field(name=f"{EMOJIS['musicuploader']} Uploader", value=uploader, inline=True)
        embed.add_field(name=f"{EMOJIS['musicstatus']} Status", value=status_text, inline=True)

        embed.add_field(
            name=f"{EMOJIS['musicloop']} Loop",
            value="ON" if state.loop_song else "OFF",
            inline=True,
        )
        embed.add_field(name=f"{EMOJIS['musicmode']} Mode", value=mode_text, inline=True)
        embed.add_field(
            name=f"{EMOJIS['musicqueue']} Queue", value=str(len(state.song_queue)), inline=True
        )

        if views is not None:
            embed.add_field(name=f"{EMOJIS['musicviews']} Views", value=f"{views:,}", inline=True)

        if likes is not None:
            embed.add_field(name=f"{EMOJIS['musiclikes']} Likes", value=f"{likes:,}", inline=True)

        if requester is not None:
            embed.add_field(
                name=f"{EMOJIS['musicrequester']} Requester", value=requester.mention, inline=True
            )

        embed.add_field(
            name=f"{EMOJIS['musicprogress']} Progress",
            value=f"`{elapsed_text} / {duration_text}`\n`{progress_bar}`",
            inline=True,
        )

        embed.add_field(
            name=f"{EMOJIS['musicautoplay']} Autoplay",
            value="ON" if state.autoplay_mode else "OFF",
            inline=True,
        )
        embed.add_field(
            name=f"{EMOJIS['musicbassboost']} Bassboost",
            value="ON" if state.bassboost_mode else "OFF",
            inline=True,
        )

        if thumbnail:
            embed.set_image(url=thumbnail)

        footer_text = "Use ?queue to view upcoming songs."
        if source_platform == "spotify":
            footer_text += " • Resolved from Spotify"

        embed.set_footer(text=footer_text)
        return embed

    async def update_now_playing_embed(self, guild_id: int):
        state = self.get_state(guild_id)

        if state.now_playing_message is None or state.current_song is None:
            return

        try:
            if state.now_playing_view is not None:
                state.now_playing_view.refresh_button_labels()

            await state.now_playing_message.edit(
                embed=await self.build_now_playing_embed(state), view=state.now_playing_view
            )
        except Exception as e:
            print(f"Failed to update now playing embed: {e}")

    async def now_playing_progress_loop(self, guild_id: int, song_url: str):
        state = self.get_state(guild_id)

        while True:
            await asyncio.sleep(5)

            if state.now_playing_message is None or state.current_song is None:
                break

            if state.current_song.get("url") != song_url:
                break

            message = state.now_playing_message
            if message.guild is None:
                break

            vc = message.guild.voice_client
            if vc is None or not vc.is_connected():
                break

            if not (vc.is_playing() or vc.is_paused()):
                break

            try:
                await self.update_now_playing_embed(guild_id)
            except Exception:
                break
