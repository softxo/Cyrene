from utils.hoyolab.database import get_achievement_progress


async def load_progress(
    user_id: int,
) -> dict:

    rows = await get_achievement_progress(
        user_id
    )

    progress = {}

    for row in rows:

        achievement_id = row["achievement_id"]
        tier = str(row["tier"])

        if achievement_id not in progress:
            progress[achievement_id] = {
                "tiers": {}
            }

        timestamp = None

        if row["completed_at"] is not None:
            timestamp = int(
                row["completed_at"].timestamp()
            )

        progress[achievement_id]["tiers"][tier] = {
            "completed": row["completed"],
            "current": row["current"],
            "timestamp": timestamp,
            "note": row["note"],
        }

    return progress