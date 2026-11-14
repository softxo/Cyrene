"""Converts uploaded videos to 1080p H.264 with the index first, so Discord embeds and streams them."""

import asyncio
import os
import shutil
import subprocess
from pathlib import PurePath

from shared.storage import upload_store
from shared.storage.database import get_pool
from shared.storage.upload_store import UPLOAD_DIR

CHECK_INTERVAL = 10
MAX_SIDE = 1920
TIMEOUT_SECONDS = 60 * 60
SCALE = f"scale=w='if(gte(iw,ih),min({MAX_SIDE},iw),-2)':h='if(gte(iw,ih),-2,min({MAX_SIDE},ih))'"
TONE_MAP = (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
    "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv"
)
HDR_TRANSFERS = ("smpte2084", "arib-std-b67")
SDR_TAGS = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"]


def ffmpeg_exe():
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def run(command):
    return subprocess.run(
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        timeout=TIMEOUT_SECONDS,
    )


def is_hdr(source):
    details = run([ffmpeg_exe(), "-hide_banner", "-i", str(source)]).stderr.decode(errors="replace")
    return any(transfer in details for transfer in HDR_TRANSFERS)


def ffmpeg_command(source, output, tone_map=False):
    filters = f"{SCALE},{TONE_MAP}" if tone_map else SCALE
    command = [
        ffmpeg_exe(),
        "-nostdin",
        "-y",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        f"{filters},format=yuv420p",
        *(SDR_TAGS if tone_map else []),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-maxrate",
        "8M",
        "-bufsize",
        "16M",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        "-threads",
        "2",
        str(output),
    ]
    if os.name == "posix" and (nice := shutil.which("nice")):
        command = [nice, "-n", "10", *command]
    return command


def scaled(width, height):
    if not width or not height or max(width, height) <= MAX_SIDE:
        return width, height
    factor = MAX_SIDE / max(width, height)
    shorter = round(min(width, height) * factor / 2) * 2
    return (MAX_SIDE, shorter) if width >= height else (shorter, MAX_SIDE)


async def convert(upload):
    source = UPLOAD_DIR / upload["id"]
    output = UPLOAD_DIR / f".{upload['id']}.convert.mp4"
    try:
        hdr = await asyncio.to_thread(is_hdr, source)
        result = await asyncio.to_thread(run, ffmpeg_command(source, output, tone_map=hdr))
        if result.returncode != 0 and hdr:
            print(f"[Uploads] HDR tone mapping failed for {upload['id']}; converting without it.")
            result = await asyncio.to_thread(run, ffmpeg_command(source, output))
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode(errors="replace")[-600:].strip())
        output.replace(source)
        width, height = scaled(upload["width"], upload["height"])
        await upload_store.finish_conversion(
            get_pool(),
            upload["id"],
            f"{PurePath(upload['filename']).stem}.mp4",
            source.stat().st_size,
            width,
            height,
        )
        print(f"[Uploads] Converted {upload['id']} ({upload['filename']}).")
    except Exception as error:
        output.unlink(missing_ok=True)
        await upload_store.set_status(get_pool(), upload["id"], "failed")
        print(f"[Uploads] Could not convert {upload['id']} ({upload['filename']}): {error}")


async def video_conversion_worker() -> None:
    """Convert queued videos one at a time until cancelled."""

    print("[Uploads] Video conversion worker started.")
    while True:
        try:
            for upload in await upload_store.list_processing(get_pool()):
                await convert(upload)
        except asyncio.CancelledError:
            raise
        except Exception as error:
            print(f"[Uploads] Video conversion worker error: {error}")
        await asyncio.sleep(CHECK_INTERVAL)
