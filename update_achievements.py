from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


# ============================================================
# Configuration
# ============================================================

GENSHIN_DB_API = (
    "https://genshin-db-api.vercel.app/api/v5/achievements"
)

PROJECT_ROOT = Path(__file__).resolve().parent

ACHIEVEMENTS_DIR = (
    PROJECT_ROOT
    / "data"
    / "achievements"
)


# ============================================================
# Download
# ============================================================

def download_achievements() -> list[dict]:
    """Download the current English GenshinDB achievements."""

    params = urllib.parse.urlencode({
        "query": "names",
        "matchCategories": "true",
        "verboseCategories": "true",
        "queryLanguages": "english",
        "resultLanguage": "english",
    })

    url = f"{GENSHIN_DB_API}?{params}"

    print("Downloading:")
    print(f"  {url}")
    print()

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Cyrene-Achievement-Updater",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=60,
        ) as response:

            raw_data = response.read()

    except urllib.error.HTTPError as error:
        raise RuntimeError(
            f"HTTP Error {error.code} while downloading "
            "GenshinDB achievements."
        ) from error

    except urllib.error.URLError as error:
        raise RuntimeError(
            f"Connection Error: {error.reason}"
        ) from error

    except TimeoutError as error:
        raise RuntimeError(
            "Download timed out."
        ) from error

    print(
        f"Downloaded {len(raw_data):,} bytes."
    )
    print()

    # --------------------------------------------------------
    # Parse JSON
    # --------------------------------------------------------

    try:
        data = json.loads(
            raw_data.decode("utf-8")
        )

    except (
        UnicodeDecodeError,
        json.JSONDecodeError,
    ) as error:

        raise RuntimeError(
            "GenshinDB returned invalid JSON."
        ) from error

    # --------------------------------------------------------
    # API response
    # --------------------------------------------------------
    #
    # With:
    #
    #   query=names
    #   matchCategories=true
    #   verboseCategories=true
    #
    # GenshinDB returns the achievement objects directly.
    #
    # Depending on the API version, the response can either
    # be the list itself or a dumpResult-style wrapper.
    # --------------------------------------------------------

    if isinstance(data, list):

        achievements = data

    elif isinstance(data, dict):

        # Standard dumpResult-style response.
        result = data.get("result")

        if isinstance(result, list):
            achievements = result

        else:
            # Some versions may return the category result
            # under another top-level field.
            achievements = None

            for value in data.values():

                if (
                    isinstance(value, list)
                    and value
                    and isinstance(value[0], dict)
                    and "achievementgroup" in value[0]
                ):
                    achievements = value
                    break

    else:
        achievements = None

    if not isinstance(
        achievements,
        list,
    ):
        raise RuntimeError(
            "Unexpected GenshinDB API response."
        )

    if not achievements:
        raise RuntimeError(
            "GenshinDB returned zero achievements."
        )

    return achievements


# ============================================================
# Filename conversion
# ============================================================

def group_to_filename(
    group_name: str,
) -> str:
    """
    Convert an achievement group into Cyrene's
    existing filename format.

    Examples:

        Challenger: Series I
        -> challenger_series_i.json

        The Hero's Journey
        -> the_heros_journey.json
    """

    name = group_name.lower().strip()

    # Remove apostrophes.
    name = name.replace("'", "")

    # Replace punctuation with spaces.
    name = re.sub(
        r"[^a-z0-9]+",
        " ",
        name,
    )

    # Collapse whitespace.
    name = re.sub(
        r"\s+",
        " ",
        name,
    ).strip()

    return (
        name.replace(" ", "_")
        + ".json"
    )


# ============================================================
# Validation
# ============================================================

def validate_achievement(
    achievement: dict,
) -> bool:
    """Validate a native GenshinDB achievement."""

    required = {
        "id",
        "name",
        "achievementGroupId",
        "achievementGroupName",
        "sortOrder",
        "stages",
        "version",
    }

    missing = (
        required
        - achievement.keys()
    )

    if missing:
        print(
            "WARNING: Invalid achievement:"
        )

        print(
            f"  Name: "
            f"{achievement.get('name', '<unknown>')}"
        )

        print(
            f"  Missing: "
            f"{', '.join(sorted(missing))}"
        )

        print()

        return False

    # --------------------------------------------------------
    # IDs
    # --------------------------------------------------------

    if not isinstance(
        achievement["id"],
        list,
    ):
        print(
            "WARNING: Invalid achievement ID:"
        )

        print(
            f"  {achievement.get('name', '<unknown>')}"
        )

        return False

    # --------------------------------------------------------
    # Stages
    # --------------------------------------------------------

    stages = achievement["stages"]

    if not isinstance(
        stages,
        int,
    ) or stages < 1:

        print(
            "WARNING: Invalid stage count:"
        )

        print(
            f"  {achievement.get('name', '<unknown>')}"
        )

        return False

    # --------------------------------------------------------
    # Validate every stage
    # --------------------------------------------------------

    for stage_number in range(
        1,
        stages + 1,
    ):

        stage_key = (
            f"stage{stage_number}"
        )

        stage = achievement.get(
            stage_key
        )

        if not isinstance(
            stage,
            dict,
        ):

            print(
                "WARNING: Missing stage:"
            )

            print(
                f"  Achievement: "
                f"{achievement.get('name', '<unknown>')}"
            )

            print(
                f"  Missing: {stage_key}"
            )

            print()

            return False

        if "description" not in stage:
            print(
                "WARNING: Stage has no description:"
            )

            print(
                f"  Achievement: "
                f"{achievement.get('name', '<unknown>')}"
            )

            print(
                f"  Stage: {stage_key}"
            )

            print()

            return False

        if "progress" not in stage:
            print(
                "WARNING: Stage has no progress:"
            )

            print(
                f"  Achievement: "
                f"{achievement.get('name', '<unknown>')}"
            )

            print(
                f"  Stage: {stage_key}"
            )

            print()

            return False

        if "reward" not in stage:
            print(
                "WARNING: Stage has no reward:"
            )

            print(
                f"  Achievement: "
                f"{achievement.get('name', '<unknown>')}"
            )

            print(
                f"  Stage: {stage_key}"
            )

            print()

            return False

    return True


# ============================================================
# Group achievements
# ============================================================

def group_achievements(
    achievements: list[dict],
) -> dict[str, list[dict]]:
    """Group achievements by GenshinDB achievementGroupName."""

    groups: dict[str, list[dict]] = {}

    for achievement in achievements:

        group_name = achievement.get(
            "achievementGroupName"
        )

        if not group_name:
            print(
                "WARNING: Achievement has no "
                "'achievementGroupName':"
            )

            print(
                f"  {achievement.get('name', '<unknown>')}"
            )

            print()

            continue

        if group_name not in groups:
            groups[group_name] = []

        groups[group_name].append(
            achievement
        )

    # --------------------------------------------------------
    # Sort achievements within each group
    # --------------------------------------------------------

    for group_name in groups:

        groups[group_name].sort(
            key=lambda achievement: achievement.get(
                "sortOrder",
                0,
            )
        )

    return groups

# ============================================================
# Write files
# ============================================================

def write_files(
    groups: dict[str, list[dict]],
) -> None:
    """
    Replace Cyrene's achievement files.

    This is only called after the complete dataset has
    successfully downloaded and validated.
    """

    ACHIEVEMENTS_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    # --------------------------------------------------------
    # Prepare all new files first
    # --------------------------------------------------------

    new_files: dict[
        str,
        str,
    ] = {}

    for group_name in sorted(groups):

        achievements = groups[
            group_name
        ]

        filename = group_to_filename(
            group_name
        )

        output_data = {
            "achievements": achievements
        }

        contents = json.dumps(
            output_data,
            ensure_ascii=False,
            indent=4,
        )

        contents += "\n"

        new_files[
            filename
        ] = contents

    # --------------------------------------------------------
    # Remove old achievement JSON files
    # --------------------------------------------------------

    for old_file in ACHIEVEMENTS_DIR.glob(
        "*.json"
    ):
        old_file.unlink()

    # --------------------------------------------------------
    # Write new files
    # --------------------------------------------------------

    print(
        "Writing achievement files:"
    )
    print()

    for filename, contents in sorted(
        new_files.items()
    ):

        output_path = (
            ACHIEVEMENTS_DIR
            / filename
        )

        output_path.write_text(
            contents,
            encoding="utf-8",
        )

        achievement_count = len(
            groups[
                next(
                    group
                    for group in groups
                    if group_to_filename(group)
                    == filename
                )
            ]
        )

        print(
            f"  {filename:<45}"
            f"{achievement_count:>5} achievements"
        )


# ============================================================
# Main
# ============================================================

def update_achievements() -> None:

    print("=" * 60)
    print("Cyrene Achievement Updater")
    print("=" * 60)
    print()

    # --------------------------------------------------------
    # Download
    # --------------------------------------------------------

    achievements = (
        download_achievements()
    )

    print(
        f"GenshinDB achievements: "
        f"{len(achievements):,}"
    )

    print()

    # --------------------------------------------------------
    # Debug achievement groups
    # --------------------------------------------------------

    group_names = sorted(
        {
            achievement.get(
                "achievementGroupName"
            )
            for achievement in achievements
        }
    )

    print(
        f"Unique achievement groups found: "
        f"{len(group_names):,}"
    )

    for group_name in group_names[:20]:
        print(
            f"  - {group_name}"
        )

    if len(group_names) > 20:
        print(
            f"  ... and "
            f"{len(group_names) - 20:,} more"
        )

    print()

    # --------------------------------------------------------
    # Validate
    # --------------------------------------------------------

    valid_achievements = []

    for achievement in achievements:

        if validate_achievement(
            achievement
        ):
            valid_achievements.append(
                achievement
            )

    if not valid_achievements:

        raise RuntimeError(
            "No valid achievements were found."
        )

    print(
        f"Validated: "
        f"{len(valid_achievements):,}"
    )

    print()

    # --------------------------------------------------------
    # Group
    # --------------------------------------------------------

    groups = group_achievements(
        valid_achievements
    )

    if not groups:

        raise RuntimeError(
            "No achievement groups were found."
        )

    print(
        f"Achievement groups: "
        f"{len(groups):,}"
    )

    print()

    # --------------------------------------------------------
    # Write
    # --------------------------------------------------------

    write_files(
        groups
    )

    # --------------------------------------------------------
    # Complete
    # --------------------------------------------------------

    print()

    print("=" * 60)
    print("Update complete.")
    print("=" * 60)

    print()

    print(
        f"Groups:       {len(groups):,}"
    )

    print(
        f"Achievements: {len(valid_achievements):,}"
    )

    print(
        f"Output:       {ACHIEVEMENTS_DIR}"
    )

    print()


# ============================================================
# Entry point
# ============================================================

if __name__ == "__main__":

    try:
        update_achievements()

    except KeyboardInterrupt:

        print()
        print("Update cancelled.")

        sys.exit(1)

    except Exception as error:

        print()
        print("=" * 60)
        print("UPDATE FAILED")
        print("=" * 60)
        print()
        print(error)
        print()

        sys.exit(1)