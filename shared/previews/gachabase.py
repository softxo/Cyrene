"""Extract upgrade costs from the data embedded in a Gachabase detail page.

The page embeds JavaScript object literals, not JSON. Only the narrow numeric
cost arrays and JSON-quoted item names are read; page scripts are never run.
"""

import json
import re


class GachabaseFormatError(ValueError):
    """The page did not contain a complete, recognisable cost record."""


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
    pattern = re.compile(
        r"\blevel:(\d+),[^{}]*?(?:\{[^{}]*\}[^{}]*?)*?upgrade_costs:\[(.*?)\]", re.S
    )
    steps = {}
    for match in pattern.finditer(block):
        level = int(match.group(1))
        pairs = re.findall(r"\{item_id:(\d+),amount:(\d+)\}", match.group(2))
        if pairs:
            steps[level] = [(int(item), int(amount)) for item, amount in pairs]
    if not all(level in steps for level in range(1 if marker == "promotions:[" else 2, count + 1)):
        raise GachabaseFormatError(f"Incomplete {marker} costs")
    return steps


def extract_costs(html: str, name: str, character_id: int, kind: str = "characters") -> dict:
    """Extract validated character or weapon costs from an exact beta page."""
    data_start = html.find("__sveltekit")
    source = html[data_start:] if data_start >= 0 else html
    identity = re.search(
        rf'dto:\{{id:{character_id},[^{{}}]*?name:\{{key:"[^"\\]*",text:("(?:\\.|[^"\\])*")',
        source,
    )
    if not identity or json.loads(identity.group(1)).casefold() != name.casefold():
        raise GachabaseFormatError("Character identity not found")
    promotions = _steps(source, "promotions:[", 6)
    skills = []
    if kind == "characters":
        offset = 0
        for _ in range(3):
            offset = source.find("levels:[", offset)
            if offset < 0:
                raise GachabaseFormatError("Missing combat talent")
            skills.append(_steps(source, "levels:[", 10, offset))
            offset += len("levels:[")
    elif kind != "weapons":
        raise GachabaseFormatError("Unsupported content type")
    marker = source.find("items:{")
    if kind == "characters" and marker < 0:
        raise GachabaseFormatError("Material records not found")
    item_source = source[marker:] if kind == "characters" else source
    items = {}
    pattern = re.compile(
        r'(?:"(\d+)":|[a-zA-Z_$][\w$]*\["(\d+)"\]=)\{id:(\d+),name:\{key:"[^"]*",text:("(?:\\.|[^"\\])*"),override:[^}]*\}.*?rarity:(\d+),icon_path_hash:"(\d+)"',
        re.S,
    )
    for item in pattern.finditer(item_source):
        if (item.group(1) or item.group(2)) != item.group(3):
            continue
        item_id = int(item.group(3))
        icon_hash = item.group(6)
        icon_match = re.search(
            rf'"{icon_hash}":\{{webp:"(https://i\.gachabase\.net/[^"\\]+)"', source
        )
        icon = icon_match.group(1) if icon_match else None
        items[item_id] = {
            "id": item_id,
            "name": json.loads(item.group(4)),
            "rarity": int(item.group(5)),
            "images": {"icon": icon} if icon else {},
        }

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

    def decorate(steps, prefix):
        result = {}
        for level, costs in steps.items():
            if prefix == "lvl" and level > 10:
                continue
            try:

                def category(pair):
                    item_id = pair[0]
                    if item_id == 202:
                        return 0
                    if prefix == "lvl":
                        return (
                            1
                            if 104300 <= item_id < 104400 and item_id != 104319
                            else 2
                            if 112000 <= item_id < 113000
                            else 3
                            if 113000 <= item_id < 114000
                            else 4
                        )
                    if kind == "characters":
                        return (
                            1
                            if 104100 <= item_id < 104200
                            else 2
                            if 113000 <= item_id < 114000
                            else 3
                            if 101000 <= item_id < 102000
                            else 4
                        )
                    return 1 if 114000 <= item_id < 115000 else 2

                result[f"{prefix}{level}"] = [
                    {"id": item_id, "name": items[item_id]["name"], "count": amount}
                    for item_id, amount in sorted(costs, key=category)
                ]
            except KeyError as error:
                raise GachabaseFormatError("Missing material metadata") from error
        return result

    header = source[identity.start() : source.find("promotions:[", identity.end())]
    rarity_match = re.search(r"\brarity:(\d+)", header)
    weapon_match = re.search(r"\bweapon_type_id:(\d+)", header)
    icon_match = re.search(r'(?:square_icon_path_hash|icon_path_hash):"(\d+)"', header)
    icon_url = None
    if icon_match:
        image = re.search(
            rf'"{icon_match.group(1)}":\{{webp:"(https://i\.gachabase\.net/[^"\\]+)"', source
        )
        icon_url = image.group(1) if image else None
    record = {
        "id": character_id,
        "name": name,
        "costs": decorate(promotions, "ascend"),
        "preview": True,
        "rarity": int(rarity_match.group(1)) if rarity_match else None,
        "weapon_type_id": int(weapon_match.group(1)) if weapon_match else None,
        "icon": icon_url,
    }
    result = {kind: record, "materials": items}
    if kind == "characters":
        result["talents"] = {
            "id": character_id,
            "name": name,
            "preview": True,
            **{
                f"combat{index}": {"costs": decorate(costs, "lvl")}
                for index, costs in enumerate(skills, 1)
            },
        }
    return result


def extract_character_costs(html: str, name: str, character_id: int) -> dict:
    return extract_costs(html, name, character_id, "characters")
