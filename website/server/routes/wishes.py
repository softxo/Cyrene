"""Wish history pages and the import APIs."""

import asyncio
import json
import typing
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import aiohttp
from fastapi import APIRouter, Cookie, HTTPException, Request
from fastapi.logger import logger
from fastapi.responses import HTMLResponse, StreamingResponse

from shared.genshin_db import GenshinDB, GenshinDBError
from shared.storage.database import get_accounts, get_wish_history, import_wish_history
from website.server.core.account_access import find_account_by_id, get_owned_account
from website.server.core.auth import get_authenticated_user, get_web_session, verification_redirect
from website.server.core.templating import templates

router = APIRouter()


@router.get(
    "/wishes",
    response_class=HTMLResponse,
)
async def wishes(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    session = await get_web_session(cyrene_session)
    if session is None:
        return verification_redirect("/wishes")

    accounts = await get_accounts(session.user_id)
    selected_account = find_account_by_id(accounts, account_id) if account_id is not None else None
    if selected_account is None and accounts:
        selected_account = accounts[0]

    return templates.TemplateResponse(
        request=request,
        name="wishes.html",
        context={
            "request": request,
            "accounts": accounts,
            "selected_account": selected_account,
        },
    )


def _validated_wish_url(value: str) -> str:
    try:
        parsed = urlsplit(value.strip())
        port = parsed.port
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid wish-history URL.") from error

    valid_host = parsed.hostname is not None and (
        parsed.hostname.endswith(".hoyoverse.com") or parsed.hostname.endswith(".mihoyo.com")
    )
    if (
        parsed.scheme != "https"
        or not valid_host
        or port not in (None, 443)
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        not in {
            "/gacha_info/api/getGachaLog",
            "/gacha_info/api/getLdGachaLog",
        }
    ):
        raise HTTPException(status_code=400, detail="Use a valid HoYoverse wish-history URL.")

    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if not query.get("authkey"):
        raise HTTPException(status_code=400, detail="The wish-history URL has no auth key.")
    return value.strip()


async def _fetch_wishes_from_hoyoverse(
    source_url: str,
    progress: typing.Callable[[dict], typing.Awaitable[None]] | None = None,
) -> list[dict]:
    parsed = urlsplit(source_url)
    base_query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    wishes: dict[str, dict] = {}
    timeout = aiohttp.ClientTimeout(total=20)

    async with aiohttp.ClientSession(timeout=timeout) as client:
        for gacha_type in ("100", "200", "301", "400", "302", "500"):
            end_id = "0"
            for _ in range(500):
                query = {
                    **base_query,
                    "gacha_type": gacha_type,
                    "page": "1",
                    "size": "20",
                    "end_id": end_id,
                }
                page_url = urlunsplit(
                    (
                        parsed.scheme,
                        parsed.netloc,
                        parsed.path,
                        urlencode(query),
                        "",
                    )
                )
                payload = None
                for attempt in range(5):
                    try:
                        async with client.get(page_url, allow_redirects=False) as response:
                            if response.status not in (200, 429):
                                raise HTTPException(
                                    status_code=502,
                                    detail="HoYoverse rejected the wish-history request.",
                                )
                            payload = await response.json(content_type=None)
                    except (aiohttp.ClientError, asyncio.TimeoutError) as error:
                        raise HTTPException(
                            status_code=502, detail="Could not contact HoYoverse."
                        ) from error

                    message = str(payload.get("message") or "") if isinstance(payload, dict) else ""
                    rate_limited = response.status == 429 or "frequent" in message.casefold()
                    if not rate_limited:
                        break
                    if attempt == 4:
                        raise HTTPException(
                            status_code=429,
                            detail="HoYoverse is still rate limiting this import. Please wait a few minutes and try again.",
                        )
                    delay = min(2 ** (attempt + 1), 12)
                    if progress:
                        await progress({"type": "retry", "seconds": delay, "found": len(wishes)})
                    await asyncio.sleep(delay)

                if not isinstance(payload, dict) or payload.get("retcode") != 0:
                    message = (
                        payload.get("message") if isinstance(payload, dict) else None
                    ) or "The wish-history URL has expired."
                    raise HTTPException(status_code=400, detail=message)

                page = (payload.get("data") or {}).get("list") or []
                if not page:
                    break

                for item in page:
                    wish_id = str(item.get("id") or "")
                    uid = str(item.get("uid") or "")
                    if not wish_id or not uid:
                        continue
                    try:
                        pulled_at = datetime.strptime(
                            str(item.get("time")),
                            "%Y-%m-%d %H:%M:%S",
                        )
                        rank_type = int(item.get("rank_type"))
                    except TypeError, ValueError:
                        continue
                    wishes[wish_id] = {
                        "id": wish_id,
                        "uid": uid,
                        "gacha_type": str(item.get("gacha_type") or gacha_type),
                        "name": str(item.get("name") or "Unknown item"),
                        "item_type": str(item.get("item_type") or "Item"),
                        "rank_type": rank_type,
                        "pulled_at": pulled_at,
                    }

                if progress:
                    await progress({"type": "progress", "found": len(wishes), "banner": gacha_type})

                next_end_id = str(page[-1].get("id") or "")
                if not next_end_id or next_end_id == end_id or len(page) < 20:
                    break
                end_id = next_end_id
                await asyncio.sleep(0.25)

    records = list(wishes.values())
    if progress:
        await progress(
            {"type": "phase", "found": len(records), "message": "Matching wish artwork…"}
        )
    unique_items = {(wish["item_type"].casefold(), wish["name"]) for wish in records}

    async def resolve_icon(item_type: str, name: str) -> tuple[tuple[str, str], str | None]:
        folder = "characters" if item_type == "character" else "weapons"
        try:
            item = await db.get(folder, name)
        except GenshinDBError:
            return (item_type, name), None
        filename = (item.get("images") or {}).get("filename_icon")
        icon_url = f"https://enka.network/ui/{filename}.png" if filename else None
        return (item_type, name), icon_url

    async with aiohttp.ClientSession(timeout=timeout) as catalogue_client:
        db = GenshinDB(catalogue_client)
        resolved = dict(
            await asyncio.gather(
                *(
                    resolve_icon(item_type, name)
                    for item_type, name in unique_items
                    if item_type in {"character", "weapon"}
                )
            )
        )
    for wish in records:
        wish["icon_url"] = resolved.get((wish["item_type"].casefold(), wish["name"]))
    return records


@router.get("/api/import-dates")
async def import_dates_api(account_id: int, cyrene_session: str | None = Cookie(default=None)):
    user_id = await get_authenticated_user(cyrene_session)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    account = await get_owned_account(user_id, account_id)
    from shared.storage.database import get_pool

    async with get_pool().connection() as connection:
        result = await connection.execute(
            "SELECT kind, imported_at FROM uid_import_dates WHERE genshin_uid=%s",
            (str(account["genshin_uid"]),),
        )
        return {row["kind"]: row["imported_at"].isoformat() for row in await result.fetchall()}


@router.get("/api/wishes")
async def wishes_data(
    account_id: int,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    await get_owned_account(user_id, account_id)
    records = await get_wish_history(account_id)
    return {
        "wishes": [
            {
                **record,
                "pulled_at": record["pulled_at"].isoformat(),
            }
            for record in records
        ]
    }


@router.post("/api/wishes/import")
async def import_wishes_api(
    request: Request,
    account_id: int,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    account = await get_owned_account(user_id, account_id)
    body = await request.json()
    source_url = _validated_wish_url(str(body.get("url") or ""))
    wishes = await _fetch_wishes_from_hoyoverse(source_url)
    returned_uids = {wish["uid"] for wish in wishes}
    if returned_uids and returned_uids != {str(account["genshin_uid"])}:
        raise HTTPException(
            status_code=409,
            detail="This wish history belongs to a different Genshin account.",
        )
    imported = await import_wish_history(account_id, wishes)
    return {"success": True, "imported": imported, "found": len(wishes)}


@router.post("/api/wishes/import/stream")
async def import_wishes_stream_api(
    request: Request,
    account_id: int,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    account = await get_owned_account(user_id, account_id)
    body = await request.json()
    source_url = _validated_wish_url(str(body.get("url") or ""))

    async def stream():
        queue: asyncio.Queue[dict] = asyncio.Queue()

        async def report(event: dict) -> None:
            await queue.put(event)

        async def run_import() -> None:
            try:
                wishes = await _fetch_wishes_from_hoyoverse(source_url, report)
                returned_uids = {wish["uid"] for wish in wishes}
                if returned_uids and returned_uids != {str(account["genshin_uid"])}:
                    raise HTTPException(
                        status_code=409,
                        detail="This wish history belongs to a different Genshin account.",
                    )
                await report({"type": "phase", "found": len(wishes), "message": "Saving wishes…"})
                imported = await import_wish_history(account_id, wishes)
                await report({"type": "complete", "found": len(wishes), "imported": imported})
            except HTTPException as error:
                await report({"type": "error", "message": str(error.detail)})
            except Exception:
                logger.exception("Wish history streaming import failed")
                await report({"type": "error", "message": "Wish import failed unexpectedly."})

        task = asyncio.create_task(run_import())
        try:
            while not task.done() or not queue.empty():
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=1)
                except asyncio.TimeoutError:
                    yield "\n"
                    continue
                yield json.dumps(event, separators=(",", ":")) + "\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
