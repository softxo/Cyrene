"""Permanent Temper Thyself entry, with cycle data only from official feeds."""

import html
import re
import time

from website.server.events.announcement_events import (
    SERVER_OFFSETS,
    TIME_TAG,
    normalise_name,
    timestamp,
)


def is_temper_thyself(name: str) -> bool:
    name = normalise_name(name or "")
    return name == "temper thyself" or ("temper thyself" in name and "journey far" in name)


def build_temper_thyself(
    calendar_events=(), announcements=(), server="", now=None, *, notes=None, weekly_end=0
) -> dict:
    """Never infer weekly progress, claims, or cycle dates from publication dates."""
    now = int(time.time()) if now is None else now
    data = {
        "name": "To Temper Thyself and Journey Far",
        "title": "To Temper Thyself and Journey Far",
        "icon": "/static/images/events/permanent/Temper_Thyself.png",
        "has_data": False,
        "checked": False,
        "is_finished": False,
        "is_upcoming": False,
        "start_time": 0,
        "end_time": 0,
        "weekly_end": weekly_end,
        "weekly_start": weekly_end - 7 * 86400 if weekly_end else 0,
        "days_completed": None,
        "days_total": 7,
        "days_required": None,
        "weeks_completed": None,
        "weeks_required": None,
        "is_locked": False,
        "is_active_period": True,
        "weekly_finished": False,
    }
    candidates = [
        event
        for event in calendar_events
        if is_temper_thyself(event.name) and (event.end_timestamp > now or event.end_timestamp <= 0)
    ]
    candidates.sort(key=lambda event: (event.start_timestamp > now, -event.start_timestamp))
    if candidates:
        event = candidates[0]
        upcoming = event.start_timestamp > now
        data.update(
            has_data=True,
            is_finished=bool(event.is_finished) and not upcoming,
            is_upcoming=upcoming,
            start_time=event.start_timestamp,
            end_time=event.end_timestamp,
        )

    windows = []
    for notice in announcements:
        if server not in SERVER_OFFSETS or not is_temper_thyself(notice.title):
            continue
        content = html.unescape(notice.content or "")
        heading = re.search(r"(?:Event|Cycle|Season)\s+(?:Duration|Period)", content, re.I)
        if not heading:
            continue
        section = re.split(
            r"Eligibility|Participation Requirements|Event Details|Gameplay Details",
            content[heading.end() :],
            maxsplit=1,
            flags=re.I,
        )[0]
        dates = list(TIME_TAG.finditer(section))
        if len(dates) != 2:
            continue
        start, end = (timestamp(date, server) for date in dates)
        if start is not None and end is not None and start < end and end > now:
            windows.append((start, end))
    if windows and not data["end_time"]:
        windows.sort(key=lambda window: (window[0] > now, -window[0]))
        start, end = windows[0]
        data.update(start_time=start, end_time=end, is_upcoming=start > now)
    progress = (notes or {}).get("week_active_progress")
    if isinstance(progress, dict):
        data["is_locked"] = progress.get("unlock") is False
        data["is_active_period"] = progress.get("is_active_period") is not False
        fields = (
            "progress_current",
            "progress_total",
            "period_progress_current",
            "period_progress_total",
        )
        values = [progress.get(field) for field in fields]
        valid = all(
            isinstance(value, int) and not isinstance(value, bool) and value >= 0
            for value in values
        )
        if valid and 0 < values[1] <= 7 and values[3] > 0 and values[0] <= 7:
            days, target, weeks, total = values
            completed_days = progress.get("progress_current_arr")
            if (
                isinstance(completed_days, list)
                and all(type(day) is int and 1 <= day <= 7 for day in completed_days)
                and len(set(completed_days)) == len(completed_days)
                and len(completed_days) >= days
            ):
                days = len(completed_days)
            data.update(
                has_data=not data["is_locked"] and data["is_active_period"],
                days_completed=days,
                days_required=target,
                weeks_completed=weeks,
                weeks_required=total,
                weekly_finished=days >= target,
                is_finished=False,
            )
        else:
            data.update(has_data=False, is_finished=False)
    return data
