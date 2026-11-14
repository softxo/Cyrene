"""Reviewed official image-only details absent from HoYoLAB's structured feed.

These supplements do not discover events or replace published precise schedules.
Dates retain their day precision; material previews retain unknown quantities.
"""

import copy
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from website.server.events.announcement_events import SERVER_OFFSETS, normalise_name

DETAILS = json.loads(
    (Path(__file__).resolve().parents[3] / "data/metadata/event_supplements.json").read_text(
        encoding="utf-8"
    )
)


def apply_reviewed_stygian_opening(stygian: dict, server: str, now: int) -> None:
    """The record's cycle can start before the challenges actually open."""
    if server not in SERVER_OFFSETS or not stygian.get("end_time"):
        return
    server_zone = timezone(timedelta(hours=SERVER_OFFSETS[server]))
    window = DETAILS["stygian"]
    opening = int(datetime.fromisoformat(window["opens"]).replace(tzinfo=server_zone).timestamp())
    ending = datetime.fromtimestamp(stygian["end_time"], server_zone).date().isoformat()
    if now < opening and ending == window["period_end_date"]:
        stygian["start_time"] = opening


def apply_reviewed_event_details(events: list[dict], server: str, now: int) -> None:
    if server not in SERVER_OFFSETS:
        return
    server_zone = timezone(timedelta(hours=SERVER_OFFSETS[server]))

    def local_timestamp(value):
        return int(datetime.fromisoformat(value).replace(tzinfo=server_zone).timestamp())

    if not local_timestamp(DETAILS["valid_from"]) <= now < local_timestamp(DETAILS["valid_until"]):
        return
    for event in events:
        name = normalise_name(event["name"])
        if event.get("is_upcoming") and not event.get("start_time"):
            opening = next(
                (
                    date
                    for title, date in DETAILS["opening_dates"].items()
                    if normalise_name(title) == name
                ),
                None,
            )
            if opening:
                event["opening_date"] = opening
                event["opening_date_timestamp"] = local_timestamp(opening)
                event["opening_source"] = DETAILS["calendar_source"]
        quest = next(
            (
                record
                for title, record in DETAILS["quests"].items()
                if normalise_name(title) == name
            ),
            None,
        )
        if (
            quest
            and event.get("category") == "Quest"
            and event.get("end_time") == local_timestamp(quest["period_end"])
            and any(not reward.get("icon") for reward in event.get("rewards", []))
        ):
            event["rewards"] = copy.deepcopy(quest["rewards"])
            event["reward_preview_note"] = quest["note"]
            event["reward_source"] = quest["material_source"]
