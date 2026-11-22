import json
import re
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path

STANDARD = {"Diluc", "Jean", "Keqing", "Mona", "Qiqi", "Tighnari", "Dehya", "Yumemizuki Mizuki"}


def normalise(name):
    return re.sub(r"[^a-z0-9]", "", name.casefold())


@lru_cache(maxsize=1)
def banner_history():
    path = Path(__file__).resolve().parents[3] / "data/metadata/wish_banner_history.json"

    return json.loads(path.read_text(encoding="utf-8"))["banners"]


BANNER_CHANGE_MARGIN = timedelta(hours=18)
CHARACTER_EVENT_GACHA_TYPES = {"301", "400"}


def _pulled_during(banner, pulled, padding):
    starts = datetime.fromisoformat(banner["start"]) - padding
    ends = datetime.fromisoformat(banner["end"]) + padding

    return starts <= pulled <= ends


def _character_banners(history):
    return [banner for banner in history if banner["kind"] == "character"]


def _featured_names(banner):
    return {normalise(name) for name in banner["featured"]}


def _possibly_featured(name, pulled, history):
    wanted = normalise(name)

    return any(
        wanted in _featured_names(banner) and _pulled_during(banner, pulled, BANNER_CHANGE_MARGIN)
        for banner in _character_banners(history)
    )


def _decision(guaranteed, won):
    if won and guaranteed:
        return "guaranteed"

    if won and guaranteed is None:
        return "unknown"

    return "win" if won else "loss"


def annotate_outcomes(records):
    results = [dict(record, outcome=None) for record in records]
    guaranteed = None

    for record in reversed(results):
        if record.get("rank_type") != 5:
            continue

        if record.get("gacha_type") not in CHARACTER_EVENT_GACHA_TYPES:
            continue

        pulled = record["pulled_at"]
        history = banner_history()

        active_banners = [
            banner
            for banner in _character_banners(history)
            if _pulled_during(banner, pulled, -BANNER_CHANGE_MARGIN)
        ]

        featured = set().union(*(_featured_names(banner) for banner in active_banners))
        name = record["item_name"]

        if featured:
            won = normalise(name) in featured
        elif name not in STANDARD:
            won = True
        else:
            if _possibly_featured(name, pulled, history):
                guaranteed = None
                continue

            won = False

        record["outcome"] = "win" if won else "loss"
        record["decision"] = _decision(guaranteed, won)
        guaranteed = not won

    return results
