from __future__ import annotations

from utils.exporter.achievements.mapper import (
    AchievementMapper,
)
from utils.exporter.protocol import (
    AchievementSnapshot,
)


class AchievementParser:
    """
    Converts achievement data into the exporter's
    normalized achievement format.
    """

    def __init__(
        self,
        mapper: AchievementMapper | None = None,
    ):
        self.mapper = (
            mapper
            if mapper is not None
            else AchievementMapper()
        )

    def parse(
        self,
        achievements: list[dict],
    ) -> list[AchievementSnapshot]:

        snapshots = []

        for achievement in achievements:

            genshin_ids = achievement.get(
                "genshin_ids",
                []
            )

            tiers = achievement.get(
                "tiers",
                []
            )

            if not isinstance(
                genshin_ids,
                list,
            ):
                continue

            if not isinstance(
                tiers,
                list,
            ):
                continue

            for index, genshin_id in enumerate(
                genshin_ids
            ):

                if index >= len(tiers):
                    break

                tier = tiers[index]

                if not isinstance(
                    tier,
                    dict,
                ):
                    continue

                try:
                    genshin_id = int(
                        genshin_id
                    )

                except (
                    TypeError,
                    ValueError,
                ):
                    continue

                if genshin_id not in self.mapper:
                    continue

                snapshots.append(
                    AchievementSnapshot(
                        genshin_id=genshin_id,
                        status=0,
                        current=0,
                        total=tier.get(
                            "progress"
                        ),
                        timestamp=None,
                        raw_fields={},
                    )
                )

        return snapshots