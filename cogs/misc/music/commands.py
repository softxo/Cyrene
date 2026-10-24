import discord
import time
import asyncio
import yt_dlp as youtube_dl
import yt_dlp.utils as ytdlp_utils
import re
import aiohttp
import os
import base64
import random
import urllib.parse
from io import BytesIO
from typing import Any, cast, Optional
from discord.ext import commands
from dotenv import load_dotenv
from utils.constants.emojis import MUSIC_EMOJIS as EMOJIS
from PIL import Image

load_dotenv()

ytdlp_utils.bug_reports_message = lambda *args, **kwargs: ""

ytdl_format_options = {
    "format": "bestaudio[acodec=opus]/bestaudio/best",
    "noplaylist": True,
    "quiet": True,
    "default_search": "auto",

    "js_runtimes": {
        "deno": {}
    },

    "cookiefile": "/home/container/cookies.txt",

    "extractor_args": {
        "youtube": {
            "player_client": ["android_vr"]
        }
    },
}

search_ytdl_options: dict[str, Any] = {
    "quiet": True,
    "extract_flat": "in_playlist",
    "noplaylist": True,
    "default_search": "auto",

    "js_runtimes": {
        "deno": {}
    },

    "cookiefile": "/home/container/cookies.txt",
}

search_ytdl = youtube_dl.YoutubeDL(
    cast(Any, search_ytdl_options)
)

ffmpeg_options = {
    "before_options": (
        "-reconnect 1 "
        "-reconnect_streamed 1 "
        "-reconnect_delay_max 5"
    ),
    "options": "-vn",
}

ytdl = youtube_dl.YoutubeDL(cast(Any, ytdl_format_options))

spotify_track_url_re = re.compile(
    r"(?:https?://)?open\.spotify\.com/track/([A-Za-z0-9]+)(?:\?.*)?$"
)

spotify_client_id = os.getenv("SPOTIFY_CLIENT_ID")
spotify_client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")

class GuildMusicState:
    def __init__(self):
        self.song_queue = []
        self.loop_song = False
        self.current_song = None
        self.skip_once = False
        self.now_playing_message = None
        self.now_playing_updater = None
        self.slowed_mode = False
        self.sped_mode = False
        self.bassboost_mode = False
        self.play_started_at = None
        self.paused_at = None
        self.autoplay_mode = False
        self.current_volume = 1.0
        self.paused_total = 0.0
        self.queue_loop = False
        self.lock = asyncio.Lock()
        self.preloaded = None
        self.preload_task = None
        self.now_playing_view = None
        self.autoplay_history = []

class MusicControls(discord.ui.View):
    def __init__(self, cog, guild_id: int):
        super().__init__(timeout=300)
        self.cog = cog
        self.guild_id = guild_id
        self.message = None
        self.refresh_button_labels()

    def get_state(self):
        return self.cog.get_state(self.guild_id)

    def on_off_text(self, value: bool) -> str:
        return "ON" if value else "OFF"

    def pause_resume_label(self, vc: discord.VoiceClient | None) -> str:
        if vc and vc.is_paused():
            return "Resume"
        return "Pause"

    def get_loop_button_text(self) -> str:
        state = self.get_state()
        return f"Loop: {self.on_off_text(state.loop_song)}"

    def get_mode_button_text(self) -> str:
        state = self.get_state()
        if state.slowed_mode:
            mode = "Slowed"
        elif state.sped_mode:
            mode = "Sped"
        else:
            mode = "Normal"
        return f"Mode: {mode}"

    def get_bassboost_button_text(self) -> str:
        state = self.get_state()
        return f"Bassboost: {self.on_off_text(state.bassboost_mode)}"

    def get_autoplay_button_text(self) -> str:
        state = self.get_state()
        return f"Autoplay: {self.on_off_text(state.autoplay_mode)}"

    def get_pause_resume_button_text(self) -> str:
        guild = self.cog.bot.get_guild(self.guild_id)
        vc = guild.voice_client if guild else None
        return self.pause_resume_label(vc)

    def refresh_button_labels(self):
        self.pause_resume_button.label = self.get_pause_resume_button_text()
        self.loop_button.label = self.get_loop_button_text()
        self.mode_button.label = self.get_mode_button_text()
        self.bassboost_button.label = self.get_bassboost_button_text()
        self.autoplay_button.label = self.get_autoplay_button_text()

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        vc = interaction.guild.voice_client if interaction.guild else None

        if not vc or not vc.channel:
            await interaction.response.send_message(
                embed=self.cog.warning_embed("I'm not in a voice channel.", title="Not Connected"),
                ephemeral=True
            )
            return False

        if not interaction.user.voice or interaction.user.voice.channel != vc.channel:
            await interaction.response.send_message(
                embed=self.cog.warning_embed(
                    "You must be in my voice channel to use these controls.",
                    title="Access Denied"
                ),
                ephemeral=True
            )
            return False

        return True

    async def on_timeout(self):
        for item in self.children:
            item.disabled = True

        self.refresh_button_labels()

        if self.message:
            try:
                await self.message.edit(view=self)
            except Exception:
                pass

    @discord.ui.button(label="Pause", emoji=f"{EMOJIS['musicpauseresume']}", style=discord.ButtonStyle.secondary, row=0)
    async def pause_resume_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()
        vc = interaction.guild.voice_client

        if not vc:
            return await interaction.response.send_message("I'm not in a voice channel.", ephemeral=True)

        await interaction.response.defer(thinking=False)

        async with state.lock:
            if vc.is_playing():
                vc.pause()
                state.paused_at = time.monotonic()
            elif vc.is_paused():
                vc.resume()
                if state.paused_at is not None:
                    state.paused_total += time.monotonic() - state.paused_at
                    state.paused_at = None
            else:
                return await interaction.followup.send("Nothing is playing.", ephemeral=True)

        self.refresh_button_labels()
        await interaction.message.edit(
            embed=await self.cog.build_now_playing_embed(state),
            view=self
        )

    @discord.ui.button(label="Skip", emoji=f"{EMOJIS['musicskip']}", style=discord.ButtonStyle.secondary, row=0)
    async def skip_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()
        vc = interaction.guild.voice_client

        if not vc or not (vc.is_playing() or vc.is_paused()):
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Nothing is playing.", title="Nothing Playing"),
                ephemeral=True
            )

        await interaction.response.defer(thinking=False)

        async with state.lock:
            state.skip_once = True
            vc.stop()

    @discord.ui.button(label="Mode: Normal", emoji=f"{EMOJIS['musicmode']}", style=discord.ButtonStyle.secondary, row=0)
    async def mode_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()
        vc = interaction.guild.voice_client

        if vc is None or state.current_song is None:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Nothing is playing.", title="Nothing Playing"),
                ephemeral=True
            )

        await interaction.response.defer(thinking=False)

        async with state.lock:
            if not state.slowed_mode and not state.sped_mode:
                state.slowed_mode = True
                state.sped_mode = False
            elif state.slowed_mode:
                state.slowed_mode = False
                state.sped_mode = True
            else:
                state.slowed_mode = False
                state.sped_mode = False

            ok, error = await self.cog.apply_current_mode_from_interaction(interaction)
        if not ok:
            return await interaction.followup.send(
                embed=self.cog.error_embed(
                    error or "Couldn't change mode.",
                    title="Mode Change Failed"
                ),
                ephemeral=True
            )

        self.refresh_button_labels()
        await interaction.message.edit(
            embed=await self.cog.build_now_playing_embed(state),
            view=self
        )

    @discord.ui.button(label="Loop: OFF", emoji=f"{EMOJIS['musicloop']}", style=discord.ButtonStyle.secondary, row=0)
    async def loop_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(thinking=False)
        state = self.get_state()
        state.loop_song = not state.loop_song

        self.refresh_button_labels()
        await interaction.message.edit(
            embed=await self.cog.build_now_playing_embed(state),
            view=self
        )

    @discord.ui.button(label="Stop", emoji=f"{EMOJIS['musicstop']}", style=discord.ButtonStyle.secondary, row=0)
    async def stop_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        vc = interaction.guild.voice_client

        if not vc:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Nothing is playing.", title="Nothing Playing"),
                ephemeral=True
            )

        await interaction.response.defer(thinking=False)

        for item in self.children:
            item.disabled = True

        try:
            await interaction.message.edit(
                embed=self.cog.info_embed("Playback stopped.", title="Stopped"),
                view=self
            )
        except Exception:
            pass

        await self.cog.reset_state(self.guild_id, clear_queue=True)

        try:
            vc.stop()
        except Exception:
            pass

        try:
            await vc.disconnect()
        except Exception:
            pass

    @discord.ui.button(label="Autoplay: OFF", emoji=f"{EMOJIS['musicautoplay']}", style=discord.ButtonStyle.secondary, row=1)
    async def autoplay_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(thinking=False)
        state = self.get_state()
        state.autoplay_mode = not state.autoplay_mode

        if state.autoplay_mode and state.current_song is not None and not state.song_queue:
            self.cog.schedule_preload_next(self.guild_id)
        elif not state.autoplay_mode:
            if state.preload_task and not state.preload_task.done():
                state.preload_task.cancel()
            state.preload_task = None
            state.preloaded = None

        self.refresh_button_labels()
        await interaction.message.edit(
            embed=await self.cog.build_now_playing_embed(state),
            view=self
        )

    @discord.ui.button(label="Bassboost: OFF", emoji=f"{EMOJIS['musicbassboost']}", style=discord.ButtonStyle.secondary, row=1)
    async def bassboost_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()
        vc = interaction.guild.voice_client

        if vc is None or state.current_song is None:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Nothing is playing.", title="Nothing Playing"),
                ephemeral=True
            )

        await interaction.response.defer(thinking=False)

        async with state.lock:
            state.bassboost_mode = not state.bassboost_mode

            ok, error = await self.cog.apply_current_mode_from_interaction(interaction)
        if not ok:
            return await interaction.followup.send(
                embed=self.cog.error_embed(
                    error or "Couldn't change bassboost mode.",
                    title="Mode Change Failed"
                ),
                ephemeral=True
            )

        self.refresh_button_labels()
        await interaction.message.edit(
            embed=await self.cog.build_now_playing_embed(state),
            view=self
        )

    @discord.ui.button(label="Queue", emoji=f"{EMOJIS['musicqueue']}", style=discord.ButtonStyle.secondary, row=1)
    async def queue_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()

        if not state.current_song and not state.song_queue:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Queue is empty!", title="Empty Queue"),
                ephemeral=True
            )

        lines = []

        if state.current_song:
            lines.append(
                f"**Now Playing:**\n **[{state.current_song['title']}]({state.current_song['webpage_url']})**"
            )

        if state.song_queue:
            queue_text = "\n".join(
                f"`{i}.` **[{song['title']}]({song['webpage_url']})**"
                for i, song in enumerate(state.song_queue[:15], start=1)
            )
            if len(state.song_queue) > 15:
                queue_text += f"\n...and **{len(state.song_queue) - 15}** more."
            lines.append(f"**Up Next:**\n{queue_text}")
        else:
            lines.append("**Up Next:**\nNo songs queued.")

        embed = discord.Embed(
            title="Music Queue",
            description="\n\n".join(lines),
            colour=discord.Color.blurple()
        )
        embed.set_footer(
            text=(
                f"Total queued: {len(state.song_queue)} | "
                f"Loop: {'ON' if state.loop_song else 'OFF'} | "
                f"Queue Loop: {'ON' if state.queue_loop else 'OFF'}"
            )
        )

        await interaction.response.send_message(embed=embed, ephemeral=True)

    @discord.ui.button(label="Lyrics", emoji=f"{EMOJIS['musiclyrics']}", style=discord.ButtonStyle.secondary, row=1)
    async def lyrics_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()

        if state.current_song is None:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Nothing is playing!", title="Lyrics Unavailable"),
                ephemeral=True
            )

        data = await self.cog.fetch_lyrics_data(state.current_song)
        if data is None:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed(
                    "Couldn't find lyrics for the current track.",
                    title="Lyrics Not Found"
                ),
                ephemeral=True
            )

        await interaction.response.send_message(
            embed=self.cog.build_lyrics_embed(data),
            ephemeral=True
        )

class Music(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.guild_states = {}

    def get_autoplay_search_terms(
            self,
            song: dict[str, Any],
    ) -> tuple[str, str]:
        raw_title = (song.get("title") or "").strip()

        artist = (
                song.get("artist")
                or song.get("creator")
                or song.get("channel")
                or ""
        ).strip()

        cleaned_title = self.clean_lyrics_title(raw_title)

        if artist and cleaned_title:
            return artist, cleaned_title

        if " - " in cleaned_title:
            parsed_artist, track = cleaned_title.split(" - ", 1)

            parsed_artist = parsed_artist.strip()
            track = track.strip()

            if parsed_artist and track:
                return parsed_artist, track

        return "", cleaned_title

    def remember_autoplay_track(self, state: GuildMusicState, song: dict[str, Any], max_items: int = 20):
        signature = self.build_track_signature(song)
        if not signature[0]:
            return

        if state.autoplay_history and state.autoplay_history[-1] == signature:
            return

        state.autoplay_history.append(signature)

        if len(state.autoplay_history) > max_items:
            state.autoplay_history = state.autoplay_history[-max_items:]

    def normalise_track_text(self, text: str) -> str:
        text = (text or "").lower()

        text = re.sub(r"\(.*?\)|\[.*?\]|\{.*?\}", " ", text)

        junk_words = [
            "official video", "official audio", "official music video",
            "lyrics", "lyric video", "audio", "video", "visualizer",
            "sped up", "slowed", "reverb", "nightcore", "remastered",
            "hd", "hq", "mv", "topic", "vevo", "radio edit",
            "extended", "version", "live", "performance",
            "feat", "ft", "featuring", "prod", "produced by"
        ]

        for word in junk_words:
            text = re.sub(rf"\b{re.escape(word)}\b", " ", text)

        text = text.replace("&", "and")

        text = re.sub(r"[^a-z0-9\s]", " ", text)
        text = re.sub(r"\s+", " ", text).strip()

        return text

    def build_track_signature(self, song: dict[str, Any]) -> tuple[str, int]:
        title = self.normalise_track_text(song.get("title") or "")
        duration = int(song.get("duration") or 0)
        return title, duration

    def is_same_track(self, a: dict[str, Any], b: dict[str, Any]) -> bool:
        a_title, a_duration = self.build_track_signature(a)
        b_title, b_duration = self.build_track_signature(b)

        if not a_title or not b_title:
            return False

        if a_title == b_title:
            if a_duration <= 0 or b_duration <= 0:
                return True
            return abs(a_duration - b_duration) <= 4

        return False

    def schedule_preload_next(self, guild_id: int):
        state = self.get_state(guild_id)

        if state.preload_task and not state.preload_task.done():
            state.preload_task.cancel()

        state.preload_task = asyncio.create_task(self.preload_next(guild_id))

    async def _apply_current_mode_to_voice_client(
        self,
        guild_id: int,
        vc: discord.VoiceClient | None
    ) -> tuple[bool, str | None]:
        state = self.get_state(guild_id)

        if vc is None or state.current_song is None:
            return False, "Nothing is playing."

        if not (vc.is_playing() or vc.is_paused()):
            return False, "Nothing is playing."

        audio_url = state.current_song.get("audio_url")

        if not audio_url:
            try:
                fresh_song = await self.get_song_info(state.current_song["url"])
                audio_url = fresh_song.get("audio_url")
                state.current_song["audio_url"] = audio_url
            except Exception as e:
                return False, f"Couldn't reload the current track: {e}"

        if not audio_url:
            return False, "Couldn't rebuild the current stream."

        position = self.get_current_playback_position(state)
        was_paused = vc.is_paused()

        if was_paused:
            vc.resume()
            if state.paused_at is not None:
                state.paused_total += time.monotonic() - state.paused_at
                state.paused_at = None

        new_source = self.make_audio_source(
            audio_url,
            start_at=position,
            slowed=state.slowed_mode,
            sped=state.sped_mode,
            bassboost=state.bassboost_mode,
            volume=state.current_volume
        )

        vc.source = new_source

        state.play_started_at = time.monotonic() - position
        state.paused_at = None

        if was_paused:
            vc.pause()
            state.paused_at = time.monotonic()

        return True, None

    async def resolve_query_to_queue_song(self, ctx: commands.Context, query: str) -> dict[str, Any]:
        if self.is_spotify_track_url(query):
            song = await self.resolve_spotify_to_youtube(query)
        else:
            song = await self.get_song_info(query)

        return {
            "url": song.get("url") or song.get("webpage_url"),
            "title": song.get("title", "Unknown"),
            "webpage_url": song.get("webpage_url"),
            "thumbnail": song.get("thumbnail"),
            "duration": song.get("duration", 0),
            "uploader": song.get("uploader", "Unknown"),
            "views": song.get("views"),
            "likes": song.get("likes"),
            "requester": ctx.author,
            "spotify_url": song.get("spotify_url"),
            "source_platform": song.get("source_platform", "youtube"),
        }

    async def reset_state(self, guild_id: int, *, clear_queue: bool = True):
        state = self.get_state(guild_id)

        async with state.lock:
            if state.now_playing_updater:
                state.now_playing_updater.cancel()
                state.now_playing_updater = None

            if state.now_playing_message:
                try:
                    await state.now_playing_message.delete()
                except Exception:
                    pass

            state.now_playing_message = None
            state.now_playing_view = None

            if clear_queue:
                state.song_queue.clear()

            state.current_song = None
            state.skip_once = False
            state.loop_song = False
            state.autoplay_mode = False
            state.slowed_mode = False
            state.sped_mode = False
            state.bassboost_mode = False
            state.current_volume = 1.0
            state.play_started_at = None
            state.paused_at = None
            state.paused_total = 0.0
            state.queue_loop = False
            if state.preload_task and not state.preload_task.done():
                state.preload_task.cancel()
                state.preload_task = None
            state.preloaded = None
            state.autoplay_history.clear()

    async def preload_next(self, guild_id: int):
        state = self.get_state(guild_id)

        try:
            candidate = None

            async with state.lock:
                if state.preloaded is not None:
                    return

                if state.song_queue:
                    candidate = state.song_queue[0].copy()
                elif state.autoplay_mode and state.current_song is not None:
                    candidate = ("autoplay", state.current_song.copy())
                else:
                    candidate = None

            if candidate is None:
                async with state.lock:
                    state.preloaded = None
                return

            if isinstance(candidate, tuple) and candidate[0] == "autoplay":
                seed_song = candidate[1]
                candidate = await self.get_autoplay_song(
                    state,
                    seed_song,
                    requester=seed_song.get("requester")
                )

            if candidate is None:
                async with state.lock:
                    state.preloaded = None
                return

            track_url = candidate.get("url") or candidate.get("webpage_url")
            if not track_url:
                async with state.lock:
                    state.preloaded = None
                return

            fresh_song = await self.get_song_info(track_url)
            audio_url = fresh_song.get("audio_url")

            if not audio_url:
                async with state.lock:
                    state.preloaded = None
                return

            preloaded_data = {
                "track_url": track_url,
                "queued_song": candidate,
                "fresh_song": fresh_song,
                "audio_url": audio_url
            }

            async with state.lock:
                state.preloaded = preloaded_data

        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"preload_next failed: {e}")
            async with state.lock:
                state.preloaded = None

    async def get_dominant_colour_from_url(self, url: str) -> discord.Colour:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        return discord.Color.red()

                    data = await resp.read()

            with Image.open(BytesIO(data)).convert("RGB") as img:
                img = img.resize((64, 64))

                colours = img.getcolors(64 * 64)
                if not colours:
                    return discord.Color.red()

                colours.sort(key=lambda x: x[0], reverse=True)

                for _, (r, g, b) in colours:
                    if max(r, g, b) < 35:
                        continue
                    if min(r, g, b) > 235:
                        continue
                    if abs(r - g) < 10 and abs(g - b) < 10:
                        continue

                    return discord.Color.from_rgb(r, g, b)

                _, (r, g, b) = colours[0]
                return discord.Color.from_rgb(r, g, b)

        except Exception:
            return discord.Color.red()

    def make_embed(self, description: str, colour: discord.Color, *, title: str | None = None) -> discord.Embed:
        embed = discord.Embed(
            title=title,
            description=description,
            colour=colour
        )
        embed.timestamp = discord.utils.utcnow()
        return embed

    def success_embed(self, description: str, *, title: str = "Success") -> discord.Embed:
        return self.make_embed(f"{description}", discord.Color.green(), title=title)

    def error_embed(self, description: str, *, title: str = "Error") -> discord.Embed:
        return self.make_embed(f"{description}", discord.Color.red(), title=title)

    def warning_embed(self, description: str, *, title: str = "Warning") -> discord.Embed:
        return self.make_embed(f"{description}", discord.Color.orange(), title=title)

    def info_embed(self, description: str, *, title: str = "Info") -> discord.Embed:
        return self.make_embed(f"{description}", discord.Color.blurple(), title=title)

    def get_state(self, guild_id: int) -> GuildMusicState:
        if guild_id not in self.guild_states:
            self.guild_states[guild_id] = GuildMusicState()
        return self.guild_states[guild_id]

    async def apply_current_mode_from_interaction(self, interaction: discord.Interaction) -> tuple[bool, str | None]:
        vc = interaction.guild.voice_client if interaction.guild else None
        return await self._apply_current_mode_to_voice_client(interaction.guild.id, vc)

    def is_spotify_track_url(self, query: str) -> bool:
        return bool(spotify_track_url_re.search(query.strip()))

    def extract_spotify_track_id(self, url: str) -> str | None:
        match = spotify_track_url_re.search(url.strip())
        if not match:
            return None
        return match.group(1)

    async def get_spotify_access_token(self) -> str:
        if not spotify_client_id or not spotify_client_secret:
            raise RuntimeError(
                "Spotify credentials are missing. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to your .env file."
            )

        auth_string = f"{spotify_client_id}:{spotify_client_secret}"
        encoded_auth = base64.b64encode(auth_string.encode("utf-8")).decode("utf-8")

        headers = {
            "Authorization": f"Basic {encoded_auth}",
            "Content-Type": "application/x-www-form-urlencoded"
        }

        data = {
            "grant_type": "client_credentials"
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://accounts.spotify.com/api/token",
                headers=headers,
                data=data
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise RuntimeError(f"Spotify auth failed: {resp.status} - {error_text}")

                payload = await resp.json()
                token = payload.get("access_token")
                if not token:
                    raise RuntimeError(f"Spotify did not return an access token.")

                return token

    async def get_spotify_track_info(self, spotify_url: str) -> dict[str, Any]:
        track_id = self.extract_spotify_track_id(spotify_url)
        if not track_id:
            raise RuntimeError("Invalid Spotify track URL.")

        access_token = await self.get_spotify_access_token()

        headers = {
            "Authorization": f"Bearer {access_token}"
        }

        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(f"https://api.spotify.com/v1/tracks/{track_id}") as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise RuntimeError(f"Spotify track lookup failed: {resp.status} - {error_text}")

                data = await resp.json()

        artists = data.get("artists", [])
        artist_names = [artist.get("name") for artist in artists if artist.get("name")]
        artist_text = ", ".join(artist_names) if artist_names else "Unknown"

        album = data.get("album", {})
        images = album.get("images", [])
        thumbnail = images[0].get("url") if images else None

        duration_ms = data.get("duration_ms") or 0
        duration_seconds = int(duration_ms / 1000)

        return {
            "spotify_url": spotify_url,
            "title": data.get("name", "Unknown"),
            "artists": artist_names,
            "artist_text": artist_text,
            "duration": duration_seconds,
            "thumbnail": thumbnail,
            "search_query": f"{artist_text} - {data.get('name', 'Unknown')} audio",
        }

    async def resolve_spotify_to_youtube(self, spotify_url: str) -> dict[str, Any]:
        spotify_track = await self.get_spotify_track_info(spotify_url)
        youtube_song = await self.get_song_info(spotify_track["search_query"])

        youtube_url = youtube_song.get("webpage_url") or youtube_song.get("url")
        if not youtube_url:
            raise RuntimeError("Couldn't resolve the Spotify track to a playable YouTube result.")

        return {
            "query": spotify_url,
            "url": youtube_url,
            "title": spotify_track["title"],
            "webpage_url": youtube_url,
            "audio_url": youtube_song.get("audio_url"),
            "duration": spotify_track["duration"] or youtube_song.get("duration", 0),
            "thumbnail": spotify_track.get("thumbnail") or youtube_song.get("thumbnail"),
            "uploader": spotify_track["artist_text"],
            "views": youtube_song.get("views"),
            "likes": youtube_song.get("likes"),
            "spotify_url": spotify_url,
            "source_platform": "spotify",
        }

    def get_youtube_thumbnail(self, url: str | None) -> str | None:
        if not url:
            return None

        parsed = urllib.parse.urlparse(url)

        video_id = None

        if parsed.hostname in {"youtu.be", "www.youtu.be"}:
            video_id = parsed.path.strip("/").split("/")[0]

        elif parsed.hostname in {
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "music.youtube.com",
        }:
            query = urllib.parse.parse_qs(parsed.query)
            video_id = query.get("v", [None])[0]

            if not video_id and parsed.path.startswith("/shorts/"):
                video_id = parsed.path.split("/shorts/", 1)[1].split("/", 1)[0]

        if not video_id:
            return None

        return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

    async def get_song_info(self, query: str) -> dict[str, Any]:
        loop = asyncio.get_running_loop()

        info = await loop.run_in_executor(
            None,
            lambda q=query: ytdl.extract_info(
                q,
                download=False,
                process=True,
            )
        )

        info = cast(dict[str, Any], info)

        entries = info.get("entries")

        if isinstance(entries, list) and entries:
            first = entries[0]

            if isinstance(first, dict):
                info = cast(dict[str, Any], first)

        webpage_url = (
                info.get("webpage_url")
                or info.get("original_url")
                or query
        )

        audio_url = info.get("url")

        return {
            "query": query,
            "url": webpage_url,
            "title": info.get("title", "Unknown"),
            "webpage_url": webpage_url,
            "audio_url": audio_url,
            "http_headers": info.get("http_headers", {}),
            "duration": info.get("duration") or 0,
            "thumbnail": (
                    self.get_youtube_thumbnail(webpage_url)
                    or info.get("thumbnail")
            ),
            "uploader": (
                    info.get("uploader")
                    or info.get("channel")
                    or "Unknown"
            ),
            "artist": info.get("artist"),
            "creator": info.get("creator"),
            "views": info.get("view_count"),
            "likes": info.get("like_count"),
        }

    async def get_autoplay_song(
            self,
            state: GuildMusicState,
            seed_song: dict[str, Any],
            requester=None
    ) -> dict[str, Any] | None:
        artist, track = self.get_autoplay_search_terms(seed_song)

        queries = []

        if artist and track:
            queries.extend(
                [
                    f"ytsearch15:{artist}",
                    f"ytsearch15:{artist} songs",
                    f"ytsearch15:{artist} music",
                    f"ytsearch15:{artist} - {track}"
                ]
            )
        elif artist:
            queries.extend(
                [
                    f"ytsearch15:{artist} songs",
                    f"ytsearch15:{artist} music",
                    f"ytsearch15:{artist}",
                ]
            )
        else:
            title = (seed_song.get("title") or "").strip()

            if title:
                queries.extend(
                    [
                        f"ytsearch15:{title}",
                        f"ytsearch15:{title} music",
                    ]
                )

        if not queries:
            return None

        current_url = seed_song.get("webpage_url") or seed_song.get("url")
        current_signature = self.build_track_signature(seed_song)

        queued_urls = {
            song.get("webpage_url") or song.get("url")
            for song in state.song_queue
            if isinstance(song, dict)
        }

        queued_signatures = {
            self.build_track_signature(song)
            for song in state.song_queue
            if isinstance(song, dict)
        }

        recent_signatures = set(state.autoplay_history)

        preloaded_url = None
        preloaded_signature = None

        if state.preloaded:
            preloaded_song = state.preloaded.get("queued_song")

            if isinstance(preloaded_song, dict):
                preloaded_url = (
                        preloaded_song.get("webpage_url")
                        or preloaded_song.get("url")
                )
                preloaded_signature = self.build_track_signature(preloaded_song)

        loop = asyncio.get_running_loop()
        relaxed_candidate = None

        for query in queries:
            try:
                info = await asyncio.wait_for(
                    loop.run_in_executor(
                        None,
                        lambda q=query: search_ytdl.extract_info(
                            q,
                            download=False,
                        )
                    ),
                    timeout=8,
                )
            except asyncio.TimeoutError:
                print(f"Autoplay query timed out: {query}")
                continue
            except Exception as e:
                print(f"Autoplay query failed for {query}: {e}")
                continue

            if not isinstance(info, dict):
                print(
                    f"Autoplay query returned invalid data for {query}: "
                    f"{type(info).__name__}"
                )
                continue

            print(
                f"Autoplay search: {query} | "
                f"entries={len(info.get('entries') or [])}"
            )

            entries = info.get("entries")

            if not entries:
                print(f"Autoplay search returned no entries for: {query}")
                continue

            entries = [
                entry
                for entry in entries
                if isinstance(entry, dict)
            ]

            if not entries:
                print(f"Autoplay search contained no valid entries for: {query}")
                continue

            random.shuffle(entries)

            for entry in entries:
                if not isinstance(entry, dict):
                    continue

                webpage_url = (
                        entry.get("webpage_url")
                        or entry.get("original_url")
                        or entry.get("url")
                )

                if webpage_url and not webpage_url.startswith("http"):
                    webpage_url = f"https://www.youtube.com/watch?v={webpage_url}"

                if not webpage_url:
                    continue

                candidate = {
                    "url": webpage_url,
                    "title": entry.get("title") or "Unknown",
                    "webpage_url": webpage_url,
                    "thumbnail": (
                            self.get_youtube_thumbnail(webpage_url)
                            or entry.get("thumbnail")
                    ),
                    "duration": entry.get("duration") or 0,
                    "uploader": (
                            entry.get("uploader")
                            or entry.get("channel")
                            or "Unknown"
                    ),
                    "artist": entry.get("artist"),
                    "creator": entry.get("creator"),
                    "views": entry.get("view_count"),
                    "likes": entry.get("like_count"),
                    "requester": requester,
                    "autoplay_generated": True,
                }

                candidate_signature = self.build_track_signature(candidate)

                if current_url and webpage_url == current_url:
                    continue

                if webpage_url in queued_urls:
                    continue

                if preloaded_url and webpage_url == preloaded_url:
                    continue

                if candidate_signature == current_signature:
                    continue

                if self.is_same_track(candidate, seed_song):
                    continue

                if any(
                        isinstance(song, dict)
                        and self.is_same_track(candidate, song)
                                for song in state.song_queue
                ):
                    continue

                if (
                        candidate_signature not in queued_signatures
                        and candidate_signature not in recent_signatures
                        and (
                        not preloaded_signature
                        or candidate_signature != preloaded_signature
                )
                ):
                    return candidate

                if relaxed_candidate is None:
                    relaxed_candidate = candidate

        return relaxed_candidate

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

    def make_audio_source(
            self,
            audio_url,
            *,
            http_headers=None,
            start_at=0.0,
            slowed=False,
            sped=False,
            bassboost=False,
            volume=1.0
    ):
        before = ffmpeg_options["before_options"]
        if start_at and start_at > 0:
            before = f"{before} -ss {start_at:.2f}"

        filters = []

        if slowed:
            filters.extend([
                "atempo=0.94",
                "asetrate=48000*0.94",
                "aresample=48000",
                "aecho=0.8:0.88:45:0.035",
            ])
        elif sped:
            filters.extend([
                "atempo=1.08",
                "asetrate=48000*1.08",
                "aresample=48000",
                "treble=g=1.0:f=4500:width_type=o:width=1.0:m=0.30",
            ])
        else:
            filters.append("aresample=48000")

        if bassboost:
            filters.extend([
                "bass=g=2.0:f=85:width_type=o:width=1.1:m=0.30",
                "volume=0.95"
            ])

        options = f'-vn -filter:a "{",".join(filters)}"' if filters else "-vn"

        if http_headers:
            header_string = "".join(
                f"{key}: {value}\r\n"
                for key, value in http_headers.items()
            )

            before = f'{before} -headers "{header_string}"'

        source = discord.FFmpegPCMAudio(
            audio_url,
            before_options=before,
            options=options
        )

        return discord.PCMVolumeTransformer(source, volume=volume)

    async def apply_current_mode(self, ctx) -> tuple[bool, str | None]:
        return await self._apply_current_mode_to_voice_client(ctx.guild.id, ctx.voice_client)

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

        embed_colour = song.get("embed_colour", discord.Color.red())

        embed = discord.Embed(
            title="Now Playing",
            description=f"**[{title}]({webpage_url})**" if webpage_url else f"**{title}**",
            colour=embed_colour
        )

        embed.add_field(name=f"{EMOJIS['musicduration']} Duration", value=duration_text, inline=True)
        embed.add_field(name=f"{EMOJIS['musicuploader']} Uploader", value=uploader, inline=True)
        embed.add_field(name=f"{EMOJIS['musicstatus']} Status", value=status_text, inline=True)

        embed.add_field(name=f"{EMOJIS['musicloop']} Loop", value="ON" if state.loop_song else "OFF", inline=True)
        embed.add_field(name=f"{EMOJIS['musicmode']} Mode", value=mode_text, inline=True)
        embed.add_field(name=f"{EMOJIS['musicqueue']} Queue", value=str(len(state.song_queue)), inline=True)

        if views is not None:
            embed.add_field(name=f"{EMOJIS['musicviews']} Views", value=f"{views:,}", inline=True)

        if likes is not None:
            embed.add_field(name=f"{EMOJIS['musiclikes']} Likes", value=f"{likes:,}", inline=True)

        if requester is not None:
            embed.add_field(name=f"{EMOJIS['musicrequester']} Requester", value=requester.mention, inline=True)

        embed.add_field(
            name=f"{EMOJIS['musicprogress']} Progress",
            value=f"`{elapsed_text} / {duration_text}`\n`{progress_bar}`",
            inline=True
        )

        embed.add_field(name=f"{EMOJIS['musicautoplay']} Autoplay", value="ON" if state.autoplay_mode else "OFF",
                        inline=True)
        embed.add_field(name=f"{EMOJIS['musicbassboost']} Bassboost", value="ON" if state.bassboost_mode else "OFF",
                        inline=True)

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
                embed=await self.build_now_playing_embed(state),
                view=state.now_playing_view
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

    def clean_lyrics_title(self, title: str) -> str:
        title = re.sub(
            r"\s*[\[(](?:official|lyrics?|lyric video|audio|video|visualizer|sped up|slowed|reverb|nightcore).*?[\])]",
            "",
            title,
            flags=re.IGNORECASE,
        )
        title = title.replace("|", "-")
        return " ".join(title.split()).strip(" -")

    def guess_artist_and_track(self, song: dict[str, Any]) -> tuple[str, str]:
        raw_title = self.clean_lyrics_title(song.get("title") or "")
        uploader = (song.get("uploader") or "").replace(" - Topic", "").replace("VEVO", "").strip()

        if " - " in raw_title:
            artist, track = raw_title.split(" - ", 1)
            artist = artist.strip()
            track = track.strip()
            if artist and track:
                return artist, track

        return uploader, raw_title

    async def fetch_lyrics_data(self, song: dict[str, Any]) -> dict[str, str] | None:
        artist, track = self.guess_artist_and_track(song)
        duration = int(song.get("duration") or 0)

        headers = {"User-Agent": "DiscordMusicBot/1.0"}

        async with aiohttp.ClientSession(headers=headers) as session:
            params = {"track_name": track}
            if artist:
                params["artist_name"] = artist
            if duration > 0:
                params["duration"] = duration

            async with session.get("https://lrclib.net/api/get", params=params) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    lyrics = data.get("plainLyrics") or data.get("syncedLyrics")
                    if lyrics:
                        return {
                            "artist": data.get("artistName") or artist or "Unknown",
                            "track": data.get("trackName") or track or song.get("title", "Unknown"),
                            "lyrics": lyrics.strip(),
                        }

            search_params = {"track_name": track}
            if artist:
                search_params["artist_name"] = artist

            async with session.get("https://lrclib.net/api/search", params=search_params) as resp:
                if resp.status == 200:
                    results = await resp.json()
                    if isinstance(results, list):
                        for item in results:
                            lyrics = item.get("plainLyrics") or item.get("syncedLyrics")
                            if lyrics:
                                return {
                                    "artist": item.get("artistName") or artist or "Unknown",
                                    "track": item.get("trackName") or track or song.get("title", "Unknown"),
                                    "lyrics": lyrics.strip(),
                                }

        return None

    def trim_lyrics(self, text: str, limit: int = 3500) -> tuple[str, bool]:
        text = text.strip()
        if len(text) <= limit:
            return text, False
        return text[: limit - 3].rstrip() + "...", True

    def build_lyrics_embed(self, data: dict[str, str]) -> discord.Embed:
        lyrics_text, was_trimmed = self.trim_lyrics(data["lyrics"])

        embed = discord.Embed(
            title=f"🎤 Lyrics — {data['track']}",
            description=lyrics_text,
            colour=discord.Color.purple(),
        )
        embed.add_field(name="Artist", value=data["artist"], inline=True)

        if was_trimmed:
            embed.set_footer(text="Lyrics were truncated to fit in one message.")

        return embed

########################################################################################################################
# AUTOPLAY
########################################################################################################################

    @commands.hybrid_command(name="autoplay", description="Toggles autoplay mode.")
    async def autoplay(self, ctx: commands.Context, mode: Optional[str] = None):
        state = self.get_state(ctx.guild.id)

        if mode is None:
            state.autoplay_mode = not state.autoplay_mode
        else:
            mode = mode.lower().strip()
            if mode in ("on", "true", "yes", "1"):
                state.autoplay_mode = True
            elif mode in ("off", "false", "no", "0"):
                state.autoplay_mode = False
            else:
                return await ctx.send(embed=self.warning_embed("Use `?autoplay`, `?autoplay on`, or `?autoplay off`.", title="Invalid Usage"))

        await ctx.send(
            embed=self.info_embed(
                f"Autoplay is now **{'ON' if state.autoplay_mode else 'OFF'}**.",
                title="Autoplay Updated"
            )
        )

        if state.autoplay_mode and state.current_song is not None and not state.song_queue:
            self.schedule_preload_next(ctx.guild.id)
        elif not state.autoplay_mode:
            if state.preload_task and not state.preload_task.done():
                state.preload_task.cancel()
            state.preload_task = None
            state.preloaded = None

        await self.update_now_playing_embed(ctx.guild.id)

########################################################################################################################
# PLAY
########################################################################################################################

    @commands.hybrid_command(name="play", description="Adds a song to the queue or starts playback.")
    async def play(self, ctx: commands.Context, *, query: str):
        if ctx.interaction:
            await ctx.defer()

        state = self.get_state(ctx.guild.id)

        if not ctx.author.voice:
            return await ctx.send(
                embed=self.warning_embed("You must be in a voice channel!", title="Voice Required")
            )

        if ctx.voice_client and ctx.voice_client.channel != ctx.author.voice.channel:
            return await ctx.send(
                embed=self.warning_embed(
                    f"I'm already being used in **{ctx.voice_client.channel}**.",
                    title="Bot Is Busy"
                )
            )

        if not ctx.voice_client:
            await ctx.author.voice.channel.connect()
            await asyncio.sleep(0.5)

        try:
            queue_song = await self.resolve_query_to_queue_song(ctx, query)
        except Exception as e:
            return await ctx.send(
                embed=self.error_embed(
                    f"Couldn't load this track:\n```py\n{e}\n```",
                    title="Track Load Failed"
                )
            )

        state.song_queue.append(queue_song)
        state.preloaded = None

        if ctx.voice_client.is_playing() or ctx.voice_client.is_paused():
            await ctx.send(
                embed=self.success_embed(
                    f"Added to queue: **[{queue_song['title']}]({queue_song['webpage_url']})**",
                    title="Queued"
                )
            )
        else:
            await self.play_next(ctx)

    async def play_next(self, ctx) -> None:
        state = self.get_state(ctx.guild.id)
        vc = ctx.voice_client

        if not vc or not vc.is_connected():
            return

        should_disconnect = False
        queued_song = None
        fresh_song = None
        audio_url = None
        previous_song = None

        async with state.lock:
            previous_song = state.current_song.copy() if state.current_song else None

            if state.loop_song and previous_song and not state.skip_once:
                queued_song = previous_song.copy()
                fresh_song = previous_song.copy()
                audio_url = previous_song.get("audio_url")
            else:
                state.skip_once = False

                if state.song_queue:
                    queued_song = state.song_queue.pop(0)

                    if state.queue_loop:
                        state.song_queue.append(queued_song.copy())

                    track_url = queued_song.get("url") or queued_song.get("webpage_url")

                    if state.preloaded and state.preloaded.get("track_url") == track_url:
                        fresh_song = state.preloaded.get("fresh_song")
                        audio_url = state.preloaded.get("audio_url")
                        state.preloaded = None

                elif state.preloaded is not None:
                    queued_song = state.preloaded.get("queued_song")
                    fresh_song = state.preloaded.get("fresh_song")
                    audio_url = state.preloaded.get("audio_url")
                    state.preloaded = None

        if queued_song is None:
            if state.autoplay_mode and previous_song is not None:
                for attempt in range(3):
                    try:
                        auto_song = await self.get_autoplay_song(
                            state,
                            previous_song,
                            requester=previous_song.get("requester")
                        )
                        if auto_song is not None:
                            queued_song = auto_song
                            break
                    except Exception as e:
                        print(f"Autoplay lookup failed on attempt {attempt + 1}: {e}")

                    await asyncio.sleep(0.75)

                    async with state.lock:
                        if state.preloaded is not None:
                            queued_song = state.preloaded.get("queued_song")
                            fresh_song = state.preloaded.get("fresh_song")
                            audio_url = state.preloaded.get("audio_url")
                            state.preloaded = None
                            break

            if queued_song is None:
                print("Autoplay failed: no valid candidate found, disconnecting.")
                should_disconnect = True

        if should_disconnect:
            await self.reset_state(ctx.guild.id, clear_queue=True)

            if vc and vc.is_connected():
                await vc.disconnect()

            await ctx.channel.send(
                embed=self.info_embed(
                    "Queue finished. Disconnected from the voice channel.",
                    title="Disconnected"
                )
            )
            return

        if queued_song is None:
            return

        try:
            track_url = queued_song.get("url") or queued_song.get("webpage_url")

            if not track_url:
                await ctx.send(
                    embed=self.error_embed(
                        "This queued track has no playable URL. Skipping it.",
                        title="Playback Failed"
                    )
                )
                return await self.play_next(ctx)

            if self.is_spotify_track_url(track_url):
                await ctx.send(
                    embed=self.error_embed(
                        "A Spotify link reached the playback stage instead of a resolved YouTube link. Skipping it.",
                        title="Playback Failed"
                    )
                )
                return await self.play_next(ctx)

            if fresh_song is None or not audio_url:
                fresh_song = await self.get_song_info(track_url)
                audio_url = fresh_song.get("audio_url")

            if audio_url:
                webpage_url = fresh_song.get("webpage_url") or track_url

                if audio_url == webpage_url or audio_url.startswith(
                        "https://www.youtube.com/watch?"
                ):
                    fresh_song = await self.get_song_info(track_url)
                    audio_url = fresh_song.get("audio_url")

        except Exception as e:
            await ctx.send(
                embed=self.error_embed(
                    f"Couldn't load this track, so it was skipped:\n```py\n{e}\n```",
                    title="Track Load Failed"
                )
            )
            return await self.play_next(ctx)

        if not audio_url:
            await ctx.send(
                embed=self.error_embed(
                    "Couldn't get a playable stream for this track. Skipping it.",
                    title="Playback Failed"
                )
            )
            return await self.play_next(ctx)

        async with state.lock:
            state.current_song = {
                "url": fresh_song.get("url", queued_song.get("url")),
                "title": fresh_song.get("title", queued_song.get("title", "Unknown")),
                "webpage_url": fresh_song.get("webpage_url", queued_song.get("webpage_url", "")),
                "audio_url": audio_url,
                "thumbnail": fresh_song.get("thumbnail", queued_song.get("thumbnail")),
                "duration": fresh_song.get("duration", queued_song.get("duration", 0)),
                "uploader": fresh_song.get("uploader", queued_song.get("uploader", "Unknown")),
                "views": fresh_song.get("views", queued_song.get("views")),
                "likes": fresh_song.get("likes", queued_song.get("likes")),
                "requester": queued_song.get("requester"),
                "source_platform": queued_song.get("source_platform", "youtube"),
                "autoplay_generated": queued_song.get("autoplay_generated", False),
            }

            if state.current_song.get("autoplay_generated"):
                self.remember_autoplay_track(state, state.current_song)

            thumbnail = state.current_song.get("thumbnail")
            if thumbnail:
                colour = await self.get_dominant_colour_from_url(thumbnail)
                state.current_song["embed_colour"] = colour
            else:
                state.current_song["embed_colour"] = discord.Color.red()

        source = self.make_audio_source(
            audio_url,
            http_headers=fresh_song.get("http_headers"),
            slowed=state.slowed_mode,
            sped=state.sped_mode,
            bassboost=state.bassboost_mode,
            volume=state.current_volume
        )

        def after_playback(error):
            if error:
                print(f"Playback error: {error}")

            future = asyncio.run_coroutine_threadsafe(self.play_next(ctx), self.bot.loop)

            def _log_future_result(fut):
                exc = fut.exception()
                if exc:
                    print(f"Error in play_next: {exc}")

            future.add_done_callback(_log_future_result)

        if not vc or not vc.is_connected():
            return

        vc.play(source, after=after_playback)

        async with state.lock:
            state.play_started_at = time.monotonic()
            state.paused_at = None
            state.paused_total = 0.0

            if state.now_playing_updater:
                state.now_playing_updater.cancel()
                state.now_playing_updater = None

            if state.now_playing_message:
                try:
                    await state.now_playing_message.delete()
                except Exception:
                    pass

            state.now_playing_message = None
            state.now_playing_view = None

        self.schedule_preload_next(ctx.guild.id)

        view = MusicControls(self, ctx.guild.id)
        state.now_playing_view = view

        state.now_playing_message = await ctx.channel.send(
            embed=await self.build_now_playing_embed(state),
            view=view
        )
        view.message = state.now_playing_message

        state.now_playing_updater = asyncio.create_task(
            self.now_playing_progress_loop(ctx.guild.id, state.current_song["url"])
        )

########################################################################################################################
# PAUSE
########################################################################################################################

    @commands.hybrid_command(name="pause", description="Pauses the current song.")
    async def pause(self, ctx: commands.Context):
        state = self.get_state(ctx.guild.id)

        if ctx.voice_client and ctx.voice_client.is_playing():
            ctx.voice_client.pause()
            state.paused_at = time.monotonic()
            await ctx.send(embed=self.info_embed("Playback has been paused.", title="Paused"))
            await self.update_now_playing_embed(ctx.guild.id)
        else:
            await ctx.send(embed=self.warning_embed("No song is playing!", title="Nothing Playing"))

########################################################################################################################
# RESUME
########################################################################################################################

    @commands.hybrid_command(name="resume", description="Resumes the paused song.")
    async def resume(self, ctx: commands.Context):
        state = self.get_state(ctx.guild.id)

        if ctx.voice_client and ctx.voice_client.is_paused():
            ctx.voice_client.resume()
            if state.paused_at is not None:
                state.paused_total += time.monotonic() - state.paused_at
                state.paused_at = None
            await ctx.send(embed=self.success_embed("Playback has been resumed.", title="Resumed"))
            await self.update_now_playing_embed(ctx.guild.id)
        else:
            await ctx.send(embed=self.warning_embed("No song is paused!", title="Nothing Paused"))

########################################################################################################################
# SKIP
########################################################################################################################

    @commands.hybrid_command(name="skip", description="Skips the current song.")
    async def skip(self, ctx: commands.Context):
        vc = ctx.voice_client
        if not vc or not vc.is_connected():
            return await ctx.send(embed=self.info_embed("I'm not in a voice channel."))

        if not (vc.is_playing() or vc.is_paused()):
            return await ctx.send(embed=self.info_embed("There is nothing to skip."))

        state = self.get_state(ctx.guild.id)

        async with state.lock:
            state.skip_once = True
            vc.stop()

########################################################################################################################
# QUEUE
########################################################################################################################

    @commands.hybrid_group(
        name="queue",
        description="Shows the queue and queue settings.",
        fallback="show"
    )
    async def queue(self, ctx: commands.Context):
        state = self.get_state(ctx.guild.id)

        if not state.current_song and not state.song_queue:
            return await ctx.send(
                embed=self.warning_embed("Queue is empty!", title="Empty Queue")
            )

        lines = []

        if state.current_song:
            lines.append(
                f"**Now Playing:**\n🎶 **[{state.current_song['title']}]({state.current_song['webpage_url']})**"
            )

        if state.song_queue:
            shown_songs = state.song_queue[:15]
            queue_text = "\n".join(
                f"`{i}.` **[{song['title']}]({song['webpage_url']})**"
                for i, song in enumerate(shown_songs, start=1)
            )

            if len(state.song_queue) > 15:
                queue_text += f"\n...and **{len(state.song_queue) - 15}** more."

            lines.append(f"**Up Next:**\n{queue_text}")
        else:
            lines.append("**Up Next:**\nNo songs queued.")

        embed = discord.Embed(
            title="🎼 Music Queue",
            description="\n\n".join(lines),
            colour=discord.Color.blurple()
        )
        embed.add_field(
            name="Settings",
            value=(
                f"**Song Loop:** {'ON' if state.loop_song else 'OFF'}\n"
                f"**Queue Loop:** {'ON' if state.queue_loop else 'OFF'}"
            ),
            inline=False
        )
        embed.set_footer(text=f"Total queued: {len(state.song_queue)}")

        await ctx.send(embed=embed)

########################################################################################################################
# QUEUE LOOP
########################################################################################################################

    @queue.command(name="loop", description="Toggles queue looping.")
    async def queue_loop(self, ctx: commands.Context, mode: Optional[str] = None):
        state = self.get_state(ctx.guild.id)

        if mode is None:
            state.queue_loop = not state.queue_loop
        else:
            mode = mode.lower().strip()
            if mode in ("on", "true", "yes", "1"):
                state.queue_loop = True
            elif mode in ("off", "false", "no", "0"):
                state.queue_loop = False
            else:
                return await ctx.send(
                    embed=self.warning_embed(
                        "Use `?queue loop`, `?queue loop on`, or `?queue loop off`.",
                        title="Invalid Usage"
                    )
                )

        await ctx.send(
            embed=self.info_embed(
                f"Queue loop is now **{'ON' if state.queue_loop else 'OFF'}**.",
                title="Queue Loop Updated"
            )
        )
        await self.update_now_playing_embed(ctx.guild.id)

########################################################################################################################
# SHUFFLE
########################################################################################################################

    @commands.hybrid_command(name="shuffle", description="Shuffles the current queue.")
    async def shuffle(self, ctx: commands.Context):
        state = self.get_state(ctx.guild.id)

        if len(state.song_queue) < 2:
            return await ctx.send(
                embed=self.warning_embed("You need at least 2 songs in the queue to shuffle it.",
                                         title="Not Enough Songs")
            )

        random.shuffle(state.song_queue)

        await ctx.send(
            embed=self.success_embed("The queue has been shuffled.", title="Queue Shuffled")
        )
        await self.update_now_playing_embed(ctx.guild.id)

########################################################################################################################
# JOIN
########################################################################################################################

    @commands.hybrid_command(name="join", description="Joins your current voice channel.")
    async def join(self, ctx: commands.Context):
        if not ctx.author.voice or not ctx.author.voice.channel:
            return await ctx.send(
                embed=self.warning_embed("You must be in a voice channel!", title="Voice Required")
            )

        if ctx.voice_client:
            if ctx.voice_client.channel == ctx.author.voice.channel:
                return await ctx.send(
                    embed=self.info_embed("I'm already in your voice channel.", title="Already Connected")
                )

            await ctx.voice_client.move_to(ctx.author.voice.channel)
            return await ctx.send(
                embed=self.success_embed(f"Moved to **{ctx.author.voice.channel}**.", title="Voice Connected")
            )

        await ctx.author.voice.channel.connect()
        await ctx.send(
            embed=self.success_embed(f"Joined **{ctx.author.voice.channel}**.", title="Voice Connected")
        )

########################################################################################################################
# LEAVE
########################################################################################################################

    @commands.hybrid_command(name="leave", description="Stops playback and disconnects from voice.")
    async def leave(self, ctx: commands.Context):
        if not ctx.voice_client or not ctx.voice_client.is_connected():
            return await ctx.send(
                embed=self.warning_embed("I'm not in a voice channel.", title="Not Connected")
            )

        try:
            ctx.voice_client.stop()
        except Exception:
            pass

        await self.reset_state(ctx.guild.id, clear_queue=True)
        await ctx.voice_client.disconnect()
        await ctx.send(embed=self.info_embed("Disconnected from the voice channel.", title="Disconnected"))

########################################################################################################################
# LOOP
########################################################################################################################

    @commands.hybrid_command(name="loop", description="Toggles looping for the current song.")
    async def loop(self, ctx: commands.Context, mode: Optional[str] = None):
        state = self.get_state(ctx.guild.id)

        if mode is None:
            state.loop_song = not state.loop_song
        else:
            mode = mode.lower().strip()
            if mode in ("on", "true", "yes", "1"):
                state.loop_song = True
            elif mode in ("off", "false", "no", "0"):
                state.loop_song = False
            else:
                return await ctx.send(embed=self.warning_embed("Use `?loop`, `?loop on`, or `?loop off`.", title="Invalid Usage"))

        await ctx.send(embed=self.info_embed(f"Loop is now **{'ON' if state.loop_song else 'OFF'}**.", title="Loop Updated"))
        await self.update_now_playing_embed(ctx.guild.id)

########################################################################################################################
# VOLUME
########################################################################################################################

    @commands.hybrid_command(name="volume", description="Sets playback volume.")
    async def volume(self, ctx: commands.Context, volume: int):
        state = self.get_state(ctx.guild.id)

        if volume < 0 or volume > 200:
            return await ctx.send(embed=self.warning_embed("Volume must be between `0` and `200`.", title="Invalid Volume"))

        state.current_volume = volume / 100

        if ctx.voice_client and ctx.voice_client.source:
            if isinstance(ctx.voice_client.source, discord.PCMVolumeTransformer):
                ctx.voice_client.source.volume = state.current_volume
            else:
                ctx.voice_client.source = discord.PCMVolumeTransformer(
                    ctx.voice_client.source,
                    volume=state.current_volume
                )

            await ctx.send(embed=self.success_embed(f"Volume set to {volume}%.", title="Volume Updated"))
            await self.update_now_playing_embed(ctx.guild.id)
        else:
            await ctx.send(embed=self.warning_embed("No song is playing!", title="Nothing Playing"))

########################################################################################################################
# SLOWED
########################################################################################################################

    @commands.hybrid_command(name="slowed", description="Toggles slowed mode.")
    async def slowed(self, ctx: commands.Context, mode: Optional[str] = None):
        state = self.get_state(ctx.guild.id)

        if mode is None:
            state.slowed_mode = not state.slowed_mode
        else:
            mode = mode.lower().strip()
            if mode in ("on", "true", "yes", "1"):
                state.slowed_mode = True
            elif mode in ("off", "false", "no", "0"):
                state.slowed_mode = False
            else:
                return await ctx.send(
                    embed=self.warning_embed(
                        "Use `?slowed`, `?slowed on`, or `?slowed off`.",
                        title="Invalid Usage"
                    )
                )

        if state.slowed_mode:
            state.sped_mode = False

        if ctx.voice_client and state.current_song:
            ok, error = await self.apply_current_mode(ctx)
            if not ok:
                return await ctx.send(
                    embed=self.error_embed(
                        error or "Couldn't apply slowed mode.",
                        title="Mode Change Failed"
                    )
                )

        await ctx.send(
            embed=self.info_embed(
                f"Slowed mode is now **{'ON' if state.slowed_mode else 'OFF'}**.",
                title="Mode Updated"
            )
        )
        await self.update_now_playing_embed(ctx.guild.id)

########################################################################################################################
# SPED
########################################################################################################################

    @commands.hybrid_command(name="sped", description="Toggles sped mode.")
    async def sped(self, ctx: commands.Context, mode: Optional[str] = None):
        state = self.get_state(ctx.guild.id)

        if mode is None:
            state.sped_mode = not state.sped_mode
        else:
            mode = mode.lower().strip()
            if mode in ("on", "true", "yes", "1"):
                state.sped_mode = True
            elif mode in ("off", "false", "no", "0"):
                state.sped_mode = False
            else:
                return await ctx.send(
                    embed=self.warning_embed(
                        "Use `?sped`, `?sped on`, or `?sped off`.",
                        title="Invalid Usage"
                    )
                )

        if state.sped_mode:
            state.slowed_mode = False

        if ctx.voice_client and state.current_song:
            ok, error = await self.apply_current_mode(ctx)
            if not ok:
                return await ctx.send(
                    embed=self.error_embed(
                        error or "Couldn't apply sped mode.",
                        title="Mode Change Failed"
                    )
                )

        await ctx.send(
            embed=self.info_embed(
                f"Sped mode is now **{'ON' if state.sped_mode else 'OFF'}**.",
                title="Mode Updated"
            )
        )
        await self.update_now_playing_embed(ctx.guild.id)

########################################################################################################################
# BASSBOOST
########################################################################################################################

    @commands.hybrid_command(name="bassboost", description="Toggles bassboost mode.")
    async def bassboost(self, ctx: commands.Context, mode: Optional[str] = None):
        state = self.get_state(ctx.guild.id)

        if mode is None:
            state.bassboost_mode = not state.bassboost_mode
        else:
            mode = mode.lower().strip()
            if mode in ("on", "true", "yes", "1"):
                state.bassboost_mode = True
            elif mode in ("off", "false", "no", "0"):
                state.bassboost_mode = False
            else:
                return await ctx.send(
                    embed=self.warning_embed(
                        "Use `?bassboost`, `?bassboost on`, or `?bassboost off`.",
                        title="Invalid Usage"
                    )
                )

        if ctx.voice_client and state.current_song:
            ok, error = await self.apply_current_mode(ctx)
            if not ok:
                return await ctx.send(
                    embed=self.error_embed(
                        error or "Couldn't apply bassboost mode.",
                        title="Mode Change Failed"
                    )
                )

        await ctx.send(
            embed=self.info_embed(
                f"BassBoost mode is now **{'ON' if state.bassboost_mode else 'OFF'}**.",
                title="Mode Updated"
            )
        )
        await self.update_now_playing_embed(ctx.guild.id)

########################################################################################################################
# CLEAR
########################################################################################################################

    @commands.hybrid_command(name="clear", description="Clears the queue.")
    async def clear(self, ctx: commands.Context):
        state = self.get_state(ctx.guild.id)

        if not state.song_queue:
            return await ctx.send(embed=self.warning_embed("Queue is already empty!", title="Empty Queue"))

        cleared = len(state.song_queue)
        state.song_queue.clear()
        await ctx.send(embed=self.info_embed(f"Cleared **{cleared}** song(s) from the queue.", title="Queue Cleared"))
        await self.update_now_playing_embed(ctx.guild.id)

########################################################################################################################
# REMOVE
########################################################################################################################

    @commands.hybrid_command(name="remove", description="Removes a song from the queue.")
    async def remove(self, ctx: commands.Context, position: int):
        state = self.get_state(ctx.guild.id)

        if not state.song_queue:
            return await ctx.send(embed=self.warning_embed("Queue is empty!", title="Empty Queue"))

        if position < 1 or position > len(state.song_queue):
            return await ctx.send(embed=self.warning_embed(f"Choose a number between `1` and `{len(state.song_queue)}`.", title="Invalid Queue Position"))

        removed_song = state.song_queue.pop(position - 1)
        await ctx.send(embed=self.info_embed(f"Removed **{removed_song['title']}** from the queue.", title="Removed"))
        await self.update_now_playing_embed(ctx.guild.id)

########################################################################################################################
# LYRICS
########################################################################################################################

    @commands.hybrid_command(name="lyrics", description="Shows lyrics for the current track.")
    async def lyrics(self, ctx: commands.Context):
        if ctx.interaction:
            await ctx.defer(ephemeral=True)

        state = self.get_state(ctx.guild.id)

        if state.current_song is None:
            return await ctx.send(
                embed=self.warning_embed("Nothing is playing!", title="Lyrics Unavailable"),
                ephemeral=True
            )

        data = await self.fetch_lyrics_data(state.current_song)
        if data is None:
            return await ctx.send(
                embed=self.warning_embed(
                    "Couldn't find lyrics for the current track.",
                    title="Lyrics Not Found"
                ),
                ephemeral=True
            )

        await ctx.send(embed=self.build_lyrics_embed(data), ephemeral=True)

########################################################################################################################
# ADD
########################################################################################################################

    @commands.hybrid_command(name="add", description="Adds a song to the queue without replacing /play.")
    async def add(self, ctx: commands.Context, *, query: str):
        if ctx.interaction:
            await ctx.defer()

        state = self.get_state(ctx.guild.id)

        if not ctx.author.voice:
            return await ctx.send(
                embed=self.warning_embed("You must be in a voice channel!", title="Voice Required")
            )

        if ctx.voice_client and ctx.voice_client.channel != ctx.author.voice.channel:
            return await ctx.send(
                embed=self.warning_embed(
                    f"I'm already being used in **{ctx.voice_client.channel}**.",
                    title="Bot Is Busy"
                )
            )

        if not ctx.voice_client:
            await ctx.author.voice.channel.connect()
            await asyncio.sleep(0.5)

        try:
            queue_song = await self.resolve_query_to_queue_song(ctx, query)
        except Exception as e:
            return await ctx.send(
                embed=self.error_embed(
                    f"Couldn't load this track:\n```py\n{e}\n```",
                    title="Track Load Failed"
                )
            )

        was_idle = not ctx.voice_client.is_playing() and not ctx.voice_client.is_paused()
        state.song_queue.append(queue_song)
        state.preloaded = None

        if was_idle:
            await ctx.send(
                embed=self.success_embed(
                    f"Added to queue and starting playback: **[{queue_song['title']}]({queue_song['webpage_url']})**",
                    title="Queued"
                )
            )
            await self.play_next(ctx)
        else:
            await ctx.send(
                embed=self.success_embed(
                    f"Added to queue: **[{queue_song['title']}]({queue_song['webpage_url']})**",
                    title="Queued"
                )
            )
            await self.update_now_playing_embed(ctx.guild.id)

async def setup(bot):
    await bot.add_cog(Music(bot))