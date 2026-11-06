"""Render the shared Wish macro for deterministic browser checks."""

from pathlib import Path

from jinja2 import Environment

source = Path("website/templates/events.html").read_text(encoding="utf-8")
source = source.split("{% block title %}")[0].replace('{% extends "base.html" %}', "")
macros = Environment(autoescape=True).from_string(source).module
base = dict(
    banner_id="character",
    banner_type=301,
    title="Upcoming character",
    start_time=1800003600,
    end_time=0,
    is_upcoming=True,
    image=None,
    r4_up_items=[],
)
banners = []
for kind, names in [
    (301, ["Character"]),
    (302, ["Weapon A", "Weapon B"]),
    (500, ["One", "Two", "Three", "Four", "Five"]),
]:
    items = [dict(name=name, icon=f"/preview/{name.replace(' ', '-')}.svg") for name in names]
    banners.append(
        dict(base, banner_id=str(kind), banner_type=kind, r5_up_items=items, preview_art=items)
    )

items = [dict(name="Character", icon="/preview/character.svg")]
banners.append(
    dict(
        base,
        banner_id="announced",
        title="Official announcement",
        image="/preview/full.svg",
        r5_up_items=items,
        r4_up_items=[dict(name="Four-star", icon="/preview/four.svg")],
    )
)
banners.insert(
    0,
    dict(
        base,
        banner_id="current",
        title="Chanson of Many Waters",
        image="/preview/current.svg",
        start_time=1799900000,
        end_time=1800090000,
        is_upcoming=False,
        r5_up_items=items,
        r4_up_items=[dict(name="Four-star", icon="/preview/four.svg")],
    ),
)
print(macros.wish_banner_sections(banners))
