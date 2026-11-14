"""A shared content fingerprint identifies deployed code rather than process restarts."""

import hashlib
import time
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter()
ROOT = Path(__file__).resolve().parents[3]
_cached_at = 0.0
_version = ""


def site_version():
    global _cached_at, _version
    now = time.monotonic()
    if _version and now - _cached_at < 5:
        return _version
    files = list((ROOT / "website/templates").rglob("*.html"))
    files += list((ROOT / "website/static/build").rglob("*.js"))
    files += list((ROOT / "website/static/build").rglob("*.css"))
    for package in ("bot", "shared", "website/server"):
        files += list((ROOT / package).rglob("*.py"))
    signature = hashlib.sha256()
    for path in sorted(files):
        signature.update(path.relative_to(ROOT).as_posix().encode())
        signature.update(b"\0")
        signature.update(path.read_bytes())
        signature.update(b"\0")
    _version = signature.hexdigest()[:20]
    _cached_at = now
    return _version


@router.get("/api/site-version")
async def current_site_version():
    return JSONResponse({"version": site_version()}, headers={"Cache-Control": "no-store"})
