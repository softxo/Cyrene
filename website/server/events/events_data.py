"""Events data: cached upstream fetching, reward and schedule reuse, and reset times."""

import asyncio
import hashlib
import json
import logging
import re
import time
import typing
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from shared.hoyolab.account_client import get_account_client
from shared.storage.database import (
    get_accounts,
    get_event_activity_checks,
    get_limited_event_checks,
)
from website.server.core.account_access import find_account_by_id
from website.server.events.announcement_events import (
    announcement_reward_events,
    merge_announcement_events,
    notice_event_schedule,
)
from website.server.events.event_supplements import (
    apply_reviewed_event_details,
    apply_reviewed_stygian_opening,
)
from website.server.events.limited_event_checks import (
    annotate_daily_events,
    apply_archon_quest_progress,
    apply_completion_checks,
    completion_token,
)
from website.server.events.quest_reward_details import enrich_quest_rewards
from website.server.events.temper_thyself import build_temper_thyself, is_temper_thyself
from website.server.events.theater_elements import get_theater_season
from website.server.events.wiki_event_details import enrich_upcoming_events
from website.server.events.wish_previews import clean_wish_title, enrich_wish_previews

logger = logging.getLogger(__name__)


def get_event_activity_period_keys(
    genshin_server: str,
) -> tuple[str, str]:
    """
    Return the current Daily Commissions and Trounce Domains period keys for a Genshin server.
    """

    daily_reset = get_daily_reset_timestamp(genshin_server)
    weekly_reset = get_weekly_reset_timestamp(genshin_server)
    daily_period_timestamp = daily_reset - 86400
    weekly_period_timestamp = weekly_reset - (7 * 86400)
    daily_period_key = datetime.fromtimestamp(
        daily_period_timestamp,
        tz=timezone.utc,
    ).strftime("%Y-%m-%d")
    weekly_period_key = datetime.fromtimestamp(
        weekly_period_timestamp,
        tz=timezone.utc,
    ).strftime("%G-W%V")

    return daily_period_key, weekly_period_key


EVENTS_CACHE_TTL = 30
EVENTS_STALE_TTL = 300

_events_cache = {}

ANNOUNCEMENTS_CACHE_TTL = 300
_announcements_cache: dict[str, tuple[float, list]] = {}


async def _get_shared_announcements(client, server: str) -> list:
    cached = _announcements_cache.get(server)
    if cached and time.monotonic() - cached[0] < ANNOUNCEMENTS_CACHE_TTL:
        return cached[1]
    announcements = list(await client.get_genshin_announcements())
    _announcements_cache[server] = (time.monotonic(), announcements)
    return announcements


CHRONICLE_CACHE_TTL = 600
_chronicle_cache: dict[tuple[int, str, str], tuple[float, typing.Any]] = {}


async def _get_cached_chronicle(user_id: int, account: dict, name: str, fetch):
    key = (user_id, account["genshin_uid"], name)
    cached = _chronicle_cache.get(key)
    now = time.monotonic()
    if cached and now - cached[0] < CHRONICLE_CACHE_TTL:
        return cached[1]
    result = await fetch()
    if len(_chronicle_cache) > 512:
        for stale in [
            k for k, (at, _) in _chronicle_cache.items() if now - at >= CHRONICLE_CACHE_TTL
        ]:
            _chronicle_cache.pop(stale, None)
    _chronicle_cache[key] = (time.monotonic(), result)
    return result


def _events_periods_current(data: dict) -> bool:
    """Whether a daily or Temper Thyself period has rolled over since the data was cached."""
    now = time.time()
    if any(
        event.get("daily_reset_time", float("inf")) <= now
        for event in data.get("limited_events", [])
    ):
        return False
    temper = data.get("temper_thyself", {})
    return not ((0 < temper.get("end_time", 0) <= now) or (0 < temper.get("weekly_end", 0) <= now))


INVENTORY_CACHE_TTL = 300
_inventory_cache = {}


async def get_cached_inventory(user_id: int, account: dict) -> list[dict]:
    """Return a recently fetched inventory, scoped to its linked account."""
    cache_key = (user_id, account["id"], account["genshin_uid"])
    cached = _inventory_cache.get(cache_key)

    if cached and time.monotonic() - cached["timestamp"] < INVENTORY_CACHE_TTL:
        return cached["data"]

    client = await get_account_client(user_id, account["genshin_uid"])
    if client is None:
        raise RuntimeError("Unable to load the selected account.")

    async with client:
        inventory = await client.get_genshin_inventory()

    _inventory_cache[cache_key] = {
        "timestamp": time.monotonic(),
        "data": inventory,
    }
    return inventory


_events_inflight: dict[tuple, asyncio.Task] = {}
_events_preview_tasks: set[asyncio.Task] = set()


async def get_single_account_events(user_id: int, account: dict, include_featured: bool = True):
    key = (user_id, account["id"], account["genshin_uid"], include_featured)
    cached = _events_cache.get(key)
    if (
        cached
        and EVENTS_CACHE_TTL <= time.monotonic() - cached["timestamp"] < EVENTS_STALE_TTL
        and _events_periods_current(cached["data"])
    ):
        _events_fetch_task(key, user_id, account, include_featured)
        return cached["data"]
    return await asyncio.shield(_events_fetch_task(key, user_id, account, include_featured))


def _events_fetch_task(key, user_id, account, include_featured) -> asyncio.Task:
    task = _events_inflight.get(key)
    if task is None or task.done():
        task = asyncio.create_task(_fetch_single_account_events(user_id, account, include_featured))
        _events_inflight[key] = task

        def finished(completed):
            if _events_inflight.get(key) is completed:
                _events_inflight.pop(key, None)
            if not completed.cancelled():
                completed.exception()

        task.add_done_callback(finished)
    return task


async def _finalise_limited_events(user_id, account, events):
    if not events:
        return
    annotate_daily_events(events, get_daily_reset_timestamp(account["genshin_server"]))
    apply_completion_checks(events, await get_limited_event_checks(user_id, account["genshin_uid"]))
    for event in events:
        if event.get("is_upcoming"):
            event["completion_token"] = ""
            continue
        expires = min(
            event["end_time"] or int(time.time()) + 7 * 86400, int(time.time()) + 7 * 86400
        )
        if event.get("daily_reset_time"):
            expires = min(expires, event["daily_reset_time"])
        event["completion_token"] = completion_token(
            user_id, account["genshin_uid"], event["completion_key"], expires
        )


def _reuse_known_event_rewards(previous, events, now):
    """Retain reward previews for the same unexpired event period."""
    saved = {
        (event.get("id"), event["name"]): event for event in previous.get("limited_events", [])
    }
    for event in events:
        if event.get("rewards"):
            continue
        prior = saved.get((event.get("id"), event["name"]))
        if not prior or not prior.get("rewards") or prior.get("end_time", 0) <= now:
            continue
        if any(
            event.get(field) and prior.get(field) != event[field]
            for field in ("start_time", "end_time", "opening_date")
        ):
            continue
        for field in ("rewards", "insight_rewards", "reward_source", "reward_preview_note"):
            if field in prior:
                event[field] = deepcopy(prior[field])


def _reuse_known_event_schedules(previous, events, now):
    """Keep a current exact schedule while optional previews are refreshed."""
    saved = {
        (event.get("id"), event["name"]): event for event in previous.get("limited_events", [])
    }
    for event in events:
        if event.get("start_time") or event.get("end_time"):
            continue
        prior = saved.get((event.get("id"), event["name"]))
        if not prior or not prior.get("start_time") or prior.get("end_time", 0) <= now:
            continue
        opening_day = event.get("opening_date_timestamp")
        if opening_day and not opening_day <= prior["start_time"] < opening_day + 86400:
            continue
        event["start_time"] = prior["start_time"]
        event["end_time"] = prior["end_time"]
        event["is_upcoming"] = prior["start_time"] > now
        event["is_unscheduled_upcoming"] = False
        if prior.get("opening_source"):
            event["opening_source"] = prior["opening_source"]


def _reuse_event_previews(previous, limited_events, wish_banners, theater_data):
    fields = (
        "rewards",
        "insight_rewards",
        "reward_source",
        "reward_preview_note",
        "start_time",
        "end_time",
        "opening_source",
        "is_upcoming",
        "is_unscheduled_upcoming",
    )
    saved = {(event.get("id"), event["name"]): event for event in previous["limited_events"]}
    for event in limited_events:
        prior = saved.get((event.get("id"), event["name"]))
        if prior:
            for field in fields:
                if field in prior:
                    event[field] = deepcopy(prior[field])
    wish_banners[:] = deepcopy(previous["wish_banners"])
    for field in ("elements", "opening_cast"):
        if field in previous["theater"]:
            theater_data[field] = deepcopy(previous["theater"][field])


async def _enrich_account_events(cache_key, entry, announcements, theater_start=0):
    """Publish optional public previews atomically, without holding up page reads."""
    enriched = deepcopy(entry["data"])
    account = enriched["account"]
    server = account["genshin_server"]
    now = int(time.time())

    async def limited():
        await enrich_quest_rewards(enriched["limited_events"])
        await enrich_upcoming_events(enriched["limited_events"], server, now)
        await _finalise_limited_events(cache_key[0], account, enriched["limited_events"])

    async def theater():
        if theater_start:
            enriched["theater"].update(await get_theater_season(theater_start, server))

    async def bounded(name, work):
        try:
            async with asyncio.timeout(20):
                await work
                return True
        except Exception:
            logging.getLogger(__name__).warning(
                "Events %s enrichment unavailable", name, exc_info=True
            )
            return False

    try:
        completed = await asyncio.gather(
            bounded("limited", limited()),
            bounded(
                "wishes", enrich_wish_previews(enriched["wish_banners"], announcements, server, now)
            ),
            bounded("theater", theater()),
        )
        enriched["previews_pending"] = False
        if _events_cache.get(cache_key) is entry:
            entry["data"] = enriched
            entry["preview_expiry"] = time.monotonic() + (900 if all(completed) else 60)
    finally:
        if _events_cache.get(cache_key) is entry:
            entry["data"]["previews_pending"] = False


async def _fetch_single_account_events(
    user_id: int,
    account: dict,
    include_featured: bool = True,
):
    cache_key = (
        user_id,
        account["id"],
        account["genshin_uid"],
        include_featured,
    )
    cached = _events_cache.get(cache_key)

    if cached:
        cache_age = time.monotonic() - cached["timestamp"]

        if cache_age < EVENTS_CACHE_TTL and _events_periods_current(cached["data"]):
            return cached["data"]

    abyss_data = {
        "has_data": False,
        "max_floor": "—",
        "total_stars": 0,
        "end_time": 0,
        "chambers": [],
    }
    theater_data = {
        "has_data": False,
        "best_round": 0,
        "arcanums": 0,
        "medals": 0,
        "end_time": 0,
        "elements": [],
        "opening_cast": [],
    }
    stygian_data = {
        "has_data": False,
        "end_time": 0,
        "difficulty": 0,
        "difficulty_icon": "",
        "best_time": 0,
        "bosses": [],
        "dire_prestige": {
            "available": False,
            "active": False,
            "ended": False,
            "progress": 0,
            "max_progress": 0,
        },
    }
    daily_data = {
        "has_data": False,
        "completed": 0,
        "total": 4,
        "claimed_reward": False,
        "handbook_claimed": False,
        "encounter_points": 0,
        "reset_time": 0,
        "manual_checked": None,
    }
    resin_data = {
        "has_data": False,
        "current": 0,
        "maximum": 200,
        "next_resin_at": None,
        "full_resin_at": None,
    }
    trounce_data = {
        "has_data": False,
        "remaining": 0,
        "total": 3,
        "reset_time": 0,
        "manual_checked": None,
    }
    wish_banners = []
    limited_events = []
    temper_thyself = build_temper_thyself()
    announcements = []
    theater_start = 0
    previews_available = False

    try:
        client = await get_account_client(
            user_id,
            account["genshin_uid"],
        )

        if client is not None:

            async def timed_event_request(name, awaitable):
                return await awaitable

            async with client:
                requests = [
                    timed_event_request(
                        "Announcements",
                        _get_shared_announcements(client, account["genshin_server"]),
                    ),
                    timed_event_request(
                        "Event Calendar",
                        client.get_genshin_event_calendar(),
                    ),
                    timed_event_request(
                        "Abyss",
                        _get_cached_chronicle(
                            user_id, account, "abyss", client.get_genshin_spiral_abyss
                        ),
                    ),
                    timed_event_request(
                        "Notes",
                        client.get_genshin_notes(),
                    ),
                ]

                if include_featured:
                    requests.extend(
                        [
                            timed_event_request(
                                "Theater",
                                _get_cached_chronicle(
                                    user_id, account, "theater", client.get_imaginarium_theater
                                ),
                            ),
                            timed_event_request(
                                "Stygian",
                                _get_cached_chronicle(
                                    user_id, account, "stygian", client.get_stygian_onslaught
                                ),
                            ),
                        ]
                    )

                results = await asyncio.gather(*requests)
                previews_available = True
                announcements = results[0]
                event_calendar = results[1]
                abyss = results[2]
                notes = results[3]

                if include_featured:
                    theater = results[4]
                    stygian = results[5]

            dire_prestige_data = {
                "available": False,
                "active": False,
                "ended": False,
                "progress": 0,
                "max_progress": 0,
            }
            stygian_calendar_events = []
            try:
                stygian_calendar_events = [
                    event
                    for event in event_calendar.events
                    if getattr(event, "stygian_detail", None) is not None
                ]

                for event in stygian_calendar_events:
                    dire_prestige_data["available"] = True
                    stygian_detail = getattr(
                        event,
                        "stygian_detail",
                        None,
                    )
                    outbreak = getattr(
                        stygian_detail,
                        "disturbance_outbreak",
                        None,
                    )

                    if outbreak is not None:
                        progress = outbreak.progress
                        max_progress = outbreak.max_progress

                        if max_progress > 0:
                            dire_prestige_data.update(
                                {
                                    "active": True,
                                    "ended": False,
                                    "progress": progress,
                                    "max_progress": max_progress,
                                }
                            )
                        else:
                            dire_prestige_data.update(
                                {
                                    "active": False,
                                    "ended": True,
                                    "progress": 0,
                                    "max_progress": 0,
                                }
                            )

                        break

                if dire_prestige_data["available"] and not dire_prestige_data["active"]:
                    dire_prestige_data["ended"] = True

            except Exception as error:
                logging.getLogger(__name__).warning(
                    "Dire Prestige fetch failed for UID %s: %s: %s",
                    account["genshin_uid"],
                    type(error).__name__,
                    error,
                )

            stygian_data["dire_prestige"] = dire_prestige_data
            now_timestamp = int(datetime.now(timezone.utc).timestamp())

            def normalise_event_name(value: str) -> str:
                value = re.sub(r"<[^>]+>", "", value or "")
                return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()

            seen_limited_events = set()
            calendar_events = (
                *event_calendar.events,
                *event_calendar.challenges,
            )
            temper_thyself = build_temper_thyself(
                calendar_events,
                announcements,
                account["genshin_server"],
                now_timestamp,
                notes=notes.get("data", {}),
                weekly_end=get_weekly_reset_timestamp(account["genshin_server"]),
            )

            for calendar_event in calendar_events:
                if is_temper_thyself(calendar_event.name):
                    continue
                event_key = (
                    calendar_event.id,
                    normalise_event_name(calendar_event.name),
                )
                if (
                    event_key in seen_limited_events
                    or (
                        calendar_event.end_timestamp > 0
                        and calendar_event.end_timestamp <= now_timestamp
                    )
                    or calendar_event.abyss_detail is not None
                    or calendar_event.theater_detail is not None
                    or getattr(
                        calendar_event,
                        "stygian_detail",
                        None,
                    )
                    is not None
                ):
                    continue

                seen_limited_events.add(event_key)

                event_name = re.sub(
                    r"<[^>]+>",
                    "",
                    calendar_event.name,
                ).strip()
                normalised_name = normalise_event_name(event_name)
                matching_announcement = next(
                    (
                        announcement
                        for announcement in announcements
                        if normalised_name
                        and (
                            normalised_name in normalise_event_name(announcement.title)
                            or normalised_name in normalise_event_name(announcement.subtitle)
                        )
                    ),
                    None,
                )
                icon = None
                if matching_announcement is not None:
                    icon = matching_announcement.img or matching_announcement.banner
                if not icon and calendar_event.rewards:
                    icon = calendar_event.rewards[0].icon

                start_time = calendar_event.start_timestamp
                end_time = calendar_event.end_timestamp
                schedule = notice_event_schedule(matching_announcement, account["genshin_server"])
                if schedule:
                    start_time = start_time or schedule[0]
                    end_time = end_time or schedule[1]
                if not start_time and not end_time and calendar_event.countdown_seconds > 0:
                    start_time = now_timestamp + calendar_event.countdown_seconds

                all_rewards = [
                    {
                        "id": reward.id,
                        "name": reward.name,
                        "icon": reward.icon,
                        "amount": reward.num,
                        "rarity": reward.rarity,
                        "homepage_show": reward.homepage_show,
                    }
                    for reward in calendar_event.rewards
                ]
                is_tcg = any("lucky coin" in reward["name"].casefold() for reward in all_rewards)
                limited_events.append(
                    {
                        "id": calendar_event.id,
                        "name": event_name,
                        "description": calendar_event.description,
                        "icon": icon,
                        "is_tcg": is_tcg,
                        "is_finished": calendar_event.is_finished,
                        "is_upcoming": (start_time > now_timestamp or end_time <= 0),
                        "is_unscheduled_upcoming": (start_time <= 0 and end_time <= 0),
                        "start_time": start_time,
                        "end_time": end_time,
                        "rewards": all_rewards,
                    }
                )

            limited_events = merge_announcement_events(
                limited_events,
                announcement_reward_events(announcements, account["genshin_server"], now_timestamp),
            )
            limited_events = [
                event for event in limited_events if not is_temper_thyself(event["name"])
            ]
            apply_archon_quest_progress(limited_events, notes, now_timestamp)
            apply_reviewed_event_details(limited_events, account["genshin_server"], now_timestamp)

            def find_wish_announcement(names):
                """
                Find the announcement matching the active banner.
                """

                for announcement in announcements:
                    if not announcement.subtitle:
                        continue

                    if not announcement.subtitle.startswith("Event Wish"):
                        continue

                    if not announcement.banner:
                        continue

                    content = announcement.content or ""

                    for name in names:
                        if name.lower() in content.lower():
                            return announcement

                return None

            for banner in event_calendar.character_banners:
                if banner.pool_status != 2 and banner.start_timestamp <= now_timestamp:
                    continue

                if banner.end_timestamp > 0 and banner.end_timestamp <= now_timestamp:
                    continue

                featured_5star_names = [
                    character.name for character in banner.characters if character.rarity == 5
                ]

                if not featured_5star_names:
                    continue

                announcement = find_wish_announcement(featured_5star_names)
                featured_5stars = [
                    {
                        "name": character.name,
                        "icon": character.icon,
                    }
                    for character in banner.characters
                    if character.rarity == 5
                ]
                featured_4stars = [
                    {
                        "name": character.name,
                        "icon": character.icon,
                    }
                    for character in banner.characters
                    if character.rarity == 4
                ]

                wish_banners.append(
                    {
                        "banner_id": banner.id,
                        "banner_type": 301,
                        "title": (
                            clean_banner_title(announcement.subtitle)
                            if announcement
                            else "Character Event Wish"
                        ),
                        "banner_type_name": "Character Event Wish",
                        "image": (announcement.banner if announcement else None),
                        "start_time": banner.start_timestamp,
                        "end_time": banner.end_timestamp,
                        "r5_up_items": featured_5stars,
                        "r4_up_items": featured_4stars,
                    }
                )

            for banner in event_calendar.weapon_banners:
                if banner.pool_status != 2 and banner.start_timestamp <= now_timestamp:
                    continue

                if banner.end_timestamp > 0 and banner.end_timestamp <= now_timestamp:
                    continue

                featured_5star_names = [
                    weapon.name for weapon in banner.weapons if weapon.rarity == 5
                ]
                featured_5stars = [
                    {
                        "name": weapon.name,
                        "icon": weapon.icon,
                    }
                    for weapon in banner.weapons
                    if weapon.rarity == 5
                ]
                featured_4stars = [
                    {
                        "name": weapon.name,
                        "icon": weapon.icon,
                    }
                    for weapon in banner.weapons
                    if weapon.rarity == 4
                ]

                if not featured_5stars:
                    continue

                announcement = find_wish_announcement(featured_5star_names)

                wish_banners.append(
                    {
                        "banner_id": banner.id,
                        "banner_type": 302,
                        "title": (
                            clean_banner_title(announcement.subtitle)
                            if announcement
                            else "Weapon Event Wish"
                        ),
                        "banner_type_name": "Weapon Event Wish",
                        "image": (announcement.banner if announcement else None),
                        "start_time": banner.start_timestamp,
                        "end_time": banner.end_timestamp,
                        "r5_up_items": featured_5stars,
                        "r4_up_items": featured_4stars,
                    }
                )

            for banner in getattr(event_calendar, "chronicled_banners", []):
                if banner.pool_status != 2 and banner.start_timestamp <= now_timestamp:
                    continue
                if banner.end_timestamp > 0 and banner.end_timestamp <= now_timestamp:
                    continue
                featured = [
                    {"name": character.name, "icon": character.icon}
                    for character in banner.characters
                    if character.rarity == 5
                ]
                if not featured:
                    continue
                announcement = find_wish_announcement([item["name"] for item in featured])
                wish_banners.append(
                    {
                        "banner_id": banner.id,
                        "banner_type": 500,
                        "title": clean_banner_title(announcement.subtitle)
                        if announcement
                        else (banner.name or "Chronicled Wish"),
                        "image": announcement.banner if announcement else None,
                        "start_time": banner.start_timestamp,
                        "end_time": banner.end_timestamp,
                        "chronicled_weapons": [
                            {"name": weapon.name, "icon": weapon.icon}
                            for weapon in banner.weapons
                            if weapon.rarity == 5
                        ],
                        "r5_up_items": featured,
                        "r4_up_items": [
                            {"name": character.name, "icon": character.icon}
                            for character in banner.characters
                            if character.rarity == 4
                        ],
                    }
                )

            notes_data = notes["data"]
            daily_task = notes_data.get("daily_task", {})
            daily_commissions = int(notes_data.get("finished_task_num", 0))
            attendance_rewards = daily_task.get("attendance_rewards", [])
            daily_progress = min(4, daily_commissions)
            attendance_rewards = daily_task.get("attendance_rewards", [])
            handbook_claimed = any(
                reward.get("status") == "AttendanceRewardStatusTakenAward"
                for reward in attendance_rewards
            )
            katheryne_claimed = bool(notes_data.get("is_extra_task_reward_received", False))
            daily_data = {
                "has_data": True,
                "completed": daily_progress,
                "total": 4,
                "claimed_reward": katheryne_claimed,
                "handbook_claimed": handbook_claimed,
                "daily_commissions": int(notes_data.get("finished_task_num", 0)),
                "encounter_points": float(daily_task.get("stored_attendance", 0)),
                "reset_time": get_daily_reset_timestamp(account["genshin_server"]),
            }

            if katheryne_claimed:
                daily_data["reward_state"] = "claimed"

            elif handbook_claimed:
                daily_data["reward_state"] = "handbook-claimed"

            else:
                daily_data["reward_state"] = "unclaimed"

            notes_data = notes["data"]
            current_resin = notes_data["current_resin"]
            maximum_resin = 200
            recovery_seconds = int(notes_data["resin_recovery_time"])
            now_timestamp = int(time.time())

            if current_resin >= maximum_resin:
                next_resin_at = None
                full_resin_at = None
            else:
                remaining_resin = maximum_resin - current_resin
                next_resin_at = now_timestamp + recovery_seconds - ((remaining_resin - 1) * 480)
                full_resin_at = now_timestamp + recovery_seconds

            resin_data = {
                "has_data": True,
                "current": current_resin,
                "maximum": maximum_resin,
                "next_resin_at": next_resin_at,
                "full_resin_at": full_resin_at,
            }
            trounce_data = {
                "has_data": True,
                "remaining": (notes["data"]["remain_resin_discount_num"]),
                "total": (notes["data"]["resin_discount_num_limit"]),
                "reset_time": get_weekly_reset_timestamp(account["genshin_server"]),
            }
            abyss_chambers = []

            if abyss.floors:
                deepest_floor = max(abyss.floors, key=lambda floor: floor.floor)

                for chamber in deepest_floor.chambers:
                    battles = []

                    for battle in chamber.battles:
                        characters = []

                        for character in battle.characters:
                            characters.append(
                                {
                                    "name": character.name,
                                    "icon": character.icon,
                                }
                            )

                        battles.append(
                            {
                                "half": battle.half,
                                "characters": characters,
                            }
                        )

                    abyss_chambers.append(
                        {
                            "floor": deepest_floor.floor,
                            "chamber": chamber.chamber,
                            "battles": battles,
                        }
                    )

            abyss_data = {
                "has_data": abyss.total_battles > 0,
                "max_floor": abyss.max_floor,
                "total_stars": abyss.total_stars,
                "end_time": abyss.end_time.timestamp(),
                "chambers": abyss_chambers,
            }

            if include_featured and stygian:
                current_stygian = stygian[0]
                record = current_stygian["single"]["best"]
                bosses = []

                for challenge in current_stygian["single"]["challenge"]:
                    characters = []

                    for character in challenge.get("teams", []):
                        characters.append(
                            {
                                "name": character["name"],
                                "icon": character["image"],
                            }
                        )

                    bosses.append(
                        {
                            "name": challenge["monster"]["name"],
                            "icon": challenge["monster"]["icon"],
                            "time": challenge["second"],
                            "characters": characters,
                        }
                    )

                difficulty_icons = {
                    1: "SO_Diff_I.png",
                    2: "SO_Diff_II.png",
                    3: "SO_Diff_III.png",
                    4: "SO_Diff_IV.png",
                    5: "SO_Diff_V.png",
                    6: "SO_Diff_VI.png",
                }
                stygian_data = {
                    "has_data": current_stygian["single"]["has_data"],
                    "end_time": int(current_stygian["schedule"]["end_time"]),
                    "start_time": int(current_stygian["schedule"].get("start_time", 0)),
                    "difficulty": (record["difficulty"] if record else 0),
                    "difficulty_icon": (
                        "SO_Diff_VI_180.png"
                        if (record and record["difficulty"] == 6 and record["second"] < 180)
                        else (difficulty_icons.get(record["difficulty"], "") if record else "")
                    ),
                    "best_time": record["second"] if record else 0,
                    "bosses": bosses,
                }

            stygian_data["dire_prestige"] = dire_prestige_data
            for calendar_entry in stygian_calendar_events:
                if calendar_entry.start_timestamp > now_timestamp:
                    stygian_data["start_time"] = calendar_entry.start_timestamp
                    break
            apply_reviewed_stygian_opening(stygian_data, account["genshin_server"], now_timestamp)

            if include_featured and theater:
                current_cycle = theater["data"][0]
                stat = current_cycle["stat"]
                schedule = current_cycle["schedule"]
                detail = current_cycle["detail"]
                acts = detail["rounds_data"]
                arcanums = sum(1 for act in acts if act.get("is_tarot") is True)
                theater_start = schedule.get("start_time", 0)
                season_details = {"elements": [], "opening_cast": []}
                theater_data = {
                    "has_data": stat["max_round_id"] > 0,
                    "best_round": stat["max_round_id"],
                    "arcanums": arcanums,
                    "medals": stat["medal_num"],
                    "end_time": schedule["end_time"],
                    **season_details,
                }

    except Exception:
        logger.exception("Could not load events for account %s.", account.get("genshin_uid"))

    daily_key, weekly_key = get_event_activity_period_keys(account["genshin_server"])
    checks = await get_event_activity_checks(user_id, account["genshin_uid"], daily_key, weekly_key)
    temper_thyself["checked"] = bool(checks.get("temper_thyself"))
    for activity, state, automatic in (
        (
            "daily_commissions",
            daily_data,
            daily_data["has_data"]
            and daily_data["completed"] >= daily_data["total"]
            and daily_data["claimed_reward"],
        ),
        (
            "trounce_domains",
            trounce_data,
            trounce_data["has_data"] and trounce_data["remaining"] <= 0,
        ),
    ):
        state["manual_checked"] = checks.get(activity)
        state["checked"] = automatic if state["manual_checked"] is None else state["manual_checked"]

    preview_signature = hashlib.sha256(
        json.dumps(
            [
                theater_start,
                [
                    {
                        key: event.get(key)
                        for key in (
                            "id",
                            "name",
                            "start_time",
                            "end_time",
                            "is_upcoming",
                            "category",
                            "rewards",
                        )
                    }
                    for event in limited_events
                ],
                wish_banners,
                [str(notice) for notice in announcements],
            ],
            sort_keys=True,
            default=str,
        ).encode()
    ).hexdigest()
    preview_expiry = 0
    if cached and cached.get("preview_signature") == preview_signature:
        _reuse_event_previews(cached["data"], limited_events, wish_banners, theater_data)
        preview_expiry = cached.get("preview_expiry", 0)
        if preview_expiry > time.monotonic():
            previews_available = False
    if cached:
        _reuse_known_event_schedules(cached["data"], limited_events, int(time.time()))
        _reuse_known_event_rewards(cached["data"], limited_events, int(time.time()))
    await _finalise_limited_events(user_id, account, limited_events)

    result = {
        "account": account,
        "previews_pending": previews_available,
        "abyss": abyss_data,
        "theater": theater_data,
        "stygian": stygian_data,
        "daily": daily_data,
        "trounce": trounce_data,
        "resin": resin_data,
        "wish_banners": wish_banners,
        "limited_events": limited_events,
        "temper_thyself": temper_thyself,
    }
    entry = {
        "timestamp": time.monotonic(),
        "data": result,
        "preview_signature": preview_signature,
        "preview_expiry": preview_expiry,
    }
    _events_cache[cache_key] = entry
    if previews_available:
        task = asyncio.create_task(
            _enrich_account_events(cache_key, entry, announcements, theater_start)
        )
        _events_preview_tasks.add(task)
        task.add_done_callback(_events_preview_tasks.discard)
    return result


async def get_events_data(
    user_id: int,
    account_id: int | None = None,
    overview: bool = False,
):
    accounts = await get_accounts(user_id)
    selected_account = None

    if accounts:
        if account_id is not None:
            selected_account = find_account_by_id(accounts, account_id)

        if selected_account is None:
            selected_account = accounts[0]

    if overview:
        overview_data = await asyncio.gather(
            *[
                get_single_account_events(
                    user_id,
                    account,
                    include_featured=True,
                )
                for account in accounts
            ]
        )

        return {
            "accounts": accounts,
            "selected_account": selected_account,
            "overview": True,
            "overview_data": overview_data,
            "previews_pending": any(item.get("previews_pending") for item in overview_data),
        }

    if selected_account is not None:
        account_events = await get_single_account_events(
            user_id,
            selected_account,
        )

        return {
            "accounts": accounts,
            "selected_account": selected_account,
            "overview": False,
            "previews_pending": account_events.get("previews_pending", False),
            "abyss": account_events["abyss"],
            "theater": account_events["theater"],
            "stygian": account_events["stygian"],
            "daily": account_events["daily"],
            "trounce": account_events["trounce"],
            "wish_banners": account_events["wish_banners"],
            "limited_events": account_events["limited_events"],
            "temper_thyself": account_events["temper_thyself"],
        }

    return {
        "accounts": accounts,
        "selected_account": None,
        "overview": False,
        "abyss": {
            "has_data": False,
            "max_floor": "—",
            "total_stars": 0,
            "end_time": 0,
            "chambers": [],
        },
        "theater": {
            "has_data": False,
            "best_round": 0,
            "arcanums": 0,
            "medals": 0,
            "end_time": 0,
            "elements": [],
            "opening_cast": [],
        },
        "stygian": {
            "has_data": False,
            "end_time": 0,
            "difficulty": 0,
            "difficulty_icon": "",
            "best_time": 0,
            "bosses": [],
            "dire_prestige": {
                "ended": True,
                "available": False,
                "active": False,
                "progress": 0,
                "max_progress": 0,
            },
        },
        "daily": {
            "has_data": False,
            "completed": 0,
            "total": 4,
            "claimed_reward": False,
            "encounter_points": 0,
            "reset_time": 0,
        },
        "trounce": {
            "has_data": False,
            "remaining": 0,
            "total": 3,
            "reset_time": 0,
        },
        "wish_banners": [],
        "limited_events": [],
        "temper_thyself": build_temper_thyself(),
    }


def clean_banner_title(title: str) -> str:
    return clean_wish_title(title)


def get_daily_reset_timestamp(genshin_server: str) -> int:
    server_offsets = {
        "os_usa": timezone(timedelta(hours=-5)),
        "os_euro": timezone(timedelta(hours=1)),
        "os_asia": timezone(timedelta(hours=8)),
    }
    timezone_value = server_offsets.get(genshin_server, timezone.utc)
    now = datetime.now(timezone_value)
    reset = now.replace(hour=4, minute=0, second=0, microsecond=0)

    if now >= reset:
        reset += timedelta(days=1)

    return int(reset.timestamp())


def get_weekly_reset_timestamp(genshin_server: str) -> int:
    server_offsets = {
        "os_usa": timezone(timedelta(hours=-5)),
        "os_euro": timezone(timedelta(hours=1)),
        "os_asia": timezone(timedelta(hours=8)),
    }
    timezone_value = server_offsets.get(genshin_server, timezone.utc)
    now = datetime.now(timezone_value)
    days_until_monday = (7 - now.weekday()) % 7
    reset = (now + timedelta(days=days_until_monday)).replace(
        hour=4, minute=0, second=0, microsecond=0
    )

    if reset <= now:
        reset += timedelta(days=7)

    return int(reset.timestamp())
