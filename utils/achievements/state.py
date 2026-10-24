from utils.achievements.achievements import load_achievements
from utils.achievements.progress import load_progress


async def load_achievement_state(
    user_id: int,
) -> list[dict]:

    achievements = load_achievements()

    progress = await load_progress(
        user_id
    )

    state = []

    for achievement in achievements:

        achievement_id = achievement["id"]

        saved_progress = progress.get(
            achievement_id,
            {}
        )

        saved_tiers = saved_progress.get(
            "tiers",
            {}
        )

        tiers = []

        for tier in achievement.get(
            "tiers",
            []
        ):

            tier_number = str(
                tier["tier"]
            )

            saved = saved_tiers.get(
                tier_number,
                {}
            )

            tiers.append({
                **tier,

                "completed":
                    saved.get(
                        "completed",
                        False
                    ),

                "current":
                    saved.get(
                        "current",
                        0
                    ),

                "timestamp":
                    saved.get(
                        "timestamp"
                    ),

                "note":
                    saved.get(
                        "note"
                    ),
            })

        state.append({
            **achievement,
            "tiers": tiers,
        })

    return state