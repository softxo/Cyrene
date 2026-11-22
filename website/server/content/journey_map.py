import json
import os
import re
from pathlib import Path
from uuid import uuid4

ICON_DIR = Path(__file__).resolve().parents[2] / "static" / "images" / "journey-map"


def _check_symbol(flag):
    if flag is True:
        return "1"

    if flag is None:
        return "-"

    return "0"


def _check_symbols(flags):
    return "".join(_check_symbol(flag) for flag in flags)


def _check_score(check):
    if check is True:
        return 1

    if check is None:
        return 0.5

    return 0


def icon(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")

    if not (ICON_DIR / f"{slug}.webp").is_file():
        raise FileNotFoundError(f"No Journey Map icon for {name}.")

    return f"/static/images/journey-map/{slug}.webp"


def item(name: str, icon_name: str | None = None) -> dict:
    return {"name": name, "icon": icon(icon_name or name)}


ITEMS_FILE = Path(__file__).with_name("journey_map_items.json")


def _load_items():
    if not ITEMS_FILE.is_file():
        return {"tabs": []}

    return json.loads(ITEMS_FILE.read_text(encoding="utf-8"))


ITEMS = _load_items()
ITEM_IDS = {entry["id"] for tab in ITEMS["tabs"] for entry in tab["items"]}
STATUS_FILE = Path(__file__).resolve().parents[3] / "data" / "journey_map_status.json"

TAB_ICONS = {
    "Waypoints": icon("Teleport Waypoint"),
    "Special Items": icon("Anemoculus"),
    "Chests": icon("Common Chest"),
    "Puzzle Chest": icon("Mini-puzzle"),
    "Local Specialties": icon("Valberry"),
    "Experience": icon("Experience"),
    "Enemies": icon("Enemies"),
    "Inventory / Materials": icon("Inventory"),
    "Landmarks": icon("Landmarks"),
}

TESTED_TABS = {"Chests"}
TESTED_NAMES = re.compile(r"culus$")
PARTIAL_IDS: set[int] = set()
LIMITED_IDS = {71}
BROKEN_IDS: set[int] = set()

STATES = {
    "done": "Done",
    "limited": "Done, with game limits",
    "partial": "Not fully working",
    "todo": "Not tried yet",
    "broken": "Doesn't work",
}

VERSION_DEFAULTS = {"map_version": "v7.2", "beacons_version": "alpha-37"}


def load_status() -> dict:
    if not STATUS_FILE.is_file():
        return {
            "items": {},
            "versions": {},
            "collapsed": {},
            "todos": {},
            "limits": {},
            "map_keys": {},
            "beacon_keys": {},
        }

    data = json.loads(STATUS_FILE.read_text(encoding="utf-8"))

    return {
        "items": data.get("items", {}),
        "versions": data.get("versions", {}),
        "collapsed": data.get("collapsed", {}),
        "todos": data.get("todos", {}),
        "limits": data.get("limits", {}),
        "map_keys": data.get("map_keys", {}),
        "beacon_keys": data.get("beacon_keys", {}),
    }


def save_status(data: dict) -> None:
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATUS_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, indent=1), encoding="utf-8")
    os.replace(temporary, STATUS_FILE)


def load_overrides() -> dict[str, dict]:
    return load_status()["items"]


def save_overrides(overrides: dict[str, dict]) -> None:
    data = load_status()
    data["items"] = overrides
    save_status(data)


def load_versions() -> dict[str, str]:
    return VERSION_DEFAULTS | load_status()["versions"]


def load_collapsed(user_id: int) -> set[str]:
    return set(load_status()["collapsed"].get(str(user_id), []))


def save_list_entry(
    user_id: int,
    title: str,
    detail: str,
    done: bool,
    task_id: str | None = None,
    collection: str = "todos",
) -> dict:
    title, detail = title.strip(), detail.strip()

    if not title or len(title) > 160 or len(detail) > 2000:
        raise ValueError("Give a title up to 160 characters and notes up to 2,000 characters.")

    data = load_status()
    tasks = data[collection].get(str(user_id), [])
    data[collection][str(user_id)] = tasks
    task = next((entry for entry in tasks if entry["id"] == task_id), None)

    if task_id is not None and task is None:
        raise KeyError(task_id)

    if task is None:
        task = {"id": uuid4().hex}
        tasks.append(task)

    task.update(title=title, detail=detail, done=done)
    save_status(data)

    return task


def delete_list_entry(user_id: int, task_id: str, collection: str = "todos") -> None:
    data = load_status()
    tasks = data[collection].get(str(user_id), [])
    remaining = [task for task in tasks if task["id"] != task_id]

    if len(remaining) == len(tasks):
        raise KeyError(task_id)

    data[collection][str(user_id)] = remaining
    save_status(data)


def update_collapsed(user_id: int, tabs: list[str]) -> None:
    names = {tab["name"] for tab in ITEMS["tabs"]}

    if not set(tabs) <= names:
        raise ValueError("Unknown tab.")

    data = load_status()
    data["collapsed"][str(user_id)] = sorted(set(tabs))
    save_status(data)


def update_versions(versions: dict[str, str]) -> None:
    if set(versions) != set(VERSION_DEFAULTS):
        raise ValueError("Give every version.")

    data = load_status()
    data["versions"] = versions
    save_status(data)


def update_item_status(item_id: int, state: str | None, working: dict | None) -> None:
    if item_id not in ITEM_IDS:
        raise KeyError(item_id)

    if state is not None and state not in STATES:
        raise ValueError(f"Unknown state {state}.")

    overrides = load_overrides()
    record: dict = {}

    if state is not None:
        record["state"] = state

    if working is not None:
        record["working"] = working
    elif any(entry["id"] == item_id for entry in WORKING):
        record["working"] = None

    if record:
        overrides[str(item_id)] = record
    else:
        overrides.pop(str(item_id), None)

    save_overrides(overrides)


def clear_item_status(item_id: int) -> None:
    if item_id not in ITEM_IDS:
        raise KeyError(item_id)

    overrides = load_overrides()
    overrides.pop(str(item_id), None)
    save_overrides(overrides)


def current_working(item_id: int, overrides: dict[str, dict]) -> dict | None:
    record = overrides.get(str(item_id), {})

    if "working" in record:
        return record["working"]

    for entry in WORKING:
        if entry["id"] == item_id:
            return {"tested_on": entry["tested_on"], "checks": entry["checks"]}

    return None


def item_state(tab: str, entry: dict, overrides: dict[str, dict]) -> str:
    override = overrides.get(str(entry["id"]), {})

    if "state" in override:
        return override["state"]

    if entry["id"] in BROKEN_IDS:
        return "broken"

    if not entry["hooked"]:
        return "todo"

    if entry["id"] in LIMITED_IDS:
        return "limited"

    if entry["id"] in PARTIAL_IDS:
        return "partial"

    if tab in TESTED_TABS or TESTED_NAMES.search(entry["name"]):
        return "done"

    return "partial"


def label_icon(item_id: int) -> str:
    return f"/static/images/journey-map/labels/{item_id}.webp"


def status_tabs(overrides: dict[str, dict]) -> list[dict]:
    tabs = []

    for tab in ITEMS["tabs"]:
        items = []

        for entry in tab["items"]:
            working = current_working(entry["id"], overrides)
            items.append(
                {
                    "id": entry["id"],
                    "name": entry["name"],
                    "icon": label_icon(entry["id"]),
                    "state": item_state(tab["name"], entry, overrides),
                    "manual": "state" in overrides.get(str(entry["id"]), {}),
                    "tested_on": working["tested_on"] if working else None,
                    "checks": _check_symbols(working["checks"]) if working else None,
                }
            )

        counts = {state: sum(entry["state"] == state for entry in items) for state in STATES}
        tabs.append(
            {"name": tab["name"], "icon": TAB_ICONS[tab["name"]], "items": items, "counts": counts}
        )

    return tabs


def map_tabs(tabs: list[dict]) -> list[dict]:
    return [
        {
            "name": tab["name"],
            "icon": tab["icon"],
            "categories": len(tab["items"]),
            "hooked": len(tab["items"]) - tab["counts"]["todo"] - tab["counts"]["broken"],
        }
        for tab in tabs
    ]


def working_entries(overrides: dict[str, dict]) -> list[dict]:
    defaults = {entry["id"]: entry for entry in WORKING}
    names = {entry["id"]: entry["name"] for tab in ITEMS["tabs"] for entry in tab["items"]}
    order = list(defaults) + [item_id for item_id in names if item_id not in defaults]
    entries = []

    for item_id in order:
        working = current_working(item_id, overrides)

        if not working:
            continue

        base = defaults.get(item_id) or {"name": names[item_id], "icon": label_icon(item_id)}
        checks = working["checks"]
        entries.append(
            {
                "id": item_id,
                "name": base["name"],
                "icon": base["icon"],
                "tested_on": working["tested_on"],
                "checks": checks,
                "percent": round(100 * sum(_check_score(check) for check in checks) / len(checks)),
            }
        )

    return entries


MAP_KEYS = [
    ("Markers", ["Alt", "X"], "Show or hide map markers"),
    ("Selector", ["Alt", "V"], "Open or close the category selector"),
    (
        "Selector interaction",
        ["Right-click"],
        "Hold while the selector is open to use its controls",
    ),
    ("Layer filter", ["0"], "Toggle the selected-layer filter while the selector is open"),
    ("Layered surface", ["Alt", "L"], "Show or hide surface markers on layered maps"),
    ("Borders", ["Alt", "B"], "Show or hide region borders"),
    ("Merge pins", ["Alt", "M"], "Toggle merged map pins"),
    ("Hover pins", ["Alt", "N"], "Show or hide pin details on hover"),
]

BEACON_KEYS = [
    ("Diamonds", ["Alt", "I"], "Toggle diamonds above visible objects in range"),
    ("Diamonds through walls", ["Alt", "O"], "Toggle diamonds for objects behind walls"),
    ("Glow", ["Alt", "U"], "Toggle the outline, tint and glow on objects"),
    ("Glow through walls", ["Alt", "Y"], "Toggle the halo for objects behind walls"),
    ("Diamond distance", ["Slider"], "Adjust in the selector: 50 to 250 m, default 80 m"),
]

WORKING = [
    {
        **item("Chests", "Common Chest"),
        "id": 17,
        "tested_on": "Common Chest",
        "checks": [True, True, True, True, True],
    },
    {
        **item("Oculi", "Hydroculus"),
        "id": 508,
        "tested_on": "Hydroculus",
        "checks": [True, True, True, True, True],
    },
    {
        **item("Torches", "Torch Puzzle"),
        "id": 71,
        "tested_on": "Sumeru Desert torch",
        "checks": [True, True, True, True, False],
    },
]

WORKING_COLUMNS = ["Glow", "Diamonds", "Halo", "Through walls", "Clears on collect/completion"]


def page_context(user_id: int) -> dict:
    overrides = load_overrides()
    tabs = status_tabs(overrides)
    map_summary = map_tabs(tabs)

    return {
        "map_tabs": map_summary,
        "map_categories": sum(tab["categories"] for tab in map_summary),
        "map_keys": MAP_KEYS,
        "beacon_keys": BEACON_KEYS,
        "beacon_limits": load_status()["limits"].get(str(user_id), []),
        "hooked_total": sum(tab["hooked"] for tab in map_summary),
        "working": working_entries(overrides),
        "working_columns": WORKING_COLUMNS,
        "status_tabs": tabs,
        "states": STATES,
        "state_totals": {state: sum(tab["counts"][state] for tab in tabs) for state in STATES},
        "todo": load_status()["todos"].get(str(user_id), []),
        "versions": load_versions(),
        "collapsed_tabs": load_collapsed(user_id),
    }
