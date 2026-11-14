"""Weapon pages and the planner, manual, scanned and import APIs."""

import asyncio
import json
import uuid

from fastapi import APIRouter, Cookie, HTTPException, Request
from fastapi.logger import logger
from fastapi.responses import HTMLResponse

from shared.hoyolab.account_client import get_account_client
from shared.storage.database import get_accounts
from website.server.core.account_access import find_account_by_id
from website.server.core.auth import get_web_session, verification_redirect
from website.server.core.templating import templates

router = APIRouter()


@router.get("/weapons", response_class=HTMLResponse)
async def weapons_page(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    session = await get_web_session(cyrene_session)
    if session is None:
        return verification_redirect("/weapons")
    accounts = await get_accounts(session.user_id)
    selected = find_account_by_id(accounts, account_id)
    if selected is None and accounts:
        selected = accounts[0]
    return templates.TemplateResponse(
        request=request,
        name="weapons.html",
        context={"accounts": accounts, "selected_account": selected},
    )


@router.get("/api/weapons")
async def weapons_data(
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    from website.server.content.weapons import catalogue_weapon_rows, owned_weapon_rows

    session = await get_web_session(cyrene_session)
    if session is None:
        raise HTTPException(status_code=401, detail="Sign in to view weapons.")
    accounts = await get_accounts(session.user_id)
    selected = find_account_by_id(accounts, account_id)
    if selected is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    client = await get_account_client(session.user_id, selected["genshin_uid"])
    if client is None:
        raise HTTPException(status_code=503, detail="Unable to load the selected account.")
    async with client:
        owned, catalogue = await asyncio.gather(
            client.get_genshin_characters(),
            client.genshin_client.get_calculator_weapons(lang="en-us"),
            return_exceptions=True,
        )
    result = {}
    for key, value, normalise in (
        ("owned", owned, owned_weapon_rows),
        ("catalogue", catalogue, catalogue_weapon_rows),
    ):
        if isinstance(value, BaseException):
            logger.error("Failed to load weapon %s for account %s", key, selected["id"])
            result[key] = []
            result[key + "_error"] = "Couldn't load weapons from HoYoLAB. Please try again."
        else:
            result[key] = normalise(value)
    return result


async def _manual_weapon_owner(token, account_id):
    session = await get_web_session(token)
    if session is None:
        raise HTTPException(status_code=401, detail="Sign in to manage weapons.")
    accounts = await get_accounts(session.user_id)
    if not any(a["id"] == account_id for a in accounts):
        raise HTTPException(status_code=404, detail="Account not found.")
    return session.user_id


@router.get("/api/weapons/plans")
async def weapon_plans_data(account_id: int, cyrene_session: str | None = Cookie(default=None)):
    from shared.storage import weapon_plan_store
    from shared.storage.database import get_pool

    user_id = await _manual_weapon_owner(cyrene_session, account_id)
    return {"plans": await weapon_plan_store.get_plans(get_pool(), user_id, account_id)}


@router.put("/api/weapons/plans")
async def save_weapon_plans(
    request: Request, account_id: int, cyrene_session: str | None = Cookie(default=None)
):
    from shared.storage import weapon_plan_store
    from shared.storage.database import get_pool
    from website.server.content.weapon_planner import normalise_weapon_plan

    user_id = await _manual_weapon_owner(cyrene_session, account_id)
    try:
        payload = await request.json()
        plans = payload.get("plans")
        if not isinstance(plans, list) or len(plans) > 100:
            raise ValueError("A maximum of 100 weapon plans is supported.")
        plans = [normalise_weapon_plan(plan) for plan in plans]
        if len({plan["key"] for plan in plans}) != len(plans):
            raise ValueError("Duplicate plan identifiers.")
    except ValueError, TypeError, AttributeError:
        raise HTTPException(
            status_code=422, detail="Choose valid weapon plans and goals."
        ) from None
    await weapon_plan_store.replace_plans(get_pool(), user_id, account_id, plans)
    return {"plans": plans}


@router.post("/api/weapons/planner-costs")
async def weapon_planner_costs(
    request: Request, account_id: int, cyrene_session: str | None = Cookie(default=None)
):
    from website.server.content.weapon_planner import calculate_weapon_plan, normalise_weapon_plan

    await _manual_weapon_owner(cyrene_session, account_id)
    try:
        plan = normalise_weapon_plan(await request.json())
    except ValueError, TypeError, AttributeError:
        raise HTTPException(
            status_code=422, detail="Choose valid weapon levels and refinements."
        ) from None
    return {"costs": await calculate_weapon_plan(plan)}


@router.delete("/api/weapons/inventory")
async def reset_weapon_inventory(
    account_id: int, cyrene_session: str | None = Cookie(default=None)
):
    from shared.storage import weapon_plan_store
    from shared.storage.database import get_pool

    user_id = await _manual_weapon_owner(cyrene_session, account_id)
    await weapon_plan_store.reset_inventory(get_pool(), user_id, account_id)
    return {"ok": True}


@router.get("/api/weapons/manual")
async def manual_weapons_data(account_id: int, cyrene_session: str | None = Cookie(default=None)):
    from shared.storage.database import get_manual_weapons
    from website.server.content.weapons import weapon_release_version, weapon_tag

    user_id = await _manual_weapon_owner(cyrene_session, account_id)
    rows = await get_manual_weapons(user_id, account_id)
    return {
        "weapons": [
            dict(row, tag=weapon_tag(row["id"]), release_version=weapon_release_version(row["id"]))
            for row in rows
        ]
    }


@router.post("/api/weapons/manual")
async def manual_weapon_add(
    request: Request, account_id: int, cyrene_session: str | None = Cookie(default=None)
):
    from shared.storage.database import add_manual_weapon
    from website.server.content.weapons import (
        validate_manual_weapon,
        weapon_release_version,
        weapon_tag,
    )

    user_id = await _manual_weapon_owner(cyrene_session, account_id)
    try:
        weapon = validate_manual_weapon(await request.json())
    except ValueError, TypeError, KeyError:
        raise HTTPException(
            status_code=422, detail="Choose a weapon, a valid level, and refinement 1 to 5."
        ) from None
    copy_id = str(uuid.uuid4())
    await add_manual_weapon(user_id, account_id, copy_id, weapon)
    return {
        "weapon": dict(
            weapon,
            copy_id=copy_id,
            tag=weapon_tag(weapon["id"]),
            release_version=weapon_release_version(weapon["id"]),
        )
    }


@router.delete("/api/weapons/manual/{copy_id}")
async def manual_weapon_remove(
    copy_id: str, account_id: int, cyrene_session: str | None = Cookie(default=None)
):
    from shared.storage.database import remove_manual_weapon

    user_id = await _manual_weapon_owner(cyrene_session, account_id)
    if not await remove_manual_weapon(user_id, account_id, copy_id):
        raise HTTPException(status_code=404, detail="Weapon not found.")
    return {"ok": True}


@router.get("/api/weapons/scanned")
async def scanned_weapons_data(account_id: int, cyrene_session: str | None = Cookie(default=None)):
    from shared.storage.database import get_weapon_scan
    from website.server.content.weapon_scan import normalise_scan_character
    from website.server.content.weapons import weapon_release_version, weapon_tag

    user_id = await _manual_weapon_owner(cyrene_session, account_id)
    accounts = await get_accounts(user_id)
    account = next((a for a in accounts if a["id"] == account_id), {})
    result = await get_weapon_scan(user_id, account_id)
    result["weapons"] = [
        dict(
            normalise_scan_character(row, account.get("nickname") or ""),
            tag=weapon_tag(row["id"]),
            release_version=weapon_release_version(row["id"]),
        )
        for row in result["weapons"]
    ]
    return result


@router.delete("/api/weapons/scanned/{copy_id:path}")
async def scanned_weapon_remove(
    copy_id: str, account_id: int, cyrene_session: str | None = Cookie(default=None)
):
    from shared.storage.database import remove_scanned_weapon

    user_id = await _manual_weapon_owner(cyrene_session, account_id)
    if not await remove_scanned_weapon(user_id, account_id, copy_id):
        raise HTTPException(status_code=404, detail="Imported weapon not found.")
    return {"ok": True}


async def _validated_weapon_import(request, account_id, token):
    from website.server.content.weapon_scan import validate_weapon_scan

    user_id = await _manual_weapon_owner(token, account_id)
    accounts = await get_accounts(user_id)
    account = find_account_by_id(accounts, account_id)
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found.")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 4 * 1024 * 1024:
            raise HTTPException(
                status_code=413, detail="Weapon export is too large (maximum 4 MB)."
            )
    try:
        scan = validate_weapon_scan(
            json.loads(body), account["genshin_uid"], account.get("nickname") or ""
        )
    except (ValueError, TypeError, KeyError, UnicodeError) as error:
        raise HTTPException(
            status_code=422,
            detail=str(error) if isinstance(error, ValueError) else "Invalid weapon export.",
        ) from None
    return user_id, scan


@router.post("/api/weapons/import/preview")
async def preview_weapon_import(
    request: Request, account_id: int, cyrene_session: str | None = Cookie(default=None)
):
    _, scan = await _validated_weapon_import(request, account_id, cyrene_session)
    return {"count": len(scan["weapons"]), "uid": scan["uid"]}


@router.post("/api/weapons/import")
async def import_weapon_scan(
    request: Request, account_id: int, cyrene_session: str | None = Cookie(default=None)
):
    from shared.storage.database import replace_weapon_scan

    user_id, scan = await _validated_weapon_import(request, account_id, cyrene_session)
    await replace_weapon_scan(user_id, account_id, scan["scan_id"], scan["weapons"])
    return scan
