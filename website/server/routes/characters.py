"""Character page and the plan, showcase and planner cost APIs."""

import json
from datetime import datetime

from fastapi import APIRouter, Cookie, Request
from fastapi.logger import logger
from fastapi.responses import HTMLResponse, JSONResponse
from genshin.models.genshin.constants import CHARACTER_NAMES

from shared.hoyolab.account_client import get_account_client
from shared.storage.database import (
    get_accounts,
    get_character_plan_snapshot,
    recover_character_plans,
    replace_character_plans,
)
from website.server.content.content_metadata import (
    character_content_metadata,
    character_weapon_type,
)
from website.server.content.planner_costs import PlannerValidationError, calculate_planner_costs
from website.server.core.account_access import find_account_by_id
from website.server.core.auth import get_web_session, verification_redirect
from website.server.core.templating import BASE_DIR, templates

router = APIRouter()


@router.get("/characters", response_class=HTMLResponse)
async def characters_page(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    session = await get_web_session(cyrene_session)

    if session is None:
        return verification_redirect("/characters")

    user_id = session.user_id
    accounts = await get_accounts(user_id)
    selected_account = find_account_by_id(accounts, account_id) if account_id is not None else None

    if selected_account is None and accounts:
        selected_account = accounts[0]

    characters = []
    character_error = None
    release_dates = json.loads(
        (BASE_DIR / "data" / "metadata" / "character_release_dates.json").read_text(
            encoding="utf-8"
        )
    )["dates"]
    release_dates.update({"Aether": "2020-09-28", "Lumine": "2020-09-28"})
    local_weapon_types = {}
    for entry in (BASE_DIR / "data" / "characters").glob("*.json"):
        local_character = json.loads(entry.read_text(encoding="utf-8"))
        if local_character.get("name") and local_character.get("weapon"):
            local_weapon_types[local_character["name"]] = local_character["weapon"].title()
        if local_character.get("release") and local_character.get("name"):
            release_dates[local_character["name"]] = (
                datetime.strptime(local_character["release"], "%d-%m-%Y").date().isoformat()
            )

    character_catalogue = []
    catalogue = CHARACTER_NAMES.get("en-us", {})
    traveler_names = {
        10000005: "Aether",
        10000007: "Lumine",
    }

    for character_id, data in catalogue.items():
        character_id = int(character_id)

        character_catalogue.append(
            {
                "id": character_id,
                "name": traveler_names.get(character_id, data.name),
                "element": data.element,
                "rarity": data.rarity,
                "icon": (f"https://enka.network/ui/UI_AvatarIcon_{data.icon_name}.png"),
            }
        )

    character_catalogue.sort(key=lambda character: character["name"].casefold())

    if selected_account is not None:
        client = await get_account_client(
            user_id,
            selected_account["genshin_uid"],
        )

        if client is None:
            character_error = "Unable to load the selected account."
        else:
            try:
                async with client:
                    owned_characters = await client.get_genshin_characters()

                owned_by_id = {int(character.id): character for character in owned_characters}
                catalogue = CHARACTER_NAMES.get("en-us", {})

                def get_weapon_type(character, catalogue_data):
                    """Return a normalised Genshin weapon type."""

                    weapon_types = {
                        1: "Sword",
                        10: "Catalyst",
                        11: "Claymore",
                        12: "Bow",
                        13: "Polearm",
                    }

                    for source in (character, catalogue_data):
                        if source is None:
                            continue

                        value = getattr(source, "weapon_type", None)

                        if value is None:
                            continue

                        value = getattr(value, "value", value)

                        try:
                            weapon_id = int(value)
                        except TypeError, ValueError:
                            continue

                        if weapon_id in weapon_types:
                            return weapon_types[weapon_id]

                    return ""

                for character_id, data in catalogue.items():
                    character_id = int(character_id)
                    other_traveler_id = {
                        10000005: 10000007,
                        10000007: 10000005,
                    }.get(character_id)
                    if other_traveler_id in owned_by_id and character_id not in owned_by_id:
                        continue

                    owned = owned_by_id.get(int(character_id))
                    traveler_names = {
                        10000005: "Aether",
                        10000007: "Lumine",
                    }
                    name = traveler_names.get(
                        int(character_id),
                        data.name,
                    )
                    icon = (
                        owned.icon
                        if owned is not None
                        else (f"https://enka.network/ui/UI_AvatarIcon_{data.icon_name}.png")
                    )

                    characters.append(
                        {
                            "id": int(character_id),
                            "name": (owned.name if owned is not None else name),
                            "element": (owned.element if owned is not None else data.element),
                            "rarity": (owned.rarity if owned is not None else data.rarity),
                            "icon": icon,
                            "level": (owned.level if owned is not None else None),
                            "friendship": (owned.friendship if owned is not None else None),
                            "constellation": (owned.constellation if owned is not None else None),
                            **character_content_metadata(
                                owned.name if owned is not None else name,
                                release_dates.get(name, ""),
                            ),
                            "weapon": get_weapon_type(owned, data)
                            or character_weapon_type(character_id, name)
                            or local_weapon_types.get(name, ""),
                            "owned": owned is not None,
                        }
                    )

                catalogue_ids = {int(character_id) for character_id in catalogue}
                for owned in owned_characters:
                    character_id = int(owned.id)
                    if character_id in catalogue_ids:
                        continue

                    name = str(getattr(owned, "name", "") or f"Character {character_id}")
                    characters.append(
                        {
                            "id": character_id,
                            "name": name,
                            "element": getattr(owned, "element", "") or "",
                            "rarity": getattr(owned, "rarity", 0) or 0,
                            "icon": getattr(owned, "icon", "") or "",
                            "level": getattr(owned, "level", None),
                            "friendship": getattr(owned, "friendship", None),
                            "constellation": getattr(owned, "constellation", None),
                            **character_content_metadata(
                                name,
                                release_dates.get(name, ""),
                            ),
                            "weapon": get_weapon_type(owned, None)
                            or character_weapon_type(character_id, name)
                            or local_weapon_types.get(name, ""),
                            "owned": True,
                        }
                    )

                characters.sort(
                    key=lambda character: (
                        not character["owned"],
                        -(character["level"] or 0),
                        -int(character.get("unreleased", False)),
                        -(
                            datetime.fromisoformat(character["release_date"]).toordinal()
                            if character.get("unreleased") and character.get("release_date")
                            else 0
                        ),
                        -(character["rarity"] or 0),
                        character["name"].casefold(),
                    )
                )

            except Exception:
                logger.exception(
                    "Failed to retrieve characters for account %s",
                    selected_account["id"],
                )
                character_error = (
                    "Couldn't retrieve characters from HoYoLAB "
                    "or build the character roster. "
                    "Please try again later."
                )

    from shared.previews.sync import catalogue as preview_catalogue

    weapon_types = {1: "Sword", 10: "Catalyst", 11: "Claymore", 12: "Polearm", 13: "Bow"}
    gem_elements = {
        104111: "Pyro",
        104121: "Hydro",
        104131: "Dendro",
        104141: "Electro",
        104151: "Anemo",
        104161: "Cryo",
        104171: "Geo",
    }
    known_ids = {item["id"] for item in character_catalogue}
    visible_ids = {item["id"] for item in characters}
    for entry in preview_catalogue("characters"):
        item = entry["characters"]
        weapon = weapon_types.get(item.get("weapon_type_id"))
        element = next(
            (
                gem_elements[cost["id"]]
                for cost in item["costs"]["ascend1"]
                if cost["id"] in gem_elements
            ),
            "",
        )
        if not weapon or not element or not item.get("icon") or not item.get("rarity"):
            continue
        row = {
            "id": item["id"],
            "name": item["name"],
            "element": element,
            "rarity": item["rarity"],
            "icon": item["icon"],
            "weapon": weapon,
            "owned": False,
            "level": None,
            "friendship": None,
            "constellation": None,
            "unreleased": not entry.get("release_confirmed", False),
            "release_date": "",
        }
        if row["id"] not in known_ids:
            character_catalogue.append(row)
        for existing in characters:
            if existing["id"] == row["id"] and not existing["owned"]:
                existing["unreleased"] = row["unreleased"]
        if selected_account is not None and not character_error and row["id"] not in visible_ids:
            characters.append(row)

    characters.sort(
        key=lambda character: (
            not character["owned"],
            -(character.get("level") or 0),
            -int(character.get("unreleased", False)),
            -(
                datetime.fromisoformat(character["release_date"]).toordinal()
                if character.get("unreleased") and character.get("release_date")
                else 0
            ),
            -(character.get("rarity") or 0),
            character["name"].casefold(),
        )
    )
    character_catalogue.sort(key=lambda character: character["name"].casefold())

    return templates.TemplateResponse(
        request=request,
        name="characters.html",
        context={
            "request": request,
            "accounts": accounts,
            "planner_user_id": str(user_id),
            "selected_account": selected_account,
            "characters": characters,
            "character_error": character_error,
            "character_catalogue": character_catalogue,
        },
    )


def _normalise_character_plan(plan: object) -> dict | None:
    """Validate the small user-owned payload stored for a planner card."""

    if not isinstance(plan, dict):
        return None

    try:
        character_id = int(plan.get("id"))
        rarity = max(1, min(5, int(plan.get("rarity", 4))))
        constellation = max(0, min(6, int(plan.get("constellation", 0))))
        level = max(1, min(90, int(plan.get("level", 90))))
        weapon_level = max(
            1,
            min(90, int(plan.get("weaponLevel", 90))),
        )
    except TypeError, ValueError:
        return None

    if character_id <= 0:
        return None

    talents = plan.get("talents")
    if not isinstance(talents, list) or len(talents) != 3:
        talents = [1, 1, 1]

    def optional_int(key: str, minimum: int, maximum: int):
        value = plan.get(key)
        if value is None:
            return None
        try:
            return max(minimum, min(maximum, int(value)))
        except TypeError, ValueError:
            return None

    def bounded_list(values: object, minimum: int, maximum: int):
        if not isinstance(values, list):
            return None

        result = []
        for value in values[:3]:
            try:
                result.append(max(minimum, min(maximum, int(value))))
            except TypeError, ValueError:
                return None
        return result if len(result) == 3 else None

    planned_weapon = None
    if plan.get("plannedWeapon") is not None:
        from website.server.content.weapons import validate_manual_weapon

        try:
            planned_weapon = validate_manual_weapon(
                {
                    **plan["plannedWeapon"],
                    "level": plan["plannedWeapon"].get("level", 1),
                    "refinement": plan["plannedWeapon"].get("refinement", 1),
                }
            )
            ascension = plan["plannedWeapon"].get("ascension")
            if ascension is not None:
                if (
                    isinstance(ascension, bool)
                    or not isinstance(ascension, int)
                    or not 0 <= ascension <= 6
                ):
                    return None
                planned_weapon["ascension"] = ascension
        except AttributeError, TypeError, ValueError:
            return None

    target_talents = bounded_list(talents, 1, 13) or [1, 1, 1]
    current_talents = bounded_list(plan.get("currentTalents"), 1, 15)

    return {
        "id": str(character_id),
        "name": str(plan.get("name") or "Unknown character")[:100],
        "element": str(plan.get("element") or "")[:20],
        "rarity": rarity,
        "icon": str(plan.get("icon") or "")[:1000],
        "notes": str(plan.get("notes") or "")[:2000],
        "constellation": constellation,
        "currentConstellation": optional_int(
            "currentConstellation",
            0,
            6,
        ),
        "level": level,
        "currentLevel": optional_int("currentLevel", 1, 90),
        "talents": target_talents,
        "currentTalents": current_talents,
        "weaponLevel": weapon_level,
        "plannedWeapon": planned_weapon,
        "weaponSource": "manual"
        if plan.get("weaponSource") == "manual" or (planned_weapon and not plan.get("weaponSource"))
        else "hoyolab",
        "currentWeaponName": str(plan.get("currentWeaponName") or "")[:100],
        "currentWeaponIcon": str(plan.get("currentWeaponIcon") or "")[:1000],
        "currentWeaponLevel": optional_int(
            "currentWeaponLevel",
            1,
            90,
        ),
        "currentWeaponRarity": optional_int(
            "currentWeaponRarity",
            1,
            5,
        ),
    }


async def _get_planner_account(user_id: int, account_id: int):
    accounts = await get_accounts(user_id)
    return next(
        (account for account in accounts if int(account["id"]) == account_id),
        None,
    )


@router.get("/api/characters/plans")
async def character_plans_data(
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    """Load database-backed Character Planner entries."""

    session = await get_web_session(cyrene_session)
    if session is None:
        return JSONResponse(status_code=401, content={"error": "Session expired."})
    if account_id is None or await _get_planner_account(session.user_id, account_id) is None:
        return JSONResponse(status_code=404, content={"error": "Account not found."})

    return await get_character_plan_snapshot(session.user_id, account_id)


@router.put("/api/characters/plans")
async def save_character_plans(
    request: Request,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    """Replace database-backed Character Planner entries."""

    session = await get_web_session(cyrene_session)
    if session is None:
        return JSONResponse(status_code=401, content={"error": "Session expired."})
    if account_id is None or await _get_planner_account(session.user_id, account_id) is None:
        return JSONResponse(status_code=404, content={"error": "Account not found."})

    try:
        payload = await request.json()
    except ValueError:
        return JSONResponse(status_code=400, content={"error": "Invalid planner data."})

    submitted = payload.get("plans") if isinstance(payload, dict) else None
    if not isinstance(submitted, list) or len(submitted) > 100:
        return JSONResponse(status_code=400, content={"error": "Invalid planner data."})

    plans = [_normalise_character_plan(plan) for plan in submitted]
    if any(plan is None for plan in plans):
        return JSONResponse(status_code=400, content={"error": "Invalid planner entry."})
    character_ids = [plan["id"] for plan in plans]
    if len(character_ids) != len(set(character_ids)):
        return JSONResponse(status_code=400, content={"error": "Duplicate planner entry."})

    if payload.get("recover_if_missing") is True:
        return await recover_character_plans(session.user_id, account_id, plans)
    await replace_character_plans(session.user_id, account_id, plans)
    return {"saved": len(plans)}


@router.get("/api/characters/{character_id}/showcase")
async def character_showcase_data(
    character_id: int,
    cyrene_session: str | None = Cookie(default=None),
    account_id: int | None = None,
):
    """Retrieve detailed build data for an owned character."""

    session = await get_web_session(cyrene_session)

    if session is None:
        return JSONResponse(
            status_code=401,
            content={"error": "Your session has expired."},
        )

    user_id = session.user_id
    accounts = await get_accounts(user_id)

    if account_id is not None:
        selected_account = next(
            (account for account in accounts if int(account["id"]) == account_id),
            None,
        )

        if selected_account is None:
            return JSONResponse(
                status_code=404,
                content={"error": "Account not found."},
            )
    else:
        selected_account = accounts[0] if accounts else None

    if selected_account is None:
        return JSONResponse(
            status_code=404,
            content={"error": "No linked account found."},
        )

    client = await get_account_client(
        user_id,
        selected_account["genshin_uid"],
    )

    if client is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Unable to load the selected account."},
        )

    try:
        async with client:
            owned_characters = await client.get_genshin_characters()

            if not any(int(character.id) == character_id for character in owned_characters):
                return JSONResponse(
                    status_code=404,
                    content={"error": "This character isn't owned by this account."},
                )

            detailed_characters = await client.get_genshin_detailed_characters(
                characters=[character_id],
            )

        if isinstance(detailed_characters, (list, tuple)):
            character_data = [
                character.model_dump(mode="json") if hasattr(character, "model_dump") else character
                for character in detailed_characters
            ]
        elif hasattr(detailed_characters, "model_dump"):
            character_data = detailed_characters.model_dump(mode="json")
        else:
            character_data = detailed_characters

        return {
            "character_id": character_id,
            "data": character_data,
        }

    except Exception:
        logger.exception(
            "Failed to retrieve showcase data for character %s on account %s",
            character_id,
            selected_account["id"],
        )

        return JSONResponse(
            status_code=502,
            content={"error": "Couldn't retrieve detailed character data."},
        )


@router.get("/api/characters/{character_id}/planner-costs")
async def character_planner_costs(
    character_id: int,
    character_name: str,
    current_level: int,
    target_level: int,
    current_talents: str,
    target_talents: str,
    target_weapon_level: int,
    cyrene_session: str | None = Cookie(default=None),
    weapon_name: str | None = None,
    weapon_rarity: int | None = None,
    current_weapon_level: int | None = None,
    current_ascension: int | None = None,
    weapon_ascension: int | None = None,
):
    """Calculate saved planner goals from the account's current levels."""

    session = await get_web_session(cyrene_session)

    if session is None:
        return JSONResponse(
            status_code=401,
            content={"error": "Your session has expired."},
        )

    try:
        parsed_current_talents = [int(level) for level in current_talents.split(",")]
        parsed_target_talents = [int(level) for level in target_talents.split(",")]
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={"error": "Talent levels must be whole numbers."},
        )

    if not 1 <= current_level <= 90 or not 1 <= target_level <= 90:
        return JSONResponse(
            status_code=400,
            content={"error": "Character levels must be between 1 and 90."},
        )

    if not 1 <= target_weapon_level <= 90:
        return JSONResponse(
            status_code=400,
            content={"error": "Weapon levels must be between 1 and 90."},
        )

    if current_weapon_level is not None and not 1 <= current_weapon_level <= 90:
        return JSONResponse(
            status_code=400,
            content={"error": "Weapon levels must be between 1 and 90."},
        )

    if weapon_rarity is not None and weapon_rarity not in (1, 2, 3, 4, 5):
        return JSONResponse(
            status_code=400,
            content={"error": "Weapon rarity must be between 1 and 5."},
        )

    character_name = character_name.strip()

    if not character_name or len(character_name) > 100:
        return JSONResponse(
            status_code=400,
            content={"error": "A valid character name is required."},
        )

    try:
        costs = await calculate_planner_costs(
            character_name=character_name,
            character_level_name={
                10000005: "Aether",
                10000007: "Lumine",
            }.get(character_id),
            current_level=current_level,
            target_level=target_level,
            current_talents=parsed_current_talents,
            target_talents=parsed_target_talents,
            weapon_name=weapon_name,
            weapon_rarity=weapon_rarity,
            current_weapon_level=current_weapon_level,
            target_weapon_level=target_weapon_level,
            current_ascension=current_ascension,
            weapon_ascension=weapon_ascension,
        )
    except PlannerValidationError as error:
        return JSONResponse(
            status_code=400,
            content={"error": error.public_message},
        )
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={"error": "Couldn't calculate planner costs. Please try again."},
        )

    return {
        "character_id": character_id,
        "costs": costs,
    }
