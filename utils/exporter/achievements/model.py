from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AchievementTier:
    tier: int
    description: str

    primogems: int = 0

    progress: Optional[int] = None
    current: int = 0

    completed: bool = False

    timestamp: Optional[str] = None
    note: Optional[str] = None


@dataclass
class Achievement:
    id: str
    name: str
    category: str

    tiers: list[AchievementTier] = field(
        default_factory=list
    )

    version: Optional[str] = None
    hidden: bool = False

    genshin_ids: list[str] = field(
        default_factory=list
    )

    @classmethod
    def from_dict(
        cls,
        data: dict,
    ) -> "Achievement":

        tiers = []

        for tier_data in data.get(
            "tiers",
            []
        ):

            tiers.append(
                AchievementTier(
                    tier=tier_data.get(
                        "tier",
                        1
                    ),

                    description=tier_data.get(
                        "description",
                        ""
                    ),

                    primogems=tier_data.get(
                        "primogems",
                        0
                    ),

                    progress=tier_data.get(
                        "progress"
                    ),

                    current=tier_data.get(
                        "current",
                        0
                    ),

                    completed=tier_data.get(
                        "completed",
                        False
                    ),

                    timestamp=tier_data.get(
                        "timestamp"
                    ),

                    note=tier_data.get(
                        "note"
                    ),
                )
            )


        return cls(
            id=data.get(
                "id",
                ""
            ),

            name=data.get(
                "name",
                ""
            ),

            category=data.get(
                "category",
                ""
            ),

            tiers=tiers,

            version=data.get(
                "version"
            ),

            hidden=data.get(
                "hidden",
                False
            ),

            genshin_ids=[
                str(genshin_id)
                for genshin_id in data.get(
                    "genshin_ids",
                    []
                )
            ],
        )