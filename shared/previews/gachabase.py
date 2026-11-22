import json
import re

PROMOTIONS_MARKER = "promotions:["
TALENT_LEVELS_MARKER = "levels:["
MATERIALS_MARKER = "items:{"

PROMOTION_COUNT = 6
TALENT_LEVEL_COUNT = 10
COMBAT_TALENT_COUNT = 3

MORA_ID = 202

STEP_PATTERN = re.compile(
    r"\blevel:(\d+),[^{}]*?(?:\{[^{}]*\}[^{}]*?)*?upgrade_costs:\[(.*?)\]",
    re.S,
)

COST_PAIR_PATTERN = re.compile(r"\{item_id:(\d+),amount:(\d+)\}")

MATERIAL_PATTERN = re.compile(
    r'(?:"(\d+)":|[a-zA-Z_$][\w$]*\["(\d+)"\]=)'
    r'\{id:(\d+),name:\{key:"[^"]*",text:("(?:\\.|[^"\\])*"),override:[^}]*\}'
    r'.*?rarity:(\d+),icon_path_hash:"(\d+)"',
    re.S,
)


class GachabaseFormatError(ValueError):
    pass


def _array(source: str, start: int) -> str:
    if start < 0 or source[start] != "[":
        raise GachabaseFormatError("Missing data array")

    depth = 0
    in_string = False
    escape = False

    for index in range(start, len(source)):
        char = source[index]

        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char == "[":
            depth += 1
        elif char == "]":
            depth -= 1

            if not depth:
                return source[start : index + 1]

    raise GachabaseFormatError("Incomplete data array")


def _steps(source: str, marker: str, count: int, offset: int = 0) -> dict:
    offset = source.find(marker, offset)

    if offset < 0:
        raise GachabaseFormatError(f"Missing {marker}")

    block = _array(source, offset + len(marker) - 1)
    steps = {}

    for match in STEP_PATTERN.finditer(block):
        level = int(match.group(1))
        pairs = COST_PAIR_PATTERN.findall(match.group(2))

        if pairs:
            steps[level] = [(int(item), int(amount)) for item, amount in pairs]

    first_level = 1 if marker == PROMOTIONS_MARKER else 2
    expected_levels = range(first_level, count + 1)

    if not all(level in steps for level in expected_levels):
        raise GachabaseFormatError(f"Incomplete {marker} costs")

    return steps


def _image_url(source: str, icon_hash: str) -> str | None:
    match = re.search(
        rf'"{icon_hash}":\{{webp:"(https://i\.gachabase\.net/[^"\\]+)"',
        source,
    )

    return match.group(1) if match else None


def _find_identity(source: str, name: str, character_id: int) -> re.Match:
    identity = re.search(
        rf'dto:\{{id:{character_id},[^{{}}]*?name:\{{key:"[^"\\]*",text:("(?:\\.|[^"\\])*")',
        source,
    )

    if not identity or json.loads(identity.group(1)).casefold() != name.casefold():
        raise GachabaseFormatError("Character identity not found")

    return identity


def _combat_talent_steps(source: str) -> list[dict]:
    skills = []
    offset = 0

    for _ in range(COMBAT_TALENT_COUNT):
        offset = source.find(TALENT_LEVELS_MARKER, offset)

        if offset < 0:
            raise GachabaseFormatError("Missing combat talent")

        skills.append(_steps(source, TALENT_LEVELS_MARKER, TALENT_LEVEL_COUNT, offset))
        offset += len(TALENT_LEVELS_MARKER)

    return skills


def _material_source(source: str, kind: str) -> str:
    if kind != "characters":
        return source

    marker = source.find(MATERIALS_MARKER)

    if marker < 0:
        raise GachabaseFormatError("Material records not found")

    return source[marker:]


def _extract_materials(source: str, item_source: str) -> dict:
    items = {}

    for item in MATERIAL_PATTERN.finditer(item_source):
        if (item.group(1) or item.group(2)) != item.group(3):
            continue

        item_id = int(item.group(3))
        icon = _image_url(source, item.group(6))

        items[item_id] = {
            "id": item_id,
            "name": json.loads(item.group(4)),
            "rarity": int(item.group(5)),
            "images": {"icon": icon} if icon else {},
        }

    return items


def _disambiguate_material_names(items: dict) -> None:
    name_counts = {}

    for item in items.values():
        key = item["name"].casefold()
        name_counts[key] = name_counts.get(key, 0) + 1

    for item in items.values():
        original = item["name"]

        if not original.strip(" ?"):
            item["name"] = f"Unknown material ({item['id']})"
        elif name_counts[original.casefold()] > 1:
            item["name"] = f"{original} ({item['id']})"


def _talent_material_order(item_id: int) -> int:
    if 104300 <= item_id < 104400 and item_id != 104319:
        return 1

    if 112000 <= item_id < 113000:
        return 2

    if 113000 <= item_id < 114000:
        return 3

    return 4


def _character_ascension_material_order(item_id: int) -> int:
    if 104100 <= item_id < 104200:
        return 1

    if 113000 <= item_id < 114000:
        return 2

    if 101000 <= item_id < 102000:
        return 3

    return 4


def _weapon_ascension_material_order(item_id: int) -> int:
    if 114000 <= item_id < 115000:
        return 1

    return 2


def _material_order(item_id: int, prefix: str, kind: str) -> int:
    if item_id == MORA_ID:
        return 0

    if prefix == "lvl":
        return _talent_material_order(item_id)

    if kind == "characters":
        return _character_ascension_material_order(item_id)

    return _weapon_ascension_material_order(item_id)


def _decorate(steps: dict, prefix: str, kind: str, items: dict) -> dict:
    result = {}

    for level, costs in steps.items():
        if prefix == "lvl" and level > TALENT_LEVEL_COUNT:
            continue

        ordered_costs = sorted(costs, key=lambda pair: _material_order(pair[0], prefix, kind))

        try:
            result[f"{prefix}{level}"] = [
                {"id": item_id, "name": items[item_id]["name"], "count": amount}
                for item_id, amount in ordered_costs
            ]
        except KeyError as error:
            raise GachabaseFormatError("Missing material metadata") from error

    return result


def _header_number(header: str, field: str) -> int | None:
    match = re.search(rf"\b{field}:(\d+)", header)

    return int(match.group(1)) if match else None


def _header_icon(header: str, source: str) -> str | None:
    match = re.search(r'(?:square_icon_path_hash|icon_path_hash):"(\d+)"', header)

    if not match:
        return None

    return _image_url(source, match.group(1))


def extract_costs(html: str, name: str, character_id: int, kind: str = "characters") -> dict:
    data_start = html.find("__sveltekit")
    source = html[data_start:] if data_start >= 0 else html

    identity = _find_identity(source, name, character_id)
    promotions = _steps(source, PROMOTIONS_MARKER, PROMOTION_COUNT)

    if kind == "characters":
        skills = _combat_talent_steps(source)
    elif kind == "weapons":
        skills = []
    else:
        raise GachabaseFormatError("Unsupported content type")

    items = _extract_materials(source, _material_source(source, kind))
    _disambiguate_material_names(items)

    header_end = source.find(PROMOTIONS_MARKER, identity.end())
    header = source[identity.start() : header_end]

    record = {
        "id": character_id,
        "name": name,
        "costs": _decorate(promotions, "ascend", kind, items),
        "preview": True,
        "rarity": _header_number(header, "rarity"),
        "weapon_type_id": _header_number(header, "weapon_type_id"),
        "icon": _header_icon(header, source),
    }

    result = {kind: record, "materials": items}

    if kind == "characters":
        combat_talents = {
            f"combat{index}": {"costs": _decorate(costs, "lvl", kind, items)}
            for index, costs in enumerate(skills, 1)
        }

        result["talents"] = {
            "id": character_id,
            "name": name,
            "preview": True,
            **combat_talents,
        }

    return result


def extract_character_costs(html: str, name: str, character_id: int) -> dict:
    return extract_costs(html, name, character_id, "characters")
