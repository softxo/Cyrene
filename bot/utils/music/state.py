"""Per-guild playback state for the music cog."""

import asyncio


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
