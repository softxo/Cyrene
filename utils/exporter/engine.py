from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from utils.exporter.achievements.mapper import (
    AchievementMapper,
)
from utils.exporter.achievements.parser import (
    AchievementParser,
)
from utils.achievements.achievements import (
    load_achievements,
)


class ExportResult:

    def __init__(
        self,
        exporter_version: str,
        game_version: str | None,
        captured_at: int,
        data: dict[str, Any] | None = None,
        errors: list[str] | None = None,
    ):
        self.exporter_version = exporter_version
        self.game_version = game_version
        self.captured_at = captured_at

        self.data = (
            data
            if data is not None
            else {}
        )

        self.errors = (
            errors
            if errors is not None
            else []
        )

    @property
    def captured_at_datetime(self) -> datetime:

        return datetime.fromtimestamp(
            self.captured_at,
            tz=timezone.utc,
        )


class ExporterEngine:
    """
    Main coordinator for the Cyrene Exporter.
    """

    VERSION = "0.1.0"

    def __init__(
        self,
        game_version: str | None = None,
    ):
        self.game_version = game_version

        self.achievement_mapper = (
            AchievementMapper()
        )

        self.achievement_parser = (
            AchievementParser(
                self.achievement_mapper
            )
        )

    async def export_achievements(
        self,
    ) -> list:

        definitions = load_achievements()

        return self.achievement_parser.parse(
            definitions
        )

    async def export_all(
        self,
    ) -> ExportResult:

        result = ExportResult(
            exporter_version=self.VERSION,
            game_version=self.game_version,
            captured_at=int(
                datetime.now(
                    timezone.utc
                ).timestamp()
            ),
        )

        try:

            achievements = (
                await self.export_achievements()
            )

            result.data[
                "achievements"
            ] = achievements

        except Exception as error:

            result.errors.append(
                f"Achievements: {error}"
            )

        return result