import json
from pathlib import Path

from discord import app_commands

ARTIFACTS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "artifacts"


def load_artifacts():
    artifacts = {}

    for filename in (
        "3_star.json",
        "4_star.json",
        "5_star.json",
    ):
        path = ARTIFACTS_DIR / filename

        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)

        artifacts.update(data)

    return artifacts


def create_artifact_autocomplete(artifacts):
    async def artifact_autocomplete(interaction, current: str):
        artifacts_list = [
            artifact for artifact in artifacts.values() if artifact.get("type") == "artifact_set"
        ]
        matches = [
            artifact for artifact in artifacts_list if current.lower() in artifact["name"].lower()
        ]

        matches.sort(key=lambda artifact: artifact["name"].lower())

        return [
            app_commands.Choice(name=artifact["name"], value=artifact["name"])
            for artifact in matches[:25]
        ]

    return artifact_autocomplete
