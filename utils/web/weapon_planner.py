"""Independent weapon level and refinement goals."""

import asyncio
import json
from collections import OrderedDict
from pathlib import Path

import aiohttp

from utils.genshin_db import GenshinDB, GenshinDBError
from utils.web.planner_costs import _add, _result, _weapon_cost
from utils.web.weapons import validate_manual_weapon, weapon_tag


def normalise_weapon_plan(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid weapon plan.")
    weapon = validate_manual_weapon(payload.get("weapon"))
    key = payload.get("key")
    if not isinstance(key, str) or not 1 <= len(key) <= 80:
        raise ValueError("Invalid plan identifier.")
    result = {"key": key, "weapon": weapon}
    if "source" in payload:
        if payload["source"] not in ("hoyolab", "imported", "manual", "unowned"):
            raise ValueError("Invalid weapon source.")
        result["source"] = payload["source"]
    if "equippedCharacter" in payload:
        character = payload["equippedCharacter"]
        if not isinstance(character, str) or len(character) > 80:
            raise ValueError("Invalid equipped character.")
        result["equippedCharacter"] = character
    for field, minimum, maximum in (
        ("currentLevel", 1, 70 if weapon["rarity"] <= 2 else 90),
        ("targetLevel", 1, 70 if weapon["rarity"] <= 2 else 90),
        ("currentRefinement", 1, 5),
        ("targetRefinement", 1, 5),
    ):
        value = payload.get(field)
        if type(value) is not int or not minimum <= value <= maximum:
            raise ValueError("Choose valid weapon levels and refinements.")
        result[field] = value
    if (
        result["targetLevel"] < result["currentLevel"]
        or result["targetRefinement"] < result["currentRefinement"]
    ):
        raise ValueError("Goals cannot be lower than current progression.")
    phase = payload.get("ascension")
    if phase is not None and (type(phase) is not int or not 0 <= phase <= 6):
        raise ValueError("Invalid ascension phase.")
    result["ascension"] = phase
    if (weapon["rarity"] <= 2 or weapon["id"] in (11416, 15415)) and (
        result["currentRefinement"] != 1 or result["targetRefinement"] != 1
    ):
        raise ValueError("This weapon cannot be refined.")
    return result


async def refinement_cost(db, weapon, start, end):
    data = await db.get("weapons", weapon["name"])
    if int(data.get("id", 0)) != weapon["id"]:
        raise GenshinDBError("Exact weapon data is unavailable.")
    if not data.get("r2") and not data.get("preview"):
        return {"status": "complete", "items": [], "message": "This weapon cannot be refined."}
    if start >= end:
        return {"status": "complete", "items": []}
    path = Path(__file__).resolve().parents[2] / "data" / "weapon_refinement_materials.json"
    material = json.loads(path.read_text(encoding="utf-8"))["weapons"].get(str(weapon["id"]))
    if not material and weapon_tag(weapon["id"])["source"] in ("Event", "Fishing Association"):
        return {
            "status": "unavailable",
            "items": [],
            "message": "This weapon's special refinement material is not available yet.",
        }
    if material:
        ingredient = {**material, "amount": end - start, "rarity": 4, "inventory_unavailable": True}
    else:
        # A weapon ID is deliberately namespaced: it is not an inventory material ID.
        ingredient = {
            "id": f"weapon:{weapon['id']}",
            "name": f"{weapon['name']} (R1 copy)",
            "amount": end - start,
            "icon": weapon["icon"],
            "rarity": weapon["rarity"],
            "inventory_unavailable": True,
        }
    # Each step consumes one R1 copy or one special refinement material.
    base = {3: 500, 4: 1000, 5: 2000}[int(data["rarity"])]
    items = OrderedDict()
    _add(items, 202, "Mora", sum(base * 2 ** (rank - 1) for rank in range(start, end)))
    result = await _result(db, items)
    result["items"].append(ingredient)
    if data.get("preview"):
        result["preview"] = True
    return result


async def calculate_weapon_plan(plan):
    async def available(coroutine):
        try:
            return await coroutine
        except GenshinDBError, aiohttp.ClientError, asyncio.TimeoutError:
            return {
                "status": "unavailable",
                "items": [],
                "message": "Couldn't load exact weapon materials. Please retry.",
            }

    async with aiohttp.ClientSession() as session:
        db = GenshinDB(session)
        level, refinements = await asyncio.gather(
            available(
                _weapon_cost(
                    db,
                    plan["weapon"]["name"],
                    plan["currentLevel"],
                    plan["targetLevel"],
                    plan["ascension"],
                )
            ),
            available(
                refinement_cost(
                    db, plan["weapon"], plan["currentRefinement"], plan["targetRefinement"]
                )
            ),
        )
    return {"level": level, "refinements": refinements}
