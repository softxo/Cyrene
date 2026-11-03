"""Reviewed preview sheets used only when an exact provider record is missing."""

import copy
import json
from pathlib import Path

DATA = json.loads(
    (Path(__file__).resolve().parents[2] / "data/preview_character_materials.json").read_text(
        encoding="utf-8"
    )
)


def preview_entry(folder: str, name: str) -> dict | None:
    if folder == "materials":
        return copy.deepcopy(
            next(
                (
                    value
                    for key, value in DATA["materials"].items()
                    if key.casefold() == name.casefold()
                ),
                None,
            )
        )
    character = next((key for key in DATA["characters"] if key.casefold() == name.casefold()), None)
    if not character or folder not in {"characters", "talents"}:
        return None
    sheet = DATA["characters"][character]

    def item(material_name, count):
        material = DATA["materials"][material_name]
        return {"id": material["id"], "name": material_name, "count": count}

    costs = {}
    if folder == "characters":
        gems = [
            "Vajrada Amethyst " + suffix for suffix in ("Sliver", "Fragment", "Chunk", "Gemstone")
        ]
        # Mora, gem tier/count, boss count, specialty count, common tier/count.
        rows = [
            (20000, 0, 1, 0, 3, 0, 3),
            (40000, 1, 3, 2, 10, 0, 15),
            (60000, 1, 6, 4, 20, 1, 12),
            (80000, 2, 3, 8, 30, 1, 18),
            (100000, 2, 6, 12, 45, 2, 12),
            (120000, 3, 6, 20, 60, 2, 24),
        ]
        for phase, (mora, gem, gem_count, boss, local, common, common_count) in enumerate(rows, 1):
            step = [item("Mora", mora), item(gems[gem], gem_count)]
            if boss:
                step.append(item(sheet["boss"], boss))
            step.extend(
                [item(sheet["speciality"], local), item(sheet["common"][common], common_count)]
            )
            costs[f"ascend{phase}"] = step
    else:
        # Mora, talent-book tier/count, common-drop tier/count, weekly drop count.
        rows = [
            (12500, 0, 3, 0, 6, 0),
            (17500, 1, 2, 1, 3, 0),
            (25000, 1, 4, 1, 4, 0),
            (30000, 1, 6, 1, 6, 0),
            (37500, 1, 9, 1, 9, 0),
            (120000, 2, 4, 2, 4, 1),
            (260000, 2, 6, 2, 6, 1),
            (450000, 2, 12, 2, 9, 2),
            (700000, 2, 16, 2, 12, 2),
        ]
        for level, (mora, book, books, common, drops, weekly) in enumerate(rows, 2):
            step = [
                item("Mora", mora),
                item(sheet["books"][book], books),
                item(sheet["common"][common], drops),
            ]
            if weekly:
                step.append(item(sheet["weekly"], weekly))
            if level == 10:
                step.append(item("Crown of Insight", 1))
            costs[f"lvl{level}"] = step
    return {"name": character, "costs": costs, "preview": True, "sources": DATA["sources"]}


def matches_preview_materials(record: dict, preview: dict) -> bool:
    """An exact name must not conceal placeholder costs copied from another character."""

    def names(data):
        costs = data.get("costs") or data.get("combat1", {}).get("costs", {})
        return {
            item.get("name", "").casefold()
            for step in costs.values()
            if isinstance(step, list)
            for item in step
            if isinstance(item, dict)
        }

    return names(record) == names(preview)
