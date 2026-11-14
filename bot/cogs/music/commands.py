import asyncio
import random
import time
from typing import Any, Optional

import discord
from discord.ext import commands

from bot.utils.music.controls import MusicControls
from bot.utils.music.display import MusicDisplayMixin
from bot.utils.music.lyrics import MusicLyricsMixin
from bot.utils.music.sources import MusicSourcesMixin
from bot.utils.music.state import GuildMusicState


class Music(MusicSourcesMixin, MusicDisplayMixin, MusicLyricsMixin, commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.guild_states = {}

    def schedule_preload_next(self, guild_id: int):
        state = self.get_state(guild_id)

        if state.preload_task and not state.preload_task.done():
            state.preload_task.cancel()

        state.preload_task = asyncio.create_task(self.preload_next(guild_id))

    async def _apply_current_mode_to_voice_client(
        self, guild_id: int, vc: discord.VoiceClient | None
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
            volume=state.current_volume,
        )
        vc.source = new_source
        state.play_started_at = time.monotonic() - position
        state.paused_at = None

        if was_paused:
            vc.pause()
            state.paused_at = time.monotonic()

        return True, None

    async def resolve_query_to_queue_song(
        self, ctx: commands.Context, query: str
    ) -> dict[str, Any]:
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
                except discord.HTTPException:
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
                    state, seed_song, requester=seed_song.get("requester")
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
                "audio_url": audio_url,
            }

            async with state.lock:
                state.preloaded = preloaded_data

        except asyncio.CancelledError:
            raise
        except Exception as e:
            print(f"preload_next failed: {e}")
            async with state.lock:
                state.preloaded = None

    def get_state(self, guild_id: int) -> GuildMusicState:
        if guild_id not in self.guild_states:
            self.guild_states[guild_id] = GuildMusicState()
        return self.guild_states[guild_id]

    async def apply_current_mode_from_interaction(
        self, interaction: discord.Interaction
    ) -> tuple[bool, str | None]:
        vc = interaction.guild.voice_client if interaction.guild else None
        return await self._apply_current_mode_to_voice_client(interaction.guild.id, vc)

    async def apply_current_mode(self, ctx) -> tuple[bool, str | None]:
        return await self._apply_current_mode_to_voice_client(ctx.guild.id, ctx.voice_client)

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
                return await ctx.send(
                    embed=self.warning_embed(
                        "Use `?autoplay`, `?autoplay on`, or `?autoplay off`.",
                        title="Invalid Usage",
                    )
                )

        await ctx.send(
            embed=self.info_embed(
                f"Autoplay is now **{'ON' if state.autoplay_mode else 'OFF'}**.",
                title="Autoplay Updated",
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

    async def join_and_resolve(self, ctx, query):
        if not ctx.author.voice:
            await ctx.send(
                embed=self.warning_embed("You must be in a voice channel!", title="Voice Required")
            )
            return None

        if ctx.voice_client and ctx.voice_client.channel != ctx.author.voice.channel:
            await ctx.send(
                embed=self.warning_embed(
                    f"I'm already being used in **{ctx.voice_client.channel}**.",
                    title="Bot Is Busy",
                )
            )
            return None

        if not ctx.voice_client:
            await ctx.author.voice.channel.connect()
            await asyncio.sleep(0.5)

        try:
            return await self.resolve_query_to_queue_song(ctx, query)
        except Exception as e:
            await ctx.send(
                embed=self.error_embed(
                    f"Couldn't load this track:\n```py\n{e}\n```", title="Track Load Failed"
                )
            )
            return None

    @commands.hybrid_command(
        name="play", description="Adds a song to the queue or starts playback."
    )
    async def play(self, ctx: commands.Context, *, query: str):
        if ctx.interaction:
            await ctx.defer()

        state = self.get_state(ctx.guild.id)
        queue_song = await self.join_and_resolve(ctx, query)

        if queue_song is None:
            return

        state.song_queue.append(queue_song)
        state.preloaded = None

        if ctx.voice_client.is_playing() or ctx.voice_client.is_paused():
            await ctx.send(
                embed=self.success_embed(
                    f"Added to queue: **[{queue_song['title']}]({queue_song['webpage_url']})**",
                    title="Queued",
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
                            state, previous_song, requester=previous_song.get("requester")
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
                    "Queue finished. Disconnected from the voice channel.", title="Disconnected"
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
                        title="Playback Failed",
                    )
                )
                return await self.play_next(ctx)

            if self.is_spotify_track_url(track_url):
                await ctx.send(
                    embed=self.error_embed(
                        "A Spotify link reached the playback stage instead of a resolved YouTube link. Skipping it.",
                        title="Playback Failed",
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
                    title="Track Load Failed",
                )
            )
            return await self.play_next(ctx)

        if not audio_url:
            await ctx.send(
                embed=self.error_embed(
                    "Couldn't get a playable stream for this track. Skipping it.",
                    title="Playback Failed",
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
                state.current_song["embed_colour"] = discord.Colour.red()

        source = self.make_audio_source(
            audio_url,
            http_headers=fresh_song.get("http_headers"),
            slowed=state.slowed_mode,
            sped=state.sped_mode,
            bassboost=state.bassboost_mode,
            volume=state.current_volume,
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
                except discord.HTTPException:
                    pass

            state.now_playing_message = None
            state.now_playing_view = None

        self.schedule_preload_next(ctx.guild.id)

        view = MusicControls(self, ctx.guild.id)
        state.now_playing_view = view
        state.now_playing_message = await ctx.channel.send(
            embed=await self.build_now_playing_embed(state), view=view
        )
        view.message = state.now_playing_message
        state.now_playing_updater = asyncio.create_task(
            self.now_playing_progress_loop(ctx.guild.id, state.current_song["url"])
        )

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

    @commands.hybrid_group(
        name="queue", description="Shows the queue and queue settings.", fallback="show"
    )
    async def queue(self, ctx: commands.Context):
        state = self.get_state(ctx.guild.id)

        if not state.current_song and not state.song_queue:
            return await ctx.send(embed=self.warning_embed("Queue is empty!", title="Empty Queue"))

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
            title="🎼 Music Queue", description="\n\n".join(lines), colour=discord.Colour.blurple()
        )
        embed.add_field(
            name="Settings",
            value=(
                f"**Song Loop:** {'ON' if state.loop_song else 'OFF'}\n"
                f"**Queue Loop:** {'ON' if state.queue_loop else 'OFF'}"
            ),
            inline=False,
        )
        embed.set_footer(text=f"Total queued: {len(state.song_queue)}")

        await ctx.send(embed=embed)

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
                        title="Invalid Usage",
                    )
                )

        await ctx.send(
            embed=self.info_embed(
                f"Queue loop is now **{'ON' if state.queue_loop else 'OFF'}**.",
                title="Queue Loop Updated",
            )
        )
        await self.update_now_playing_embed(ctx.guild.id)

    @commands.hybrid_command(name="shuffle", description="Shuffles the current queue.")
    async def shuffle(self, ctx: commands.Context):
        state = self.get_state(ctx.guild.id)

        if len(state.song_queue) < 2:
            return await ctx.send(
                embed=self.warning_embed(
                    "You need at least 2 songs in the queue to shuffle it.",
                    title="Not Enough Songs",
                )
            )

        random.shuffle(state.song_queue)

        await ctx.send(
            embed=self.success_embed("The queue has been shuffled.", title="Queue Shuffled")
        )
        await self.update_now_playing_embed(ctx.guild.id)

    @commands.hybrid_command(name="join", description="Joins your current voice channel.")
    async def join(self, ctx: commands.Context):
        if not ctx.author.voice or not ctx.author.voice.channel:
            return await ctx.send(
                embed=self.warning_embed("You must be in a voice channel!", title="Voice Required")
            )

        if ctx.voice_client:
            if ctx.voice_client.channel == ctx.author.voice.channel:
                return await ctx.send(
                    embed=self.info_embed(
                        "I'm already in your voice channel.", title="Already Connected"
                    )
                )

            await ctx.voice_client.move_to(ctx.author.voice.channel)
            return await ctx.send(
                embed=self.success_embed(
                    f"Moved to **{ctx.author.voice.channel}**.", title="Voice Connected"
                )
            )

        await ctx.author.voice.channel.connect()
        await ctx.send(
            embed=self.success_embed(
                f"Joined **{ctx.author.voice.channel}**.", title="Voice Connected"
            )
        )

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
        await ctx.send(
            embed=self.info_embed("Disconnected from the voice channel.", title="Disconnected")
        )

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
                return await ctx.send(
                    embed=self.warning_embed(
                        "Use `?loop`, `?loop on`, or `?loop off`.", title="Invalid Usage"
                    )
                )

        await ctx.send(
            embed=self.info_embed(
                f"Loop is now **{'ON' if state.loop_song else 'OFF'}**.", title="Loop Updated"
            )
        )
        await self.update_now_playing_embed(ctx.guild.id)

    @commands.hybrid_command(name="volume", description="Sets playback volume.")
    async def volume(self, ctx: commands.Context, volume: int):
        state = self.get_state(ctx.guild.id)

        if volume < 0 or volume > 200:
            return await ctx.send(
                embed=self.warning_embed(
                    "Volume must be between `0` and `200`.", title="Invalid Volume"
                )
            )

        state.current_volume = volume / 100

        if ctx.voice_client and ctx.voice_client.source:
            if isinstance(ctx.voice_client.source, discord.PCMVolumeTransformer):
                ctx.voice_client.source.volume = state.current_volume
            else:
                ctx.voice_client.source = discord.PCMVolumeTransformer(
                    ctx.voice_client.source, volume=state.current_volume
                )

            await ctx.send(
                embed=self.success_embed(f"Volume set to {volume}%.", title="Volume Updated")
            )
            await self.update_now_playing_embed(ctx.guild.id)
        else:
            await ctx.send(embed=self.warning_embed("No song is playing!", title="Nothing Playing"))

    async def toggle_mode(self, ctx, mode, name, label, *, excludes=None):
        state = self.get_state(ctx.guild.id)
        attribute = f"{name}_mode"

        if mode is None:
            setattr(state, attribute, not getattr(state, attribute))
        else:
            mode = mode.lower().strip()
            if mode in ("on", "true", "yes", "1"):
                setattr(state, attribute, True)
            elif mode in ("off", "false", "no", "0"):
                setattr(state, attribute, False)
            else:
                return await ctx.send(
                    embed=self.warning_embed(
                        f"Use `?{name}`, `?{name} on`, or `?{name} off`.", title="Invalid Usage"
                    )
                )

        enabled = getattr(state, attribute)

        if enabled and excludes:
            setattr(state, f"{excludes}_mode", False)

        if ctx.voice_client and state.current_song:
            ok, error = await self.apply_current_mode(ctx)
            if not ok:
                return await ctx.send(
                    embed=self.error_embed(
                        error or f"Couldn't apply {name} mode.", title="Mode Change Failed"
                    )
                )

        await ctx.send(
            embed=self.info_embed(
                f"{label} mode is now **{'ON' if enabled else 'OFF'}**.", title="Mode Updated"
            )
        )
        await self.update_now_playing_embed(ctx.guild.id)

    @commands.hybrid_command(name="slowed", description="Toggles slowed mode.")
    async def slowed(self, ctx: commands.Context, mode: Optional[str] = None):
        await self.toggle_mode(ctx, mode, "slowed", "Slowed", excludes="sped")

    @commands.hybrid_command(name="sped", description="Toggles sped mode.")
    async def sped(self, ctx: commands.Context, mode: Optional[str] = None):
        await self.toggle_mode(ctx, mode, "sped", "Sped", excludes="slowed")

    @commands.hybrid_command(name="bassboost", description="Toggles bassboost mode.")
    async def bassboost(self, ctx: commands.Context, mode: Optional[str] = None):
        await self.toggle_mode(ctx, mode, "bassboost", "BassBoost")

    @commands.hybrid_command(name="clear", description="Clears the queue.")
    async def clear(self, ctx: commands.Context):
        state = self.get_state(ctx.guild.id)

        if not state.song_queue:
            return await ctx.send(
                embed=self.warning_embed("Queue is already empty!", title="Empty Queue")
            )

        cleared = len(state.song_queue)
        state.song_queue.clear()
        await ctx.send(
            embed=self.info_embed(
                f"Cleared **{cleared}** song(s) from the queue.", title="Queue Cleared"
            )
        )
        await self.update_now_playing_embed(ctx.guild.id)

    @commands.hybrid_command(name="remove", description="Removes a song from the queue.")
    async def remove(self, ctx: commands.Context, position: int):
        state = self.get_state(ctx.guild.id)

        if not state.song_queue:
            return await ctx.send(embed=self.warning_embed("Queue is empty!", title="Empty Queue"))

        if position < 1 or position > len(state.song_queue):
            return await ctx.send(
                embed=self.warning_embed(
                    f"Choose a number between `1` and `{len(state.song_queue)}`.",
                    title="Invalid Queue Position",
                )
            )

        removed_song = state.song_queue.pop(position - 1)
        await ctx.send(
            embed=self.info_embed(
                f"Removed **{removed_song['title']}** from the queue.", title="Removed"
            )
        )
        await self.update_now_playing_embed(ctx.guild.id)

    @commands.hybrid_command(name="lyrics", description="Shows lyrics for the current track.")
    async def lyrics(self, ctx: commands.Context):
        if ctx.interaction:
            await ctx.defer(ephemeral=True)

        state = self.get_state(ctx.guild.id)

        if state.current_song is None:
            return await ctx.send(
                embed=self.warning_embed("Nothing is playing!", title="Lyrics Unavailable"),
                ephemeral=True,
            )

        data = await self.fetch_lyrics_data(state.current_song)
        if data is None:
            return await ctx.send(
                embed=self.warning_embed(
                    "Couldn't find lyrics for the current track.", title="Lyrics Not Found"
                ),
                ephemeral=True,
            )

        await ctx.send(embed=self.build_lyrics_embed(data), ephemeral=True)

    @commands.hybrid_command(
        name="add", description="Adds a song to the queue without replacing /play."
    )
    async def add(self, ctx: commands.Context, *, query: str):
        if ctx.interaction:
            await ctx.defer()

        state = self.get_state(ctx.guild.id)
        queue_song = await self.join_and_resolve(ctx, query)

        if queue_song is None:
            return

        was_idle = not ctx.voice_client.is_playing() and not ctx.voice_client.is_paused()
        state.song_queue.append(queue_song)
        state.preloaded = None

        if was_idle:
            await ctx.send(
                embed=self.success_embed(
                    f"Added to queue and starting playback: **[{queue_song['title']}]({queue_song['webpage_url']})**",
                    title="Queued",
                )
            )
            await self.play_next(ctx)
        else:
            await ctx.send(
                embed=self.success_embed(
                    f"Added to queue: **[{queue_song['title']}]({queue_song['webpage_url']})**",
                    title="Queued",
                )
            )
            await self.update_now_playing_embed(ctx.guild.id)


async def setup(bot):
    await bot.add_cog(Music(bot))
