from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from utils.exporter.engine import ExportResult


def _serialize_value(
    value: Any,
) -> Any:

    if is_dataclass(value):
        return {
            key: _serialize_value(item)
            for key, item in asdict(value).items()
        }

    if isinstance(value, list):
        return [
            _serialize_value(item)
            for item in value
        ]

    if isinstance(value, tuple):
        return [
            _serialize_value(item)
            for item in value
        ]

    if isinstance(value, dict):
        return {
            key: _serialize_value(item)
            for key, item in value.items()
        }

    return value


def serialize_export(
    result: ExportResult,
) -> dict[str, Any]:
    """
    Convert an ExportResult into the Cyrene
    export JSON structure.
    """

    data = _serialize_value(
        result.data
    )

    return {
        "format": "cyrene",

        "version": 1,

        "exporter": {
            "version": result.exporter_version,
            "game_version": result.game_version,
            "captured_at": result.captured_at,
        },

        "data": data,

        "errors": result.errors,
    }


def write_export(
    result: ExportResult,
    output_file: str | Path,
) -> Path:
    """
    Serialize an export and write it to disk.
    """

    output_path = Path(
        output_file
    )

    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    export_data = serialize_export(
        result
    )

    with output_path.open(
        "w",
        encoding="utf-8",
    ) as file:

        json.dump(
            export_data,
            file,
            indent=4,
            ensure_ascii=False,
        )

    return output_path