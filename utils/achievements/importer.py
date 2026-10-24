import asyncio
import json
import selectors
import sys
from pathlib import Path
from dotenv import load_dotenv
from utils.achievements.achievements import load_achievements
from utils.hoyolab.database import (
    initialise_database,
    import_achievement_progress,
)

load_dotenv()


async def import_achievements(
    user_id: int,
    export_file: str | Path,
) -> dict:

    export_path = Path(export_file)

    if not export_path.exists():
        raise FileNotFoundError(
            f"Achievement export not found: {export_path}"
        )

    # --------------------------------
    # Load YaeAchievement export
    # --------------------------------

    with export_path.open(
        "r",
        encoding="utf-8",
    ) as file:
        export_data = json.load(file)

    exported_achievements = export_data.get(
        "list",
        []
    )

    if not isinstance(exported_achievements, list):
        raise ValueError(
            "Invalid achievement export."
        )

    # --------------------------------
    # Load Cyrene achievements
    # --------------------------------

    achievements = load_achievements()

    # --------------------------------
    # Build Genshin ID -> achievement + tier map
    # --------------------------------

    achievement_map = {}

    for achievement in achievements:

        achievement_ids = achievement.get(
            "id",
            []
        )

        stage_count = achievement.get(
            "stages",
            0
        )

        if not isinstance(
            achievement_ids,
            list
        ):
            continue

        if not isinstance(
            stage_count,
            int
        ) or stage_count < 1:
            continue

        for stage_number in range(
            1,
            stage_count + 1
        ):

            if stage_number > len(
                achievement_ids
            ):
                continue

            stage = achievement.get(
                f"stage{stage_number}"
            )

            if not isinstance(
                stage,
                dict
            ):
                continue

            genshin_id = achievement_ids[
                stage_number - 1
            ]

            achievement_map[
                str(genshin_id)
            ] = {
                "achievement_id": str(
                    genshin_id
                ),
                "tier": stage_number,
                "progress": stage.get(
                    "progress"
                ),
            }

    # --------------------------------
    # Import progress
    # --------------------------------

    progress = {}

    matched = 0
    unmatched = 0

    for entry in exported_achievements:

        if not isinstance(entry, dict):
            continue

        genshin_id = entry.get("id")

        if genshin_id is None:
            continue

        genshin_id = str(genshin_id)

        mapping = achievement_map.get(
            genshin_id
        )

        if mapping is None:
            unmatched += 1
            continue

        achievement_id = mapping[
            "achievement_id"
        ]

        tier_number = mapping[
            "tier"
        ]

        if achievement_id not in progress:

            progress[achievement_id] = {
                "tiers": {}
            }

        progress[
            achievement_id
        ][
            "tiers"
        ][
            str(tier_number)
        ] = {
            "completed": entry.get(
                "status"
            ) == 3,
            "current": entry.get(
                "current",
                0
            ),
            "progress": mapping.get(
                "progress"
            ),
            "timestamp": entry.get(
                "timestamp"
            ),
        }

        matched += 1

    # --------------------------------
    # Save to database
    # --------------------------------

    await import_achievement_progress(
        user_id,
        progress,
    )

    return {
        "matched": matched,
        "unmatched": unmatched,
        "total": len(exported_achievements),
    }


if __name__ == "__main__":

    if len(sys.argv) < 2:
        print(
            "Usage: python -m "
            "utils.achievements.importer "
            "<export_file>"
        )
        raise SystemExit(1)

    export_file = Path(
        sys.argv[1]
    )

    async def main():

        await initialise_database()

        result = await import_achievements(
            user_id=1,
            export_file=export_file,
        )

        print(result)

    asyncio.run(
        main(),
        loop_factory=lambda: asyncio.SelectorEventLoop(
            selectors.SelectSelector()
        )
    )