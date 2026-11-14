"""Lyrics lookup for the current track."""

import re
from typing import Any

import aiohttp
import discord


class MusicLyricsMixin:
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
                                    "track": item.get("trackName")
                                    or track
                                    or song.get("title", "Unknown"),
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
            colour=discord.Colour.purple(),
        )
        embed.add_field(name="Artist", value=data["artist"], inline=True)

        if was_trimmed:
            embed.set_footer(text="Lyrics were truncated to fit in one message.")

        return embed
