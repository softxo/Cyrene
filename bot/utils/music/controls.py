"""Button controls attached to the now playing message."""

import time

import discord

from shared.constants.emojis import MUSIC_EMOJIS as EMOJIS


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
                ephemeral=True,
            )
            return False

        if not interaction.user.voice or interaction.user.voice.channel != vc.channel:
            await interaction.response.send_message(
                embed=self.cog.warning_embed(
                    "You must be in my voice channel to use these controls.", title="Access Denied"
                ),
                ephemeral=True,
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
            except discord.HTTPException:
                pass

    @discord.ui.button(
        label="Pause",
        emoji=f"{EMOJIS['musicpauseresume']}",
        style=discord.ButtonStyle.secondary,
        row=0,
    )
    async def pause_resume_button(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ):
        state = self.get_state()
        vc = interaction.guild.voice_client

        if not vc:
            return await interaction.response.send_message(
                "I'm not in a voice channel.", ephemeral=True
            )

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
            embed=await self.cog.build_now_playing_embed(state), view=self
        )

    @discord.ui.button(
        label="Skip", emoji=f"{EMOJIS['musicskip']}", style=discord.ButtonStyle.secondary, row=0
    )
    async def skip_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()
        vc = interaction.guild.voice_client

        if not vc or not (vc.is_playing() or vc.is_paused()):
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Nothing is playing.", title="Nothing Playing"),
                ephemeral=True,
            )

        await interaction.response.defer(thinking=False)

        async with state.lock:
            state.skip_once = True
            vc.stop()

    @discord.ui.button(
        label="Mode: Normal",
        emoji=f"{EMOJIS['musicmode']}",
        style=discord.ButtonStyle.secondary,
        row=0,
    )
    async def mode_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()
        vc = interaction.guild.voice_client

        if vc is None or state.current_song is None:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Nothing is playing.", title="Nothing Playing"),
                ephemeral=True,
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
                    error or "Couldn't change mode.", title="Mode Change Failed"
                ),
                ephemeral=True,
            )

        self.refresh_button_labels()
        await interaction.message.edit(
            embed=await self.cog.build_now_playing_embed(state), view=self
        )

    @discord.ui.button(
        label="Loop: OFF",
        emoji=f"{EMOJIS['musicloop']}",
        style=discord.ButtonStyle.secondary,
        row=0,
    )
    async def loop_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await interaction.response.defer(thinking=False)
        state = self.get_state()
        state.loop_song = not state.loop_song

        self.refresh_button_labels()
        await interaction.message.edit(
            embed=await self.cog.build_now_playing_embed(state), view=self
        )

    @discord.ui.button(
        label="Stop", emoji=f"{EMOJIS['musicstop']}", style=discord.ButtonStyle.secondary, row=0
    )
    async def stop_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        vc = interaction.guild.voice_client

        if not vc:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Nothing is playing.", title="Nothing Playing"),
                ephemeral=True,
            )

        await interaction.response.defer(thinking=False)

        for item in self.children:
            item.disabled = True

        try:
            await interaction.message.edit(
                embed=self.cog.info_embed("Playback stopped.", title="Stopped"), view=self
            )
        except discord.HTTPException:
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

    @discord.ui.button(
        label="Autoplay: OFF",
        emoji=f"{EMOJIS['musicautoplay']}",
        style=discord.ButtonStyle.secondary,
        row=1,
    )
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
            embed=await self.cog.build_now_playing_embed(state), view=self
        )

    @discord.ui.button(
        label="Bassboost: OFF",
        emoji=f"{EMOJIS['musicbassboost']}",
        style=discord.ButtonStyle.secondary,
        row=1,
    )
    async def bassboost_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()
        vc = interaction.guild.voice_client

        if vc is None or state.current_song is None:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Nothing is playing.", title="Nothing Playing"),
                ephemeral=True,
            )

        await interaction.response.defer(thinking=False)

        async with state.lock:
            state.bassboost_mode = not state.bassboost_mode
            ok, error = await self.cog.apply_current_mode_from_interaction(interaction)
        if not ok:
            return await interaction.followup.send(
                embed=self.cog.error_embed(
                    error or "Couldn't change bassboost mode.", title="Mode Change Failed"
                ),
                ephemeral=True,
            )

        self.refresh_button_labels()
        await interaction.message.edit(
            embed=await self.cog.build_now_playing_embed(state), view=self
        )

    @discord.ui.button(
        label="Queue", emoji=f"{EMOJIS['musicqueue']}", style=discord.ButtonStyle.secondary, row=1
    )
    async def queue_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()

        if not state.current_song and not state.song_queue:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Queue is empty!", title="Empty Queue"), ephemeral=True
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
            title="Music Queue", description="\n\n".join(lines), colour=discord.Colour.blurple()
        )
        embed.set_footer(
            text=(
                f"Total queued: {len(state.song_queue)} | "
                f"Loop: {'ON' if state.loop_song else 'OFF'} | "
                f"Queue Loop: {'ON' if state.queue_loop else 'OFF'}"
            )
        )

        await interaction.response.send_message(embed=embed, ephemeral=True)

    @discord.ui.button(
        label="Lyrics", emoji=f"{EMOJIS['musiclyrics']}", style=discord.ButtonStyle.secondary, row=1
    )
    async def lyrics_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        state = self.get_state()

        if state.current_song is None:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed("Nothing is playing!", title="Lyrics Unavailable"),
                ephemeral=True,
            )

        data = await self.cog.fetch_lyrics_data(state.current_song)
        if data is None:
            return await interaction.response.send_message(
                embed=self.cog.warning_embed(
                    "Couldn't find lyrics for the current track.", title="Lyrics Not Found"
                ),
                ephemeral=True,
            )

        await interaction.response.send_message(
            embed=self.cog.build_lyrics_embed(data), ephemeral=True
        )
