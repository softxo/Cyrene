from collections import defaultdict

from utils.constants.costs import TALENT_MORA_COSTS


TALENT_BOOK_COSTS = {
    "teachings": [3, 0, 0, 0, 0, 0, 0, 0, 0],
    "guide": [0, 2, 4, 6, 9, 0, 0, 0, 0],
    "philosophies": [0, 0, 0, 0, 0, 4, 6, 12, 16],
}

TALENT_COMMON_COSTS = {
    "tier1": [6, 0, 0, 0, 0, 0, 0, 0, 0],
    "tier2": [0, 3, 4, 6, 9, 0, 0, 0, 0],
    "tier3": [0, 0, 0, 0, 0, 4, 6, 9, 12],
}

TALENT_WEEKLY_COSTS = [0, 0, 0, 0, 0, 1, 1, 2, 2]
TALENT_CROWN_COSTS = [0, 0, 0, 0, 0, 0, 0, 0, 1]


def calculate_talent_resources(
    character_data: dict,
    starting_levels: list[int],
    end_levels: list[int],
) -> dict:
    """Calculate the combined cost of levelling up to three talents."""

    if len(starting_levels) != 3 or len(end_levels) != 3:
        raise ValueError("Exactly three talent levels are required.")

    books = defaultdict(int)
    common = defaultdict(int)
    weekly = 0
    crowns = 0
    mora = 0

    for starting_level, end_level in zip(starting_levels, end_levels):
        if not 1 <= starting_level <= 10 or not 1 <= end_level <= 10:
            raise ValueError("Talent levels must be between 1 and 10.")

        if starting_level >= end_level:
            continue

        for transition in range(starting_level - 1, end_level - 1):
            for tier, costs in TALENT_BOOK_COSTS.items():
                books[tier] += costs[transition]

            for tier, costs in TALENT_COMMON_COSTS.items():
                common[tier] += costs[transition]

            weekly += TALENT_WEEKLY_COSTS[transition]
            crowns += TALENT_CROWN_COSTS[transition]
            mora += TALENT_MORA_COSTS[transition]

    talent_materials = character_data["materials"]["talents"]

    return {
        "levels": {
            "starting": starting_levels,
            "ending": end_levels,
        },
        "book": {
            "id": talent_materials["book"]["id"],
            **books,
        },
        "common": {
            "id": talent_materials["common"]["id"],
            **common,
        },
        "weekly_boss": {
            "id": talent_materials["weekly_boss"]["id"],
            "material": talent_materials["weekly_boss"]["material"],
            "amount": weekly,
        },
        "crown": crowns,
        "mora": mora,
    }
