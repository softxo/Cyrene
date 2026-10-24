from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass(slots=True)
class RawAchievement:
    """
    Raw achievement data obtained from the game scanner.

    This object intentionally makes very few assumptions about the
    underlying Genshin data. Any fields we discover should be preserved
    here so they are not lost during normalisation.
    """

    genshin_id: int

    status: int | None = None

    current: int | None = None

    total: int | None = None

    timestamp: int | None = None

    raw_fields: dict[str, Any] = field(
        default_factory=dict
    )

    def completed(self) -> bool:
        """
        Determine whether the achievement is completed.

        Genshin/Yae commonly uses:
            2 = finished
            3 = reward taken
        """

        return self.status in (2, 3)

    def completed_at(self) -> datetime | None:
        """
        Convert the game's Unix timestamp into a UTC datetime.
        """

        if self.timestamp is None:
            return None

        try:
            return datetime.fromtimestamp(
                self.timestamp,
                tz=timezone.utc,
            )

        except (OverflowError, OSError, ValueError):
            return None

    def to_dict(self) -> dict[str, Any]:
        """
        Convert the snapshot into JSON-compatible data.
        """

        return {
            "genshin_id": self.genshin_id,
            "status": self.status,
            "current": self.current,
            "total": self.total,
            "timestamp": self.timestamp,
            "completed": self.completed,
            "raw_fields": self.raw_fields,
        }


@dataclass(slots=True)
class AchievementSnapshot:
    """
    Normalised representation of one achievement at scan time.

    This is the format Cyrene should consume rather than dealing
    directly with protobuf/native scanner data.
    """

    genshin_id: int

    status: int | None

    current: int | None

    total: int | None

    timestamp: int | None

    raw_fields: dict[str, Any] = field(
        default_factory=dict
    )

    @property
    def completed(self) -> bool:
        """
        Whether this achievement is considered completed.
        """

        return self.status in (2, 3)

    @property
    def progress(self) -> tuple[int, int] | None:
        """
        Return current/total progress when both values are known.
        """

        if (
            self.current is None
            or self.total is None
        ):
            return None

        return (
            self.current,
            self.total,
        )

    @property
    def completed_at(self) -> datetime | None:
        """
        Convert the Unix timestamp into UTC.
        """

        if self.timestamp is None:
            return None

        try:
            return datetime.fromtimestamp(
                self.timestamp,
                tz=timezone.utc,
            )

        except (OverflowError, OSError, ValueError):
            return None


@dataclass(slots=True)
class ScannerResult:
    """
    Complete result returned by the Cyrene achievement scanner.
    """

    scanner_version: str

    game_version: str | None

    captured_at: int

    achievements: list[AchievementSnapshot] = field(
        default_factory=list
    )

    metadata: dict[str, Any] = field(
        default_factory=dict
    )

    errors: list[str] = field(
        default_factory=list
    )

    @property
    def achievement_count(self) -> int:
        return len(self.achievements)

    @property
    def completed_count(self) -> int:
        return sum(
            achievement.completed
            for achievement in self.achievements
        )

    def get(
        self,
        genshin_id: int,
    ) -> AchievementSnapshot | None:
        """
        Find an achievement by its original Genshin ID.
        """

        for achievement in self.achievements:

            if achievement.genshin_id == genshin_id:
                return achievement

        return None