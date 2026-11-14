"""Achievement pages and the tier, note and import APIs."""

import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, Cookie, HTTPException, Request, Response
from fastapi.responses import HTMLResponse

from shared.achievements.achievements import load_current_achievements
from shared.achievements.category_icons import load_category_icons
from shared.achievements.importer import import_achievements
from shared.achievements.progress import load_progress
from shared.storage.database import get_accounts, update_achievement_tier
from website.server.core.account_access import find_account_by_id, get_owned_account
from website.server.core.auth import get_authenticated_user, get_web_session, verification_redirect
from website.server.core.templating import templates

router = APIRouter()


@router.get(
    "/achievements",
    response_class=HTMLResponse,
)
async def achievements(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    session = await get_web_session(cyrene_session)

    if session is None:
        return verification_redirect("/achievements")

    accounts = await get_accounts(session.user_id)
    selected_account = find_account_by_id(accounts, account_id) if account_id is not None else None

    if selected_account is None and accounts:
        selected_account = accounts[0]

    return templates.TemplateResponse(
        request=request,
        name="achievements.html",
        context={
            "request": request,
            "accounts": accounts,
            "selected_account": selected_account,
        },
    )


@router.get("/api/achievements")
async def achievements_data(
    account_id: int,
    response: Response,
    cyrene_session: str | None = Cookie(default=None),
):
    response.headers["Cache-Control"] = "no-store, private"
    user_id = await get_authenticated_user(cyrene_session)

    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    account = await get_owned_account(user_id, account_id)
    source_achievements = await load_current_achievements(wait_for_refresh=False)
    saved_progress = await load_progress(
        user_id,
        account_id,
    )

    logging.getLogger("uvicorn.error").info(
        "Achievement read: user=%s account=%s uid=%s saved_achievements=%s",
        user_id,
        account_id,
        account["genshin_uid"],
        len(saved_progress),
    )

    achievements = []
    categories = {}
    total_tiers = 0
    completed_tiers = 0

    for source in source_achievements:
        achievement_ids = source.get("id", [])
        category = source.get("achievementGroupName")
        stage_count = source.get("stages", 0)

        if not achievement_ids or not category:
            continue

        if not isinstance(achievement_ids, list):
            continue

        if not isinstance(stage_count, int) or stage_count < 1:
            continue

        tiers = []

        for stage_number in range(1, stage_count + 1):
            stage_key = f"stage{stage_number}"
            stage = source.get(stage_key)

            if not isinstance(stage, dict):
                continue

            if stage_number > len(achievement_ids):
                continue

            achievement_id = str(achievement_ids[stage_number - 1])
            achievement_progress = saved_progress.get(achievement_id, {})
            tier_progress = achievement_progress.get("tiers", {})
            tier_key = str(stage_number)
            saved_tier = tier_progress.get(tier_key, {})
            completed = saved_tier.get("completed", False)
            current = saved_tier.get("current", 0)
            timestamp = saved_tier.get("timestamp")
            note = saved_tier.get("note")
            reward = stage.get("reward", {})
            primogems = reward.get("count", 0)

            tiers.append(
                {
                    "tier": stage_number,
                    "genshin_id": achievement_id,
                    "title": stage.get("title", source.get("name", "")),
                    "description": stage.get("description", ""),
                    "progress": stage.get("progress"),
                    "primogems": primogems,
                    "completed": completed,
                    "current": current,
                    "timestamp": timestamp,
                    "note": note,
                }
            )

            total_tiers += 1

            if completed:
                completed_tiers += 1

        if not tiers:
            continue

        frontend_achievement = {
            "id": str(achievement_ids[0]),
            "name": source.get("name", ""),
            "category": category,
            "version": source.get("version"),
            "tiers": tiers,
        }

        achievements.append(frontend_achievement)

        if category not in categories:
            categories[category] = {
                "total": 0,
                "completed": 0,
            }

        categories[category]["total"] += len(tiers)

        categories[category]["completed"] += sum(1 for tier in tiers if tier["completed"])

    category_icons = await load_category_icons(list(categories), wait_for_refresh=False)
    for category, icon_url in category_icons.items():
        categories[category]["icon_url"] = icon_url

    return {
        "achievements": achievements,
        "categories": categories,
        "total": total_tiers,
        "completed": completed_tiers,
    }


@router.patch("/api/achievements/{achievement_id}/tiers/{tier}")
async def update_achievement_tier_api(
    achievement_id: str,
    tier: int,
    account_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    await get_owned_account(user_id, account_id)
    body = await request.json()
    completed = body.get("completed")

    if not isinstance(completed, bool):
        raise HTTPException(status_code=400, detail="The 'completed' field must be a boolean.")

    updated = await update_achievement_tier(
        discord_user_id=user_id,
        account_id=account_id,
        achievement_id=achievement_id,
        tier=tier,
        completed=completed,
    )

    return {
        "success": True,
        "updated": updated,
        "achievement_id": achievement_id,
        "tier": tier,
        "completed": completed,
    }


@router.patch("/api/achievements/{achievement_id}/tiers/{tier}/note")
async def update_achievement_tier_note_api(
    achievement_id: str,
    tier: int,
    account_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    await get_owned_account(user_id, account_id)
    body = await request.json()
    note = body.get("note")

    if note is not None and not isinstance(note, str):
        raise HTTPException(status_code=400, detail="The 'note' field must be a string or null.")

    if isinstance(note, str):
        note = note.strip()

        if not note:
            note = None

    updated = await update_achievement_tier(
        discord_user_id=user_id,
        account_id=account_id,
        achievement_id=achievement_id,
        tier=tier,
        note=note,
    )

    return {
        "success": True,
        "updated": updated,
        "achievement_id": achievement_id,
        "tier": tier,
        "note": note,
    }


@router.post("/api/achievements/import")
async def import_achievements_api(
    request: Request,
    account_id: int,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    if user_id is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")

    account = await get_owned_account(user_id, account_id)
    form = await request.form()
    uploaded_file = form.get("file")

    if uploaded_file is None:
        raise HTTPException(status_code=400, detail="No achievement export was provided.")

    if not hasattr(uploaded_file, "read"):
        raise HTTPException(status_code=400, detail="Invalid upload.")

    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as temp_file:
        content = await uploaded_file.read()

        temp_file.write(content)

        temp_path = temp_file.name

    try:
        await load_current_achievements()
        result = await import_achievements(
            user_id=user_id,
            account_id=account_id,
            export_file=temp_path,
        )

    finally:
        Path(temp_path).unlink(missing_ok=True)

    saved_progress = await load_progress(user_id, account_id)
    saved_tiers = sum(len(item["tiers"]) for item in saved_progress.values())
    logging.getLogger("uvicorn.error").info(
        "Achievement import verified: user=%s account=%s uid=%s matched=%s saved_tiers=%s",
        user_id,
        account_id,
        account["genshin_uid"],
        result["matched"],
        saved_tiers,
    )
    return result
