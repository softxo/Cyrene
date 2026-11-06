"""Render the real Events macros for isolated browser checks."""

from pathlib import Path

from jinja2 import Environment

source = Path("website/templates/events.html").read_text(encoding="utf-8")
source = source.split("{% block title %}")[0].replace('{% extends "base.html" %}', "")
macros = Environment(autoescape=True).from_string(source).module
account = {"id": 1, "nickname": "Fixture", "genshin_uid": "fixture"}
base = {
    "id": "fixture",
    "name": "The Grand Defense: Defy the Unjust Judgment",
    "is_upcoming": False,
    "start_time": 0,
    "end_time": 1803456000,
    "rewards": [
        {
            "name": f"Material {i}",
            "icon": "/static/images/misc/Primogem.webp",
            "amount": 3,
            "rarity": 3,
        }
        for i in range(30)
    ],
}
print(macros.limited_event_card(base, account))
print(
    macros.limited_event_card(
        {
            **base,
            "id": "daily",
            "name": "Ley Line Overflow",
            "category": "Daily",
            "rewards": base["rewards"][:2],
            "daily_reset_time": 1800003600,
            "is_upcoming": True,
            "is_unscheduled_upcoming": True,
            "end_time": 0,
        },
        account,
    )
)
print(
    macros.limited_event_card(
        {
            **base,
            "id": "approximate",
            "name": "Calendar preview",
            "rewards": [],
            "is_upcoming": True,
            "start_time": 0,
            "end_time": 0,
            "opening_date": "2027-01-17",
            "opening_date_timestamp": 1800172800,
        },
        account,
    )
)
print(
    macros.limited_event_card(
        {
            **base,
            "id": "scheduled",
            "name": "Scheduled event",
            "rewards": [],
            "is_upcoming": True,
            "start_time": 1800086400,
        },
        account,
    )
)
