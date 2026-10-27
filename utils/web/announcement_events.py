"""Discover limited quest/exploration reward windows from official game notices.

Notice visibility dates are not event dates. Only an explicit reward-duration
section is accepted; permanent quest notices and unrecognised formats are skipped.
"""

import html
import re
from datetime import datetime, timedelta, timezone

SERVER_OFFSETS = {"os_usa": -5, "os_euro": 1, "os_asia": 8, "os_cht": 8}
TIME_TAG = re.compile(
    r'<t\b[^>]*class=["\'](?P<kind>t_lc|t_gl)["\'][^>]*>\s*(?P<date>\d{4}/\d{2}/\d{2} \d{2}:\d{2})\s*</t>',
    re.I,
)


def plain_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(value))).strip()


def normalise_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", plain_text(value).casefold()).strip()


def announcement_rewards(content: str) -> list[dict]:
    # Only read the reward summary, before duration/unlock criteria and quest text.
    summary = plain_text(content).split("〓", 1)[0]
    rewards = []
    if re.search(r"\bPrimogems?\b", summary, re.I):
        amount = re.search(r"\bPrimogems?\s*[×x]\s*([\d,]+)", summary, re.I)
        rewards.append(
            {
                "id": 201,
                "name": "Primogems",
                "icon": "/static/images/misc/Primogem.webp",
                "amount": int(amount[1].replace(",", "")) if amount else None,
                "rarity": 5,
                "homepage_show": False,
            }
        )
    for name in (
        "Character Ascension Materials",
        "Character Level-Up Materials",
        "regional specialties",
    ):
        if re.search(re.escape(name), summary, re.I):
            rewards.append(
                {
                    "id": name,
                    "name": name.capitalize() if name == "regional specialties" else name,
                    "icon": None,
                    "amount": None,
                    "rarity": 0,
                    "homepage_show": False,
                }
            )
    return rewards


def timestamp(match, server: str) -> int | None:
    offset = 8 if match["kind"] == "t_gl" else SERVER_OFFSETS[server]
    try:
        date = datetime.strptime(match["date"], "%Y/%m/%d %H:%M")
    except ValueError:
        return None
    return int(date.replace(tzinfo=timezone(timedelta(hours=offset))).timestamp())


def announcement_reward_events(announcements, server: str, now: int) -> list[dict]:
    if server not in SERVER_OFFSETS:
        return []

    # Version-relative openings use the update schedule, never notice publication.
    versions = {}
    for announcement in announcements:
        version = re.search(r"Version (\d+)\.(\d+) Update Details", announcement.title, re.I)
        if not version:
            continue
        content = html.unescape(announcement.content)
        schedule = re.search(r"〓Update Schedule〓(.*?)(?:〓|$)", content, re.S)
        if not schedule:
            continue
        start = TIME_TAG.search(schedule[1])
        hours = re.search(r"estimated to take (\d+) hours?", plain_text(schedule[1]), re.I)
        if start and hours:
            maintenance = timestamp(start, server)
            if maintenance is not None:
                versions[tuple(map(int, version.groups()))] = maintenance + int(hours[1]) * 3600

    result = []
    for announcement in announcements:
        title = plain_text(announcement.title)
        # Prerequisite quests mentioned in ordinary event notices do not qualify.
        if not re.search(r"within the specified (?:duration|time period)", title, re.I):
            continue
        if re.search(r"exploration missions?", title, re.I):
            category = "World Exploration"
        elif re.search(r"complete (?:the |a |an )?(?:archon |story |world )?quest", title, re.I):
            category = "Quest"
        else:
            continue
        content = html.unescape(announcement.content)
        duration = re.search(
            r"〓(?:Specified Duration|Event Duration)〓(.*?)(?:〓|$)", content, re.S
        )
        if not duration:
            continue
        dates = list(TIME_TAG.finditer(duration[1]))
        if not dates:
            continue
        end = timestamp(dates[-1], server)
        if end is None:
            continue
        end += 59
        if end <= now:
            continue
        if len(dates) >= 2:
            start = timestamp(dates[0], server)
        else:
            version = re.search(
                r"After the Version (\d+)\.(\d+) update", plain_text(duration[1]), re.I
            )
            if not version or not versions:
                continue
            version_key = tuple(map(int, version.groups()))
            if version_key in versions:
                start = versions[version_key]
            elif version_key < max(versions) and versions[max(versions)] <= now:
                start = 0  # Earlier version is already live; exact opening is unavailable.
            else:
                continue
        if start is None or start >= end:
            continue
        name = plain_text(announcement.subtitle or title).strip('"“” ')
        result.append(
            {
                "id": f"announcement:{announcement.id}",
                "name": name,
                "category": category,
                "description": "Bonus reward period. Account completion is not available from HoYoLAB's calendar.",
                "icon": announcement.img or announcement.banner,
                "is_tcg": False,
                "is_finished": False,
                "progress_available": False,
                "is_upcoming": start > now,
                "is_unscheduled_upcoming": False,
                "start_time": start,
                "end_time": end,
                "rewards": announcement_rewards(announcement.content),
            }
        )
    return result


def merge_announcement_events(events: list[dict], supplements: list[dict]) -> list[dict]:
    result = [dict(event) for event in events]
    for supplement in supplements:
        name = normalise_name(supplement["name"])
        match = next(
            (
                event
                for event in result
                if normalise_name(event["name"]) == name
                and (
                    not event["end_time"]
                    or max(event["start_time"], supplement["start_time"])
                    < min(event["end_time"], supplement["end_time"])
                )
            ),
            None,
        )
        if match is None:
            result.append(dict(supplement))
        else:
            match["category"] = supplement["category"]
    return sorted(
        result,
        key=lambda event: (
            event["is_upcoming"],
            event["is_tcg"],
            event["start_time"] if event["is_upcoming"] else event["end_time"],
        ),
    )
