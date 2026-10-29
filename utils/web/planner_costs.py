"""GenshinDB upgrade costs and material metadata for the Planner.

The public API does not supply levelling EXP tables, so only the generic
EXP helpers are retained. No local character or material catalogue is read.
"""

import asyncio
import logging
import math
import time
from collections import OrderedDict

import aiohttp

from utils.constants.costs import WEAPON_ORE_EXP
from utils.genshin_db import GenshinDB, GenshinDBError
from utils.resource_calculator.character_resource_calculator import calculate_character_exp_books
from utils.resource_calculator.weapon_resource_calculator import (
    calculate_weapon_exp_materials,
    calculate_weapon_levelling_mora,
)

logger = logging.getLogger(__name__)


class PlannerValidationError(ValueError):
    """A controlled validation failure, separate from provider exceptions."""

    MESSAGES = {
        "talent_count": "Exactly three talent levels are required.",
        "current_talents": "Current talent levels must be between 1 and 15.",
        "target_talents": "Target talent levels must be between 1 and 10.",
        "levels": "Levels must be between 1 and 90.",
        "weapon_level": "Weapon levels must be between 1 and 90.",
        "ascension": "Ascension phases must be between 0 and 6.",
    }

    def __init__(self, code: str):
        self.code = code
        super().__init__(self.public_message)

    @property
    def public_message(self) -> str:
        return self.MESSAGES.get(self.code, "Invalid planner goals.")

ASCENSION_LEVELS = (20, 40, 50, 60, 70, 80)
BOOKS = (
    (104003, "Hero's Wit", "heros_wit", 20000),
    (104002, "Adventurer's Experience", "adventurers_experience", 5000),
    (104001, "Wanderer's Advice", "wanderers_advice", 1000),
)
ORES = (
    (104013, "Mystic Enhancement Ore", "tier3"),
    (104012, "Fine Enhancement Ore", "tier2"),
    (104011, "Enhancement Ore", "tier1"),
)


def _add(items: dict, material_id: int, name: str, count: int):
    if count <= 0:
        return
    if material_id not in items:
        items[material_id] = {"id": material_id, "name": name, "amount": 0}
    items[material_id]["amount"] += count


def _add_step(items: dict, costs: dict, key: str):
    step = costs.get(key)
    if not isinstance(step, list):
        raise GenshinDBError("Costs for this upgrade are unavailable.")
    for material in step:
        _add(items, material["id"], material["name"], material["count"])


def _ascensions(items: dict, data: dict, start: int, end: int, phase: int | None):
    # At a cap, assume unascended unless the account supplies its actual
    # phase. Reaching a cap does not itself require the next ascension.
    for index, level in enumerate(ASCENSION_LEVELS, start=1):
        if start <= level < end and (phase is None or index > phase):
            _add_step(items, data.get("costs", {}), f"ascend{index}")


def _get_level_categories(data: dict) -> dict[int, int]:
    """Classify character ascension materials using GenshinDB costs."""

    categories = {}

    costs = data.get("costs", {})

    for index in range(1, 7):
        step = costs.get(f"ascend{index}", [])

        if not isinstance(step, list):
            continue

        # Standard first ascension:
        # Mora, stone, local speciality, common drop.
        if index == 1 and len(step) == 4:
            positions = {
                1: 2,  # Ascension stone
                2: 4,  # Local speciality
                3: 5,  # Common drop
            }

        # Standard later ascensions:
        # Mora, stone, boss, local speciality, common drop.
        elif index > 1 and len(step) == 5:
            positions = {
                1: 2,  # Ascension stone
                2: 3,  # Boss material
                3: 4,  # Local speciality
                4: 5,  # Common drop
            }

        else:
            continue

        for position, category in positions.items():
            material = step[position]

            material_id = int(material["id"])

            categories[material_id] = category

    return categories


def _get_upgrade_categories(
    costs: dict,
    prefix: str,
    positions: dict[int, int],
    start: int,
    end: int,
) -> dict[int, int]:
    """Classify upgrade materials using their cost-list positions."""

    categories = {}

    for index in range(start, end + 1):
        step = costs.get(f"{prefix}{index}", [])

        if not isinstance(step, list):
            continue

        for position, category in positions.items():
            if position >= len(step):
                continue

            material = step[position]

            if not isinstance(material, dict):
                continue

            categories[int(material["id"])] = category

    return categories


def _crafting_chains(groups: list[list[dict]]) -> dict[int, list[dict]]:
    """Map each craftable material to the lower tiers in its family."""

    chains = {}

    for group in groups:
        ordered = []
        seen = set()

        for material in group:
            material_id = int(material["id"])
            if material_id in seen:
                continue
            seen.add(material_id)
            ordered.append({
                "id": material_id,
                "name": material.get("name") or "Lower-tier material",
            })

        for index, material in enumerate(ordered[1:], start=1):
            chains[material["id"]] = ordered[:index]

    return chains


def _get_level_crafting_chains(data: dict) -> dict[int, list[int]]:
    costs = data.get("costs", {})
    stones = []
    common_drops = []

    for index in range(1, 7):
        step = costs.get(f"ascend{index}", [])
        if not isinstance(step, list):
            continue

        if len(step) == 4:
            positions = (1, 3)
        elif len(step) == 5:
            positions = (1, 4)
        else:
            continue

        stones.append(step[positions[0]])
        common_drops.append(step[positions[1]])

    return _crafting_chains([stones, common_drops])


def _get_upgrade_crafting_chains(
    costs: dict,
    prefix: str,
    positions: tuple[int, ...],
    start: int,
    end: int,
) -> dict[int, list[int]]:
    groups = {position: [] for position in positions}

    for index in range(start, end + 1):
        step = costs.get(f"{prefix}{index}", [])
        if not isinstance(step, list):
            continue

        for position in positions:
            if position < len(step) and isinstance(step[position], dict):
                groups[position].append(step[position])

    return _crafting_chains(list(groups.values()))


async def _result(
    db: GenshinDB,
    items: dict,
    category: str = "generic",
    level_categories: dict[int, int] | None = None,
    upgrade_categories: dict[int, int] | None = None,
    crafting_chains: dict[int, list[dict]] | None = None,
) -> dict:
    if not items:
        return {"status": "complete", "items": []}

    async def decorate(item):
        material = await db.get("materials", item["name"])

        if material.get("id") != item["id"]:
            raise GenshinDBError(
                "The material lookup returned an unexpected item."
            )

        images = material.get("images") or {}
        filename = images.get("filename_icon")

        icon = (
            f"https://static.nanoka.cc/assets/gi/{filename}.webp"
            if filename
            else None
        )

        decorated_item = {
            **item,
            "name": material["name"],
            "rarity": material.get("rarity", 1),
            "icon": icon,
        }

        lower_tiers = (crafting_chains or {}).get(int(item["id"]))
        if lower_tiers:
            decorated_item["crafting_lower"] = lower_tiers

        return decorated_item

    decorated = await asyncio.gather(
        *(decorate(item) for item in items.values())
    )

    if category == "level":
        exp_ids = {104001, 104002, 104003}

        level_categories = level_categories or {}

        def sort_key(item):
            material_id = int(item["id"])
            rarity = int(item.get("rarity") or 1)

            # 0 — Mora
            if material_id == 202:
                return (0, 0, 0)

            # 1 — Character EXP books
            if material_id in exp_ids:
                return (1, -rarity, -material_id)

            # 2 — Ascension stones
            # 3 — Boss materials
            # 4 — Local specialities
            # 5 — Common enemy drops
            material_category = level_categories.get(
                material_id,
                6,
            )

            return (
                material_category,
                -rarity,
                material_id,
            )

        decorated.sort(key=sort_key)
        
    elif category in {"talents", "weapon"}:
        upgrade_categories = upgrade_categories or {}

        exp_ids = {104011, 104012, 104013}

        def sort_key(item):
            material_id = int(item["id"])
            rarity = int(item.get("rarity") or 1)

            if material_id == 202:
                return (0, 0, 0)

            if category == "weapon" and material_id in exp_ids:
                return (1, -rarity, -material_id)

            material_category = upgrade_categories.get(
                material_id,
                6,
            )

            return (
                material_category,
                -rarity,
                material_id,
            )

        decorated.sort(key=sort_key)

    return {"status": "ok", "items": decorated}


async def _level_cost(db, name, start, end, phase):
    if start >= end:
        return {"status": "complete", "items": []}
    data = await db.get("characters", name)
    items = OrderedDict()
    books = calculate_character_exp_books(start, end)
    supplied_exp = sum(books[key] * value for _, _, key, value in BOOKS)
    _add(items, BOOKS[0][0], BOOKS[0][1], math.ceil(supplied_exp / BOOKS[0][3]))
    _add(items, 202, "Mora", supplied_exp // 5)
    _ascensions(items, data, start, end, phase)

    level_categories = _get_level_categories(data)

    return await _result(
        db,
        items,
        category="level",
        level_categories=level_categories,
        crafting_chains=_get_level_crafting_chains(data),
    )
    
    
async def _talent_cost(db, name, starts, ends):
    if all(
        start >= end
        for start, end in zip(starts, ends)
    ):
        return {"status": "complete", "items": []}

    data = await db.get("talents", name)

    items = OrderedDict()
    categories = {}
    crafting_chains = {}

    for index, (start, end) in enumerate(
        zip(starts, ends),
        start=1,
    ):
        costs = data.get(
            f"combat{index}", {}
        ).get("costs", data.get("costs", {}))

        categories.update(
            _get_upgrade_categories(
                costs,
                prefix="lvl",
                positions={
                    1: 1,  # Talent books
                    2: 2,  # Common materials
                    3: 3,  # Weekly boss drops
                    4: 4,  # Crown of Insight
                },
                start=2,
                end=10,
            )
        )
        crafting_chains.update(
            _get_upgrade_crafting_chains(
                costs,
                prefix="lvl",
                positions=(1, 2),
                start=2,
                end=10,
            )
        )

        for level in range(start + 1, end + 1):
            _add_step(items, costs, f"lvl{level}")

    return await _result(
        db,
        items,
        category="talents",
        upgrade_categories=categories,
        crafting_chains=crafting_chains,
    )


async def _weapon_cost(db, name, start, end, phase):
    if start is None or not name:
        return {"status": "unavailable", "items": [],
                "message": "Equipped weapon progression is unavailable."}
    data = await db.get("weapons", name)
    rarity = int(data["rarity"])
    maximum = 70 if rarity < 3 else 90
    if start > maximum or end > maximum:
        return {"status": "invalid", "items": [],
                "message": f"This weapon can only reach level {maximum}."}
    if start >= end:
        return {"status": "complete", "items": []}
    items = OrderedDict()
    exp = calculate_weapon_exp_materials(rarity, start, end)
    _add(
        items,
        ORES[0][0],
        ORES[0][1],
        math.ceil(exp["required"] / WEAPON_ORE_EXP["tier3"]),
    )
    _add(items, 202, "Mora", calculate_weapon_levelling_mora(exp["ores"]))
    _ascensions(items, data, start, end, phase)

    categories = _get_upgrade_categories(
        data.get("costs", {}),
        prefix="ascend",
        positions={
            1: 2,  # Weapon ascension materials
            2: 3,  # Common enemy drops
            3: 3,  # Additional enemy drops
        },
        start=1,
        end=6,
    )

    return await _result(
        db,
        items,
        category="weapon",
        upgrade_categories=categories,
        crafting_chains=_get_upgrade_crafting_chains(
            data.get("costs", {}),
            prefix="ascend",
            positions=(1, 2, 3),
            start=1,
            end=6,
        ),
    )

async def calculate_planner_costs(
    character_name: str,
    current_level: int,
    target_level: int,
    current_talents: list[int],
    target_talents: list[int],
    weapon_name: str | None,
    weapon_rarity: int | None,
    current_weapon_level: int | None,
    target_weapon_level: int,
    current_ascension: int | None = None,
    weapon_ascension: int | None = None,
    character_level_name: str | None = None,
) -> dict:
    if len(current_talents) != 3 or len(target_talents) != 3:
        raise PlannerValidationError("talent_count")
    if any(not 1 <= level <= 15 for level in current_talents):
        raise PlannerValidationError("current_talents")
    if any(not 1 <= level <= 10 for level in target_talents):
        raise PlannerValidationError("target_talents")
    if any(not 1 <= level <= 90 for level in (current_level, target_level, target_weapon_level)):
        raise PlannerValidationError("levels")
    if current_weapon_level is not None and not 1 <= current_weapon_level <= 90:
        raise PlannerValidationError("weapon_level")
    for phase in (current_ascension, weapon_ascension):
        if phase is not None and not 0 <= phase <= 6:
            raise PlannerValidationError("ascension")

    async def available(coroutine):
        try:
            return await coroutine
        except GenshinDBError:
            return {"status": "unavailable", "items": [],
                    "message": "Couldn't load material data. Please try again."}

    async with aiohttp.ClientSession() as session:
        db = GenshinDB(session)

        async def timed_cost(label, coroutine):
            section_started = time.perf_counter()

            result = await available(coroutine)

            elapsed = time.perf_counter() - section_started

            logger.info(
                "Planner Goal Cost [%s]: %.3fs",
                label,
                elapsed,
            )

            return result

        costs = await asyncio.gather(
            timed_cost(
                "Character Level",
                _level_cost(
                    db,
                    character_level_name or character_name,
                    current_level,
                    target_level,
                    current_ascension,
                ),
            ),
            timed_cost(
                "Talents",
                _talent_cost(
                    db,
                    character_name,
                    current_talents,
                    target_talents,
                ),
            ),
            timed_cost(
                "Weapon",
                _weapon_cost(
                    db,
                    weapon_name,
                    current_weapon_level,
                    target_weapon_level,
                    weapon_ascension,
                ),
            ),
        )

    return dict(zip(("level", "talents", "weapon"), costs))
