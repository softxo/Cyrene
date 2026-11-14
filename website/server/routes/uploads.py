"""Special-only file hosting with public share pages that Discord embeds."""

import os
import re
import secrets
from urllib.parse import unquote

from fastapi import APIRouter, Cookie, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse

from shared.storage import upload_store
from shared.storage.account_limits import SPECIAL_USER_IDS
from shared.storage.database import get_pool
from shared.storage.upload_store import UPLOAD_DIR
from website.server.core.auth import get_web_session, verification_redirect
from website.server.core.templating import templates

router = APIRouter()
SITE_URL = (os.getenv("SITE_URL") or "https://cyrene-teyvat.xyz").rstrip("/")
MAX_UPLOAD_BYTES = 500 * 1024 * 1024
MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024
UPLOAD_ID = re.compile(r"[A-Za-z0-9_-]{12}")
CONTENT_TYPE = re.compile(r"[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*")
SANDBOX = "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'"


async def special_user(cyrene_session):
    session = await get_web_session(cyrene_session)
    if session is None:
        raise HTTPException(401, "Sign in to manage uploads.")
    if session.user_id not in SPECIAL_USER_IDS:
        raise HTTPException(403, "Uploads are only available to special accounts.")
    return session.user_id


def file_path(upload_id):
    if not UPLOAD_ID.fullmatch(upload_id):
        raise HTTPException(404, "File not found")
    return UPLOAD_DIR / upload_id


def thumbnail_path(upload_id):
    return UPLOAD_DIR / f"{upload_id}.jpg"


def kind(content_type):
    if content_type.startswith("video/"):
        return "video"
    if content_type.startswith("image/") and content_type != "image/svg+xml":
        return "image"
    if content_type.startswith("audio/"):
        return "audio"
    return "file"


def served_type(content_type):
    if kind(content_type) != "file" or content_type == "application/pdf":
        return content_type, True
    if content_type.startswith("text/") or content_type == "application/json":
        return "text/plain; charset=utf-8", True
    return content_type, False


def readable_size(size):
    for unit in ("bytes", "KB", "MB"):
        if size < 1024:
            return f"{size} {unit}" if unit == "bytes" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.2f} GB"


def clean_filename(raw):
    name = unquote(raw or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(character for character in name if character.isprintable()).strip()
    return name[:200] or "file"


def dimension(raw):
    try:
        value = int(raw or "")
    except ValueError:
        return None
    return value if 0 < value <= 10000 else None


def described(upload):
    return dict(
        upload,
        kind=kind(upload["content_type"]),
        size_label=readable_size(upload["size"]),
        page_url=f"{SITE_URL}/f/{upload['id']}",
        file_path=f"/f/{upload['id']}/file?v={upload['size']}",
        file_url=f"{SITE_URL}/f/{upload['id']}/file?v={upload['size']}",
        thumbnail_url=f"{SITE_URL}/f/{upload['id']}/thumbnail.jpg"
        if upload["has_thumbnail"]
        else None,
    )


def json_upload(upload):
    item = described(upload)
    return {
        key: item[key]
        for key in ("id", "filename", "kind", "size_label", "page_url", "file_url", "status")
    } | {"created_label": f"{upload['created_at']:%d %b %Y, %H:%M}"}


async def save_stream(request, destination, limit):
    partial = destination.with_name(f".{destination.name}.part")
    size = 0
    try:
        with partial.open("wb") as handle:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"Files can be up to {readable_size(limit)}.")
                handle.write(chunk)
        if size == 0:
            raise HTTPException(422, "The file is empty.")
        partial.replace(destination)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    return size


@router.get("/uploads", response_class=HTMLResponse)
async def uploads_page(request: Request, cyrene_session: str | None = Cookie(default=None)):
    session = await get_web_session(cyrene_session)
    if session is None:
        return verification_redirect("/uploads")
    if session.user_id not in SPECIAL_USER_IDS:
        raise HTTPException(404, "Page not found")
    uploads = await upload_store.list_for(get_pool(), session.user_id)
    return templates.TemplateResponse(
        request=request,
        name="uploads/manage.html",
        context={
            "request": request,
            "uploads": [json_upload(upload) for upload in uploads],
            "total_label": readable_size(sum(upload["size"] for upload in uploads)),
            "limit_label": readable_size(MAX_UPLOAD_BYTES),
        },
    )


@router.post("/api/uploads")
async def upload(request: Request, cyrene_session: str | None = Cookie(default=None)):
    user_id = await special_user(cyrene_session)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"Files can be up to {readable_size(MAX_UPLOAD_BYTES)}.")
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if not CONTENT_TYPE.fullmatch(content_type):
        content_type = "application/octet-stream"
    upload_id = secrets.token_urlsafe(9)
    UPLOAD_DIR.mkdir(exist_ok=True)
    destination = file_path(upload_id)
    size = await save_stream(request, destination, MAX_UPLOAD_BYTES)
    filename = clean_filename(request.headers.get("x-upload-name"))
    try:
        await upload_store.create(
            get_pool(),
            upload_id,
            user_id,
            filename,
            content_type,
            size,
            dimension(request.headers.get("x-video-width")),
            dimension(request.headers.get("x-video-height")),
            "processing" if kind(content_type) == "video" else "ready",
        )
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return json_upload(await upload_store.get(get_pool(), upload_id))


@router.get("/api/uploads/{upload_id}")
async def upload_status(upload_id: str, cyrene_session: str | None = Cookie(default=None)):
    user_id = await special_user(cyrene_session)
    file_path(upload_id)
    stored = await upload_store.get(get_pool(), upload_id)
    if stored is None or stored["uploader_id"] != user_id:
        raise HTTPException(404, "File not found")
    return json_upload(stored)


@router.post("/api/uploads/{upload_id}/thumbnail")
async def upload_thumbnail(
    upload_id: str, request: Request, cyrene_session: str | None = Cookie(default=None)
):
    user_id = await special_user(cyrene_session)
    file_path(upload_id)
    stored = await upload_store.get(get_pool(), upload_id)
    if stored is None or stored["uploader_id"] != user_id:
        raise HTTPException(404, "File not found")
    destination = thumbnail_path(upload_id)
    await save_stream(request, destination, MAX_THUMBNAIL_BYTES)
    with destination.open("rb") as handle:
        if handle.read(3) != b"\xff\xd8\xff":
            destination.unlink(missing_ok=True)
            raise HTTPException(422, "Thumbnails must be JPEG images.")
    await upload_store.mark_thumbnail(get_pool(), upload_id, user_id)
    return {"ok": True}


@router.delete("/api/uploads/{upload_id}")
async def delete_upload(upload_id: str, cyrene_session: str | None = Cookie(default=None)):
    user_id = await special_user(cyrene_session)
    path = file_path(upload_id)
    if not await upload_store.delete(get_pool(), upload_id, user_id):
        raise HTTPException(404, "File not found")
    path.unlink(missing_ok=True)
    thumbnail_path(upload_id).unlink(missing_ok=True)
    return {"ok": True}


async def stored_upload(upload_id):
    path = file_path(upload_id)
    upload = await upload_store.get(get_pool(), upload_id)
    if upload is None or not path.is_file():
        raise HTTPException(404, "File not found")
    return upload, path


@router.get("/f/{upload_id}", response_class=HTMLResponse)
async def share_page(request: Request, upload_id: str):
    upload, _ = await stored_upload(upload_id)
    return templates.TemplateResponse(
        request=request,
        name="uploads/view.html",
        context={"request": request, "upload": described(upload)},
    )


@router.get("/f/{upload_id}/file")
async def shared_file(upload_id: str, download: bool = False):
    upload, path = await stored_upload(upload_id)
    media_type, inline = served_type(upload["content_type"])
    response = FileResponse(
        path,
        media_type=media_type,
        filename=upload["filename"],
        content_disposition_type="inline" if inline and not download else "attachment",
    )
    response.headers["Cache-Control"] = "public, max-age=86400"
    if media_type != "application/pdf":
        response.headers["Content-Security-Policy"] = SANDBOX
    return response


@router.get("/f/{upload_id}/thumbnail.jpg")
async def shared_thumbnail(upload_id: str):
    path = thumbnail_path(file_path(upload_id).name)
    if not path.is_file():
        raise HTTPException(404, "Thumbnail not found")
    return FileResponse(
        path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"}
    )
