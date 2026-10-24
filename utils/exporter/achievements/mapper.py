from __future__ import annotations
from utils.achievements.achievements import (
    load_achievements,
)


class AchievementMapper:
    """
    Maps Genshin achievement IDs to Cyrene
    achievement IDs and tiers.
    """

    def __init__(self):
        self._map: dict[int, dict] = {}

        self._build_map()

    def _build_map(self) -> None:
        achievements = load_achievements()

        for achievement in achievements:

            achievement_id = achievement.get(
                "id"
            )

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

                self._map[
                    genshin_id
                ] = {
                    "achievement_id":
                        achievement_id,

                    "tier":
                        tier.get("tier"),
                }

    def get(
        self,
        genshin_id: int,
    ) -> dict | None:

        return self._map.get(
            genshin_id
        )

    def __contains__(
        self,
        genshin_id: int,
    ) -> bool:

        return genshin_id in self._map

    def __len__(self) -> int:

        return len(self._map)


if __name__ == "__main__":

    mapper = AchievementMapper()

    print(
        f"Mapped Genshin IDs: {len(mapper)}"
    )