from typing import Literal

from fastapi import APIRouter, Cookie, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from shared.storage.account_limits import SPECIAL_USER_IDS
from website.server.content.journey_map import (
    WORKING_COLUMNS,
    clear_item_status,
    delete_list_entry,
    page_context,
    save_list_entry,
    update_collapsed,
    update_item_status,
    update_versions,
)
from website.server.core.auth import get_web_session, verification_redirect
from website.server.core.templating import templates

router = APIRouter()


class WorkingPayload(BaseModel):
    tested_on: str = Field(default="", max_length=80)
    checks: list[bool | None] = Field(
        min_length=len(WORKING_COLUMNS), max_length=len(WORKING_COLUMNS)
    )


class ItemStatusPayload(BaseModel):
    state: str | None = None
    working: WorkingPayload | None = None


class VersionsPayload(BaseModel):
    map_version: str = Field(min_length=1, max_length=24)
    beacons_version: str = Field(min_length=1, max_length=24)


class CollapsedPayload(BaseModel):
    tabs: list[str] = Field(max_length=20)


class ListEntryPayload(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    detail: str = Field(default="", max_length=2000)
    done: bool = False


async def require_special(session_token: str | None) -> int:
    session = await get_web_session(session_token)

    if session is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    if session.user_id not in SPECIAL_USER_IDS:
        raise HTTPException(404, "Page not found")

    return session.user_id


@router.get("/journey-map", response_class=HTMLResponse)
async def journey_map_page(request: Request, cyrene_session: str | None = Cookie(default=None)):
    session = await get_web_session(cyrene_session)

    if session is None:
        return verification_redirect("/journey-map")

    if session.user_id not in SPECIAL_USER_IDS:
        raise HTTPException(404, "Page not found")

    return templates.TemplateResponse(
        request=request,
        name="journey_map.html",
        context={"request": request, **page_context(session.user_id)},
    )


@router.put("/api/journey-map/items/{item_id}")
async def set_item_status(
    item_id: int,
    payload: ItemStatusPayload,
    cyrene_session: str | None = Cookie(default=None),
):
    await require_special(cyrene_session)

    try:
        update_item_status(
            item_id,
            payload.state,
            payload.working.model_dump() if payload.working else None,
        )
    except KeyError:
        raise HTTPException(404, "Unknown item") from None
    except ValueError as error:
        raise HTTPException(422, str(error)) from None

    return {"ok": True}


ListKind = Literal["todos", "limits"]


@router.post("/api/journey-map/lists/{collection}")
async def create_entry(
    collection: ListKind,
    payload: ListEntryPayload,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await require_special(cyrene_session)

    try:
        return save_list_entry(user_id, **payload.model_dump(), collection=collection)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None


@router.put("/api/journey-map/lists/{collection}/{task_id}")
async def edit_entry(
    collection: ListKind,
    task_id: str,
    payload: ListEntryPayload,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await require_special(cyrene_session)

    try:
        return save_list_entry(
            user_id, **payload.model_dump(), task_id=task_id, collection=collection
        )
    except KeyError:
        raise HTTPException(404, "Unknown entry") from None
    except ValueError as error:
        raise HTTPException(422, str(error)) from None


@router.delete("/api/journey-map/lists/{collection}/{task_id}")
async def remove_entry(
    collection: ListKind, task_id: str, cyrene_session: str | None = Cookie(default=None)
):
    user_id = await require_special(cyrene_session)

    try:
        delete_list_entry(user_id, task_id, collection=collection)
    except KeyError:
        raise HTTPException(404, "Unknown entry") from None

    return {"ok": True}


@router.delete("/api/journey-map/items/{item_id}")
async def reset_item_status(item_id: int, cyrene_session: str | None = Cookie(default=None)):
    await require_special(cyrene_session)

    try:
        clear_item_status(item_id)
    except KeyError:
        raise HTTPException(404, "Unknown item") from None

    return {"ok": True}


@router.put("/api/journey-map/versions")
async def set_versions(payload: VersionsPayload, cyrene_session: str | None = Cookie(default=None)):
    await require_special(cyrene_session)
    update_versions({key: value.strip() for key, value in payload.model_dump().items()})

    return {"ok": True}


@router.put("/api/journey-map/collapsed")
async def set_collapsed(
    payload: CollapsedPayload, cyrene_session: str | None = Cookie(default=None)
):
    user_id = await require_special(cyrene_session)

    try:
        update_collapsed(user_id, payload.tabs)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None

    return {"ok": True}
