"""Track lookup across YouTube and Spotify, autoplay selection and audio sources."""

import asyncio
import base64
import os
import random
import re
import urllib.parse
from typing import Any, cast

import aiohttp
import discord
import yt_dlp as youtube_dl
import yt_dlp.utils as ytdlp_utils
from dotenv import load_dotenv

from bot.utils.music.state import GuildMusicState

load_dotenv()

ytdlp_utils.bug_reports_message = lambda *args, **kwargs: ""

ytdl_format_options = {
    "format": "bestaudio[acodec=opus]/bestaudio/best",
    "noplaylist": True,
    "quiet": True,
    "default_search": "auto",
    "js_runtimes": {"deno": {}},
    "cookiefile": "/home/container/cookies.txt",
    "extractor_args": {"youtube": {"player_client": ["android_vr"]}},
}

search_ytdl_options: dict[str, Any] = {
    "quiet": True,
    "extract_flat": "in_playlist",
    "noplaylist": True,
    "default_search": "auto",
    "js_runtimes": {"deno": {}},
    "cookiefile": "/home/container/cookies.txt",
}

search_ytdl = youtube_dl.YoutubeDL(cast(Any, search_ytdl_options))

ffmpeg_options = {
    "before_options": ("-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5"),
    "options": "-vn",
}

ytdl = youtube_dl.YoutubeDL(cast(Any, ytdl_format_options))

spotify_track_url_re = re.compile(
    r"(?:https?://)?open\.spotify\.com/track/([A-Za-z0-9]+)(?:\?.*)?$"
)

spotify_client_id = os.getenv("SPOTIFY_CLIENT_ID")
spotify_client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")


class MusicSourcesMixin:
    def get_autoplay_search_terms(
        self,
        song: dict[str, Any],
    ) -> tuple[str, str]:
        raw_title = (song.get("title") or "").strip()
        artist = (song.get("artist") or song.get("creator") or song.get("channel") or "").strip()
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

    def remember_autoplay_track(
        self, state: GuildMusicState, song: dict[str, Any], max_items: int = 20
    ):
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
            "official video",
            "official audio",
            "official music video",
            "lyrics",
            "lyric video",
            "audio",
            "video",
            "visualizer",
            "sped up",
            "slowed",
            "reverb",
            "nightcore",
            "remastered",
            "hd",
            "hq",
            "mv",
            "topic",
            "vevo",
            "radio edit",
            "extended",
            "version",
            "live",
            "performance",
            "feat",
            "ft",
            "featuring",
            "prod",
            "produced by",
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
            "Content-Type": "application/x-www-form-urlencoded",
        }
        data = {"grant_type": "client_credentials"}

        async with aiohttp.ClientSession() as session:
            async with session.post(
                "https://accounts.spotify.com/api/token", headers=headers, data=data
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise RuntimeError(f"Spotify auth failed: {resp.status} - {error_text}")

                payload = await resp.json()
                token = payload.get("access_token")
                if not token:
                    raise RuntimeError("Spotify did not return an access token.")

                return token

    async def get_spotify_track_info(self, spotify_url: str) -> dict[str, Any]:
        track_id = self.extract_spotify_track_id(spotify_url)
        if not track_id:
            raise RuntimeError("Invalid Spotify track URL.")

        access_token = await self.get_spotify_access_token()
        headers = {"Authorization": f"Bearer {access_token}"}

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
            ),
        )
        info = cast(dict[str, Any], info)
        entries = info.get("entries")

        if isinstance(entries, list) and entries:
            first = entries[0]

            if isinstance(first, dict):
                info = cast(dict[str, Any], first)

        webpage_url = info.get("webpage_url") or info.get("original_url") or query
        audio_url = info.get("url")

        return {
            "query": query,
            "url": webpage_url,
            "title": info.get("title", "Unknown"),
            "webpage_url": webpage_url,
            "audio_url": audio_url,
            "http_headers": info.get("http_headers", {}),
            "duration": info.get("duration") or 0,
            "thumbnail": (self.get_youtube_thumbnail(webpage_url) or info.get("thumbnail")),
            "uploader": (info.get("uploader") or info.get("channel") or "Unknown"),
            "artist": info.get("artist"),
            "creator": info.get("creator"),
            "views": info.get("view_count"),
            "likes": info.get("like_count"),
        }

    async def get_autoplay_song(
        self, state: GuildMusicState, seed_song: dict[str, Any], requester=None
    ) -> dict[str, Any] | None:
        artist, track = self.get_autoplay_search_terms(seed_song)
        queries = []

        if artist and track:
            queries.extend(
                [
                    f"ytsearch15:{artist}",
                    f"ytsearch15:{artist} songs",
                    f"ytsearch15:{artist} music",
                    f"ytsearch15:{artist} - {track}",
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
            self.build_track_signature(song) for song in state.song_queue if isinstance(song, dict)
        }
        recent_signatures = set(state.autoplay_history)
        preloaded_url = None
        preloaded_signature = None

        if state.preloaded:
            preloaded_song = state.preloaded.get("queued_song")

            if isinstance(preloaded_song, dict):
                preloaded_url = preloaded_song.get("webpage_url") or preloaded_song.get("url")
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
                        ),
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
                print(f"Autoplay query returned invalid data for {query}: {type(info).__name__}")
                continue

            print(f"Autoplay search: {query} | entries={len(info.get('entries') or [])}")

            entries = info.get("entries")

            if not entries:
                print(f"Autoplay search returned no entries for: {query}")
                continue

            entries = [entry for entry in entries if isinstance(entry, dict)]

            if not entries:
                print(f"Autoplay search contained no valid entries for: {query}")
                continue

            random.shuffle(entries)

            for entry in entries:
                if not isinstance(entry, dict):
                    continue

                webpage_url = (
                    entry.get("webpage_url") or entry.get("original_url") or entry.get("url")
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
                        self.get_youtube_thumbnail(webpage_url) or entry.get("thumbnail")
                    ),
                    "duration": entry.get("duration") or 0,
                    "uploader": (entry.get("uploader") or entry.get("channel") or "Unknown"),
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
                    isinstance(song, dict) and self.is_same_track(candidate, song)
                    for song in state.song_queue
                ):
                    continue

                if (
                    candidate_signature not in queued_signatures
                    and candidate_signature not in recent_signatures
                    and (not preloaded_signature or candidate_signature != preloaded_signature)
                ):
                    return candidate

                if relaxed_candidate is None:
                    relaxed_candidate = candidate

        return relaxed_candidate

    def make_audio_source(
        self,
        audio_url,
        *,
        http_headers=None,
        start_at=0.0,
        slowed=False,
        sped=False,
        bassboost=False,
        volume=1.0,
    ):
        before = ffmpeg_options["before_options"]
        if start_at and start_at > 0:
            before = f"{before} -ss {start_at:.2f}"

        filters = []

        if slowed:
            filters.extend(
                [
                    "atempo=0.94",
                    "asetrate=48000*0.94",
                    "aresample=48000",
                    "aecho=0.8:0.88:45:0.035",
                ]
            )
        elif sped:
            filters.extend(
                [
                    "atempo=1.08",
                    "asetrate=48000*1.08",
                    "aresample=48000",
                    "treble=g=1.0:f=4500:width_type=o:width=1.0:m=0.30",
                ]
            )
        else:
            filters.append("aresample=48000")

        if bassboost:
            filters.extend(["bass=g=2.0:f=85:width_type=o:width=1.1:m=0.30", "volume=0.95"])

        options = f'-vn -filter:a "{",".join(filters)}"' if filters else "-vn"

        if http_headers:
            header_string = "".join(f"{key}: {value}\r\n" for key, value in http_headers.items())
            before = f'{before} -headers "{header_string}"'

        source = discord.FFmpegPCMAudio(audio_url, before_options=before, options=options)

        return discord.PCMVolumeTransformer(source, volume=volume)
