"""Custom event pages' APIs: creation, ordering, completion and progress."""

import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Cookie, File, HTTPException, Request, UploadFile

from shared.storage.database import (
    change_custom_event_account_progress,
    create_custom_event,
    delete_custom_event,
    get_accounts,
    get_custom_event,
    get_custom_event_account_progress,
    get_custom_event_completions,
    get_custom_events,
    get_visible_custom_event,
    reorder_custom_events,
    set_custom_event_completion,
    update_custom_event,
)
from website.server.core.auth import get_authenticated_user
from website.server.core.templating import BASE_DIR

router = APIRouter()


def parse_custom_event_datetime(value, field_name: str) -> datetime:
    """Parse an ISO-8601 datetime and ensure it is timezone-aware."""
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} is required.",
        )

    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be a valid ISO-8601 datetime.",
        )

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


async def validate_custom_event_payload(
    user_id: int,
    data: dict,
) -> dict:
    """Validate event fields and verify the selected account belongs to the user."""

    title = data.get("title")
    if not isinstance(title, str) or not title.strip():
        raise HTTPException(
            status_code=400,
            detail="An event title is required.",
        )

    title = title.strip()
    if len(title) > 120:
        raise HTTPException(
            status_code=400,
            detail="The event title cannot exceed 120 characters.",
        )

    description = data.get("description")
    if description is not None:
        if not isinstance(description, str):
            raise HTTPException(
                status_code=400,
                detail="Description must be text.",
            )
        description = description.strip() or None
        if description and len(description) > 2000:
            raise HTTPException(
                status_code=400,
                detail="Description cannot exceed 2000 characters.",
            )

    account_scope = data.get("account_scope", "all")
    if account_scope not in {"all", "account"}:
        raise HTTPException(
            status_code=400,
            detail="Account scope must be 'all' or 'account'.",
        )

    account_id = data.get("account_id")

    if account_scope == "all":
        account_id = None
    else:
        try:
            account_id = int(account_id)
        except TypeError, ValueError:
            raise HTTPException(
                status_code=400,
                detail="Select a valid account for this event.",
            )

        accounts = await get_accounts(user_id)
        owned_account = next(
            (account for account in accounts if int(account["id"]) == account_id),
            None,
        )

        if owned_account is None:
            raise HTTPException(
                status_code=404,
                detail="Account not found.",
            )

    start_at = parse_custom_event_datetime(
        data.get("start_at"),
        "Start date and time",
    )
    end_value = data.get("end_at")
    end_at = parse_custom_event_datetime(end_value, "End date and time") if end_value else None

    if end_at is not None and end_at <= start_at:
        raise HTTPException(
            status_code=400,
            detail="The end date and time must be after the start.",
        )

    recurrence = data.get("recurrence", {"type": "none"})
    if not isinstance(recurrence, dict):
        raise HTTPException(
            status_code=400,
            detail="Recurrence must be an object.",
        )

    recurrence_type = recurrence.get("type", "none")
    if recurrence_type not in {"none", "daily", "weekly", "monthly"}:
        raise HTTPException(
            status_code=400,
            detail="Unsupported recurrence type.",
        )

    try:
        interval = int(recurrence.get("interval", 1))
    except TypeError, ValueError:
        raise HTTPException(
            status_code=400,
            detail="Recurrence interval must be a number.",
        )

    if not 1 <= interval <= 365:
        raise HTTPException(
            status_code=400,
            detail="Recurrence interval must be between 1 and 365.",
        )

    recurrence = {
        "type": recurrence_type,
        "interval": interval,
    }

    if recurrence_type == "weekly":
        supplied_weekdays = data.get("recurrence", {}).get("weekdays", [])

        if not isinstance(supplied_weekdays, list):
            raise HTTPException(
                status_code=400,
                detail="Weekly recurrence weekdays must be a list.",
            )

        try:
            supplied_weekdays = sorted(set(int(day) for day in supplied_weekdays))
        except TypeError, ValueError:
            raise HTTPException(
                status_code=400,
                detail="Weekly recurrence weekdays are invalid.",
            )

        if any(day < 0 or day > 6 for day in supplied_weekdays):
            raise HTTPException(
                status_code=400,
                detail="Weekdays must be between 0 (Monday) and 6 (Sunday).",
            )

        recurrence["weekdays"] = supplied_weekdays

    colour = data.get("colour", "#7c83ff")
    if not isinstance(colour, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", colour):
        raise HTTPException(
            status_code=400,
            detail="Colour must be a valid six-digit hexadecimal colour.",
        )
    colour = colour.lower()
    reminder_minutes = data.get("reminder_minutes")
    if reminder_minutes is not None:
        try:
            reminder_minutes = int(reminder_minutes)
        except TypeError, ValueError:
            raise HTTPException(
                status_code=400,
                detail="Reminder time must be a number of minutes.",
            )

        if not 0 <= reminder_minutes <= 10080:
            raise HTTPException(
                status_code=400,
                detail="Reminder time must be between 0 and 10080 minutes.",
            )

    progress = data.get("progress", [])
    if not isinstance(progress, list) or len(progress) > 20:
        raise HTTPException(
            status_code=400,
            detail="Progress must be a list of no more than 20 objectives.",
        )

    clean_progress = []
    for objective in progress:
        if not isinstance(objective, dict):
            raise HTTPException(
                status_code=400,
                detail="Each progress objective must be an object.",
            )

        objective_title = objective.get("title")
        if not isinstance(objective_title, str) or not objective_title.strip():
            raise HTTPException(
                status_code=400,
                detail="Each progress objective needs a title.",
            )

        try:
            current = int(objective.get("current", 0))
            target = int(objective.get("target", 1))
        except TypeError, ValueError:
            raise HTTPException(
                status_code=400,
                detail="Progress values must be whole numbers.",
            )

        if len(objective_title.strip()) > 100 or target < 1 or current < 0:
            raise HTTPException(
                status_code=400,
                detail="A progress objective has invalid values.",
            )

        clean_progress.append(
            {
                "title": objective_title.strip(),
                "current": min(current, target),
                "target": target,
            }
        )

    icon_url = data.get("icon_url")

    if icon_url is not None:
        if not isinstance(icon_url, str):
            raise HTTPException(
                status_code=400,
                detail="Event icon URL must be text.",
            )

        icon_url = icon_url.strip() or None

        if icon_url is not None and not re.fullmatch(
            r"/static/uploads/custom-events/[a-f0-9-]{36}\.(?:png|jpg|webp)",
            icon_url,
        ):
            raise HTTPException(
                status_code=400,
                detail="Invalid event icon.",
            )

    return {
        "title": title,
        "description": description,
        "account_scope": account_scope,
        "account_id": account_id,
        "start_at": start_at,
        "end_at": end_at,
        "recurrence": recurrence,
        "colour": colour,
        "reminder_minutes": reminder_minutes,
        "progress": clean_progress,
        "icon_url": icon_url,
    }


@router.get("/api/custom-events")
async def api_get_custom_events(
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    user_id = await get_authenticated_user(cyrene_session)

    if account_id is not None:
        accounts = await get_accounts(user_id)

        if not any(int(account["id"]) == account_id for account in accounts):
            raise HTTPException(
                status_code=404,
                detail="Account not found.",
            )

    events = await get_custom_events(user_id, account_id)

    for event in events:
        event_id = int(event["id"])

        if account_id is not None:
            account_progress = await get_custom_event_account_progress(
                discord_user_id=user_id,
                event_id=event_id,
                account_id=account_id,
            )
            objectives = event.get("progress") or []

            for index, objective in enumerate(objectives):
                objective["current"] = max(
                    0,
                    min(
                        int(objective["target"]),
                        int(account_progress.get(index, objective.get("current", 0))),
                    ),
                )

        event["completions"] = await get_custom_event_completions(
            discord_user_id=user_id,
            event_id=int(event["id"]),
            account_id=account_id,
        )

    return {"success": True, "events": events}


@router.post("/api/custom-events")
async def api_create_custom_event(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON request.")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object.")

    fields = await validate_custom_event_payload(user_id, data)
    event = await create_custom_event(
        discord_user_id=user_id,
        **fields,
    )
    event["completions"] = []

    return {"success": True, "event": event}


CUSTOM_EVENT_UPLOAD_DIR = BASE_DIR / "website" / "static" / "uploads" / "custom-events"

MAX_CUSTOM_EVENT_ICON_SIZE = 5 * 1024 * 1024

CUSTOM_EVENT_IMAGE_TYPES = {
    "png": (b"\x89PNG\r\n\x1a\n",),
    "jpg": (b"\xff\xd8\xff",),
    "webp": (),
}


@router.post("/api/custom-events/icon")
async def upload_custom_event_icon(
    cyrene_session: str | None = Cookie(default=None),
    file: UploadFile = File(...),
):
    await get_authenticated_user(cyrene_session)

    contents = await file.read(MAX_CUSTOM_EVENT_ICON_SIZE + 1)
    await file.close()

    if not contents:
        raise HTTPException(
            status_code=400,
            detail="Choose an image to upload.",
        )

    if len(contents) > MAX_CUSTOM_EVENT_ICON_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Event icons cannot exceed 2 MB.",
        )

    extension = None

    if contents.startswith(CUSTOM_EVENT_IMAGE_TYPES["png"][0]):
        extension = "png"

    elif contents.startswith(CUSTOM_EVENT_IMAGE_TYPES["jpg"][0]):
        extension = "jpg"

    elif len(contents) >= 12 and contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
        extension = "webp"

    if extension is None:
        raise HTTPException(
            status_code=400,
            detail="Upload a valid PNG, JPEG or WebP image.",
        )

    CUSTOM_EVENT_UPLOAD_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    filename = f"{uuid.uuid4()}.{extension}"
    destination = CUSTOM_EVENT_UPLOAD_DIR / filename

    destination.write_bytes(contents)

    return {
        "success": True,
        "icon_url": f"/static/uploads/custom-events/{filename}",
    }


@router.post("/api/custom-events/reorder")
async def api_reorder_custom_events(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid JSON request.",
        )

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=400,
            detail="Request body must be an object.",
        )

    account_id = data.get("account_id")
    ordered_event_ids = data.get("ordered_event_ids")

    if isinstance(account_id, bool) or not isinstance(account_id, int) or account_id < 1:
        raise HTTPException(
            status_code=400,
            detail="'account_id' must be a positive integer.",
        )

    if not isinstance(ordered_event_ids, list) or not ordered_event_ids:
        raise HTTPException(
            status_code=400,
            detail="'ordered_event_ids' must be a non-empty list.",
        )

    if any(
        isinstance(event_id, bool) or not isinstance(event_id, int) or event_id < 1
        for event_id in ordered_event_ids
    ):
        raise HTTPException(
            status_code=400,
            detail="Every event ID must be a positive integer.",
        )

    if len(ordered_event_ids) != len(set(ordered_event_ids)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate event IDs are not allowed.",
        )

    saved = await reorder_custom_events(
        discord_user_id=user_id,
        account_id=account_id,
        ordered_event_ids=ordered_event_ids,
    )

    if not saved:
        raise HTTPException(
            status_code=409,
            detail=("The event order could not be saved. Refresh and try again."),
        )

    return {
        "success": True,
        "account_id": account_id,
        "ordered_event_ids": ordered_event_ids,
    }


@router.put("/api/custom-events/{event_id}")
async def api_update_custom_event(
    event_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    existing = await get_custom_event(user_id, event_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Custom event not found.")

    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON request.")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Request body must be an object.")

    fields = await validate_custom_event_payload(user_id, data)
    if "shared_fields" in data:
        shared_fields = data["shared_fields"]
        if not isinstance(shared_fields, list) or any(
            not isinstance(field, str) or field not in {"title", "description", "icon_url"}
            for field in shared_fields
        ):
            raise HTTPException(status_code=400, detail="Invalid shared event fields.")
        fields["shared_fields"] = shared_fields

    if fields["account_scope"] == "account" and not await get_visible_custom_event(
        user_id, event_id, fields["account_id"]
    ):
        raise HTTPException(status_code=404, detail="Custom event not found for this account.")

    event = await update_custom_event(
        discord_user_id=user_id,
        event_id=event_id,
        **fields,
    )

    if event is None:
        raise HTTPException(status_code=404, detail="Custom event not found.")

    event["completions"] = await get_custom_event_completions(
        user_id,
        event_id,
    )

    return {"success": True, "event": event}


@router.delete("/api/custom-events/{event_id}")
async def api_delete_custom_event(
    event_id: int,
    account_id: int | None = None,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)
    deleted = await delete_custom_event(user_id, event_id, account_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Custom event not found.")

    return {"success": True, "deleted_id": event_id}


@router.post("/api/custom-events/{event_id}/completion")
async def api_set_custom_event_completion(
    event_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid JSON request.",
        )

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=400,
            detail="Request body must be an object.",
        )

    completed = data.get("completed")

    if not isinstance(completed, bool):
        raise HTTPException(
            status_code=400,
            detail="'completed' must be true or false.",
        )

    account_id = data.get("account_id")

    if account_id is not None:
        if isinstance(account_id, bool) or not isinstance(account_id, int) or account_id < 1:
            raise HTTPException(
                status_code=400,
                detail="'account_id' must be a valid account ID.",
            )

        accounts = await get_accounts(user_id)

        if not any(int(account["id"]) == account_id for account in accounts):
            raise HTTPException(
                status_code=404,
                detail="Account not found.",
            )

    if account_id is not None:
        event = await get_visible_custom_event(
            discord_user_id=user_id,
            event_id=event_id,
            account_id=account_id,
        )
    else:
        event = await get_custom_event(
            discord_user_id=user_id,
            event_id=event_id,
        )

    if event is None:
        raise HTTPException(
            status_code=404,
            detail="Custom event not found for this account.",
        )

    occurrence_value = data.get("occurrence_start")

    if occurrence_value:
        occurrence_start = parse_custom_event_datetime(
            occurrence_value,
            "Occurrence start",
        )
    else:
        if event["recurrence"].get("type", "none") != "none":
            raise HTTPException(
                status_code=400,
                detail="Recurring events require an occurrence_start.",
            )

        occurrence_start = event["start_at"]

    updated = await set_custom_event_completion(
        discord_user_id=user_id,
        event_id=event_id,
        occurrence_start=occurrence_start,
        completed=completed,
        account_id=account_id,
    )

    if not updated:
        raise HTTPException(
            status_code=404,
            detail="Custom event not found for this account.",
        )

    return {
        "success": True,
        "event_id": event_id,
        "account_id": account_id,
        "occurrence_start": occurrence_start,
        "completed": completed,
    }


@router.post("/api/custom-events/{event_id}/progress")
async def api_change_custom_event_account_progress(
    event_id: int,
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
):
    user_id = await get_authenticated_user(cyrene_session)

    try:
        data = await request.json()
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid JSON request.",
        )

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=400,
            detail="Request body must be an object.",
        )

    account_id = data.get("account_id")
    objective_index = data.get("objective_index")
    amount = data.get("amount")

    if isinstance(account_id, bool) or not isinstance(account_id, int) or account_id < 1:
        raise HTTPException(
            status_code=400,
            detail="'account_id' must be a valid account ID.",
        )

    if (
        isinstance(objective_index, bool)
        or not isinstance(objective_index, int)
        or objective_index < 0
    ):
        raise HTTPException(
            status_code=400,
            detail="'objective_index' must be a non-negative integer.",
        )

    if isinstance(amount, bool) or not isinstance(amount, int) or amount not in (-1, 1):
        raise HTTPException(
            status_code=400,
            detail="'amount' must be -1 or 1.",
        )

    accounts = await get_accounts(user_id)

    if not any(int(account["id"]) == account_id for account in accounts):
        raise HTTPException(
            status_code=404,
            detail="Account not found.",
        )

    event = await get_visible_custom_event(
        discord_user_id=user_id,
        event_id=event_id,
        account_id=account_id,
    )

    if event is None:
        raise HTTPException(
            status_code=404,
            detail="Custom event not found for this account.",
        )

    objectives = event.get("progress") or []

    if objective_index >= len(objectives):
        raise HTTPException(
            status_code=400,
            detail="Objective not found.",
        )

    objective = objectives[objective_index]
    target = objective.get("target")

    if isinstance(target, bool) or not isinstance(target, int) or target < 1:
        raise HTTPException(
            status_code=400,
            detail="Invalid objective target.",
        )

    current = await change_custom_event_account_progress(
        discord_user_id=user_id,
        event_id=event_id,
        account_id=account_id,
        objective_index=objective_index,
        amount=amount,
        target=target,
    )

    if current is None:
        raise HTTPException(
            status_code=409,
            detail="Objective progress could not be updated. Refresh and try again.",
        )

    return {
        "success": True,
        "event_id": event_id,
        "account_id": account_id,
        "objective_index": objective_index,
        "current": current,
        "target": target,
    }
