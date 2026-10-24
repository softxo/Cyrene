from collections import defaultdict
from utils.constants.costs import WEAPON_ASCENSION_LEVELS, WEAPON_MAX_LEVELS, WEAPON_EXP_COSTS, WEAPON_ASCENSION_COSTS, WEAPON_ORE_EXP

WEAPON_LEVEL_CAPS = [
    20,
    40,
    50,
    60,
    70,
    80,
    90,
]


def calculate_weapon_exp(
        rarity: int,
        starting_level: int,
        end_level: int,
) -> int:

    if rarity not in WEAPON_EXP_COSTS:
        raise ValueError(f"Invalid weapon rarity: {rarity}")

    max_level = WEAPON_MAX_LEVELS[rarity]

    if starting_level < 1 or end_level > max_level:
        raise ValueError(
            f"{rarity}-star weapons can only be levelled between 1 and {max_level}."
        )

    if starting_level >= end_level:
        return 0

    return sum(
        WEAPON_EXP_COSTS[rarity][level]
        for level in range(starting_level, end_level)
    )


def get_required_weapon_ascension_phases(
        rarity: int,
        starting_level: int,
        end_level: int,
) -> list[int]:

    if rarity not in WEAPON_ASCENSION_COSTS:
        raise ValueError(f"Invalid weapon rarity: {rarity}")

    max_level = WEAPON_MAX_LEVELS[rarity]

    if starting_level < 1 or end_level > max_level:
        raise ValueError(
            f"{rarity}-star weapons can only be levelled "
            f"between 1 and {max_level}."
        )

    if starting_level >= end_level:
        return []

    return [
        phase
        for phase, threshold in enumerate(WEAPON_ASCENSION_LEVELS)
        if starting_level < threshold <= end_level
    ]

def calculate_weapon_ascension_materials(
        rarity: int,
        starting_level: int,
        end_level: int,
) -> dict:

    phases = get_required_weapon_ascension_phases(
        rarity,
        starting_level,
        end_level,
    )

    costs = WEAPON_ASCENSION_COSTS[rarity]

    materials = {
        "weapon_material": defaultdict(int),
        "common": defaultdict(int),
        "elite": defaultdict(int),
        "mora": 0,
    }

    for phase in phases:

        for tier, values in costs["weapon_material"].items():
            if phase < len(values):
                materials["weapon_material"][tier] += values[phase]

        for tier, values in costs["common"].items():
            if phase < len(values):
                materials["common"][tier] += values[phase]

        for tier, values in costs["elite"].items():
            if phase < len(values):
                materials["elite"][tier] += values[phase]

        if phase < len(costs["mora"]):
            materials["mora"] += costs["mora"][phase]

    return materials


def calculate_optimal_weapon_ores(exp_required: int) -> dict:
    """
    Calculate the optimal combination of weapon enhancement ores that provides at least the required EXP while minimising waste.
    """

    if exp_required <= 0:
        return {
            "tier1": 0,
            "tier2": 0,
            "tier3": 0,
            "waste": 0,
        }

    best = None

    max_tier3 = (
        exp_required + WEAPON_ORE_EXP["tier3"] - 1
    ) // WEAPON_ORE_EXP["tier3"]

    for tier3 in range(max_tier3 + 1):

        remaining_after_tier3 = (
            exp_required
            - tier3 * WEAPON_ORE_EXP["tier3"]
        )

        if remaining_after_tier3 <= 0:

            total_exp = (
                tier3 * WEAPON_ORE_EXP["tier3"]
            )

            waste = total_exp - exp_required

            candidate = (
                waste,
                tier3,
                0,
                0,
            )

            if best is None or candidate < best[0]:
                best = (
                    candidate,
                    tier3,
                    0,
                    0,
                    waste,
                )

            continue

        max_tier2 = (
            remaining_after_tier3
            + WEAPON_ORE_EXP["tier2"]
            - 1
        ) // WEAPON_ORE_EXP["tier2"]

        for tier2 in range(max_tier2 + 1):

            remaining = (
                remaining_after_tier3
                - tier2 * WEAPON_ORE_EXP["tier2"]
            )

            tier1 = max(
                0,
                (
                    remaining
                    + WEAPON_ORE_EXP["tier1"]
                    - 1
                ) // WEAPON_ORE_EXP["tier1"]
            )

            total_exp = (
                tier3 * WEAPON_ORE_EXP["tier3"]
                + tier2 * WEAPON_ORE_EXP["tier2"]
                + tier1 * WEAPON_ORE_EXP["tier1"]
            )

            waste = total_exp - exp_required

            candidate = (
                waste,
                tier3 + tier2 + tier1,
                -tier3,
                -tier2,
                tier3,
                tier2,
                tier1,
            )

            if best is None or candidate < best[0]:
                best = (
                    candidate,
                    tier3,
                    tier2,
                    tier1,
                    waste,
                )

    return {
        "tier1": best[3],
        "tier2": best[2],
        "tier3": best[1],
        "waste": best[4],
    }


def calculate_weapon_exp_materials(
        rarity: int,
        starting_level: int,
        end_level: int,
) -> dict:

    if rarity not in WEAPON_MAX_LEVELS:
        raise ValueError(f"Invalid weapon rarity: {rarity}")

    max_level = WEAPON_MAX_LEVELS[rarity]

    if starting_level < 1 or end_level > max_level:
        raise ValueError(
            f"{rarity}-star weapons can only be levelled between 1 and {max_level}."
        )

    if starting_level >= end_level:
        return {
            "required": 0,
            "wasted": 0,
            "ores": {
                "tier1": 0,
                "tier2": 0,
                "tier3": 0,
            },
        }

    total = {
        "required": 0,
        "wasted": 0,
        "ores": {
            "tier1": 0,
            "tier2": 0,
            "tier3": 0,
        },
    }

    current_level = starting_level

    while current_level < end_level:

        next_cap = next(
            cap
            for cap in WEAPON_LEVEL_CAPS
            if cap > current_level
        )

        segment_end = min(
            next_cap,
            end_level
        )

        exp_required = calculate_weapon_exp(
            rarity,
            current_level,
            segment_end,
        )

        ores = calculate_optimal_weapon_ores(
            exp_required
        )

        total["required"] += exp_required

        total["ores"]["tier1"] += ores["tier1"]
        total["ores"]["tier2"] += ores["tier2"]
        total["ores"]["tier3"] += ores["tier3"]

        if segment_end == next_cap:
            total["wasted"] += ores["waste"]

        current_level = segment_end

    return total


def calculate_weapon_levelling_mora(
        ores: dict,
) -> int:

    exp_supplied = (
        ores["tier1"] * WEAPON_ORE_EXP["tier1"]
        + ores["tier2"] * WEAPON_ORE_EXP["tier2"]
        + ores["tier3"] * WEAPON_ORE_EXP["tier3"]
    )

    return exp_supplied // 10


def calculate_weapon_resources(
        weapon_data: dict,
        starting_level: int,
        end_level: int,
) -> dict:

    rarity = weapon_data["rarity"]

    ascension = calculate_weapon_ascension_materials(
        rarity,
        starting_level,
        end_level,
    )

    exp = calculate_weapon_exp_materials(
        rarity,
        starting_level,
        end_level,
    )

    levelling_mora = calculate_weapon_levelling_mora(
        exp["ores"]
    )

    weapon_materials = weapon_data["materials"]["ascension"]

    return {
        "levels": {
            "starting": starting_level,
            "ending": end_level,
        },

        "exp": {
            "required": exp["required"],
            "wasted": exp["wasted"],
            "ores": {
                "tier1": exp["ores"]["tier1"],
                "tier2": exp["ores"]["tier2"],
                "tier3": exp["ores"]["tier3"],
            },
        },

        "ascension": {
            "weapon_material": {
                "id": weapon_materials["weapon_material"]["id"],
                **ascension["weapon_material"],
            },

            "common": {
                "id": weapon_materials["common"]["id"],
                **ascension["common"],
            },

            "elite": {
                "id": weapon_materials["elite"]["id"],
                **ascension["elite"],
            },

            "mora": ascension["mora"],
        },

        "mora": {
            "levelling": levelling_mora,
            "ascension": ascension["mora"],
            "total": (
                levelling_mora
                + ascension["mora"]
            ),
        },
    }
