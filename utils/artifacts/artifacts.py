import json
from pathlib import Path


ARTIFACTS_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "data"
    / "artifacts"
)


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