from utils.constants.costs import CHARACTER_EXP_COSTS, ASCENSION_GEM_COSTS, ASCENSION_BOSS_COSTS, ASCENSION_LOCAL_COSTS, ASCENSION_COMMON_COSTS, ASCENSION_MORA_COSTS
from collections import defaultdict

ASCENSION_LEVELS = [20, 40, 50, 60, 70, 80]

EXP_BOOK_VALUES = {
    "heros_wit": 20_000,
    "adventurers_experience": 5_000,
    "wanderers_advice": 1_000,
}

ASCENSION_CAPS = [20, 40, 50, 60, 70, 80, 90]


def calculate_character_exp(starting_level: int, end_level: int) -> int:
    if starting_level < 1 or end_level > 90:
        raise ValueError("Character levels must be between 1 and 90.")

    if starting_level >= end_level:
        return 0

    return sum(
        CHARACTER_EXP_COSTS[level]
        for level in range(starting_level, end_level)
    )

def get_required_ascension_phases(
        starting_level: int,
        end_level: int,
) -> list[int]:

    if starting_level < 1 or end_level > 90:
        raise ValueError("Character levels must be between 1 and 90.")

    if starting_level >= end_level:
        return []

    return [
        index
        for index, threshold in enumerate(ASCENSION_LEVELS)
        if starting_level <= threshold < end_level
    ]

def calculate_ascension_materials(
        starting_level: int,
        end_level: int,
) -> dict:

    phases = get_required_ascension_phases(starting_level, end_level)

    materials = {
        "gem": defaultdict(int),
        "boss": 0,
        "local_specialty": 0,
        "common": defaultdict(int),
        "mora": 0
    }

    for phase in phases:
        for tier, costs in ASCENSION_GEM_COSTS.items():
            materials["gem"][tier] += costs[phase]

        materials["boss"] += ASCENSION_BOSS_COSTS[phase]
        materials["local_specialty"] += ASCENSION_LOCAL_COSTS[phase]

        for tier, costs in ASCENSION_COMMON_COSTS.items():
            materials["common"][tier] += costs[phase]

        materials["mora"] += ASCENSION_MORA_COSTS[phase]

    return materials

def calculate_optimal_exp_books(exp_required: int) -> dict:
    """
    Calculate the EXP books needed to provide at least the required EXP while minimising wasted EXP
    """

    best = None

    max_heroes = (exp_required + 19_999) // 20_000

    for heros_wit in range(max_heroes + 1):
        remaining_after_heroes = exp_required - (
            heros_wit * EXP_BOOK_VALUES["heros_wit"]
        )

        if remaining_after_heroes <= 0:
            adventurers_experience = 0
            wanderers_advice = 0
        else:
            max_adventurers = (remaining_after_heroes + 4_999) // 5_000

            for adventurers_experience in range(max_adventurers + 1):
                remaining = remaining_after_heroes - (
                    adventurers_experience * EXP_BOOK_VALUES["adventurers_experience"]
                )

                wanderers_advice = max(
                    0,
                    (remaining + 999) // 1_000
                )

                total_exp = (
                    heros_wit * 20_000
                    + adventurers_experience * 5_000
                    + wanderers_advice * 1_000
                )

                waste = total_exp - exp_required

                candidate = (
                    waste,
                    heros_wit + adventurers_experience + wanderers_advice,
                    -heros_wit,
                    -adventurers_experience,
                    heros_wit,
                    adventurers_experience,
                    wanderers_advice,
                )

                if best is None or candidate < best[0]:
                    best = (
                        candidate,
                        heros_wit,
                        adventurers_experience,
                        wanderers_advice,
                        waste
                    )

            continue

        total_exp = heros_wit * 20_000
        waste = total_exp - exp_required

        candidate = (
            waste,
            heros_wit,
            -heros_wit,
            0,
            heros_wit,
            0,
            0
        )

        if best is None or candidate < best[0]:
            best = (
                candidate,
                heros_wit,
                0,
                0,
                waste
            )

    return {
        "heros_wit": best[1],
        "adventurers_experience": best[2],
        "wanderers_advice": best[3],
        "waste": best[4]
    }

def calculate_character_exp_books(
        starting_level: int,
        end_level: int,
) -> dict:

    if starting_level < 1 or end_level > 90:
        raise ValueError("Character levels must be between 1 and 90.")

    if starting_level >= end_level:
        return {
            "heros_wit": 0,
            "adventurers_experience": 0,
            "wanderers_advice": 0,
            "waste": 0
        }

    total = {
        "heros_wit": 0,
        "adventurers_experience": 0,
        "wanderers_advice": 0,
        "waste": 0
    }

    current_level = starting_level

    while current_level < end_level:
        next_cap = next(
            cap for cap in ASCENSION_CAPS
            if cap > current_level
        )

        segment_end = min(next_cap, end_level)

        exp_required = calculate_character_exp(
            current_level,
            segment_end,
        )

        books = calculate_optimal_exp_books(exp_required)

        total["heros_wit"] += books["heros_wit"]
        total["adventurers_experience"] += books["adventurers_experience"]
        total["wanderers_advice"] += books["wanderers_advice"]
        total["waste"] += books["waste"]

        current_level = segment_end

    return total

def calculate_levelling_mora(
        starting_level: int,
        end_level: int,
) -> int:

    books = calculate_character_exp_books(starting_level, end_level)

    exp_supplied = (
        books["heros_wit"] * 20_000
        + books["adventurers_experience"] * 5_000
        + books["wanderers_advice"] * 1_000
    )

    return exp_supplied // 5

def calculate_character_resources(
        character_data: dict,
        starting_level: int,
        end_level: int,
) -> dict:

    ascension = calculate_ascension_materials(starting_level, end_level)

    books = calculate_character_exp_books(starting_level, end_level)

    exp_required = calculate_character_exp(starting_level, end_level)

    levelling_mora = calculate_levelling_mora(starting_level, end_level)

    character_materials = character_data["materials"]["ascension"]

    return {
        "levels": {
            "starting": starting_level,
            "ending": end_level
        },

        "exp": {
            "required": exp_required,
            "wasted": books["waste"],
            "books": {
                "heros_wit": books["heros_wit"],
                "adventurers_experience": books["adventurers_experience"],
                "wanderers_advice": books["wanderers_advice"],
            }
        },

        "ascension": {
            "gem": {
                "id": character_materials["gem"]["id"],
                **ascension["gem"]
            },

            "boss": {
                "id": character_materials["boss"]["id"],
                "amount": ascension["boss"]
            },

            "local_specialty": {
                "id": character_materials["local_specialty"]["id"],
                "amount": ascension["local_specialty"]
            },

            "common": {
                "id": character_materials["common"]["id"],
                **ascension["common"]
            },

            "mora": ascension["mora"]
        },

        "mora": {
            "levelling": levelling_mora,
            "ascension": ascension["mora"],
            "total": levelling_mora + ascension["mora"]
        }
    }
