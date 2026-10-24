import json
import urllib.parse
import urllib.request
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[2]

EXPORT_PATH = (
    BASE_DIR
    / "data"
    / "achievements"
    / "test_export.json"
)


# ========================================
# Load YaeAchievement export
# ========================================

with EXPORT_PATH.open(
    "r",
    encoding="utf-8"
) as file:
    export_data = json.load(file)


export_ids = {
    int(entry["id"])
    for entry in export_data.get("list", [])
    if "id" in entry
}


print("YaeAchievement export loaded.")
print(f"Export IDs: {len(export_ids)}")


# ========================================
# Download GenshinDB achievements
# ========================================

params = urllib.parse.urlencode({
    "query": "names",
    "matchCategories": "true",
    "verboseCategories": "true",
    "queryLanguages": "English",
})

url = (
    "https://genshin-db-api.vercel.app/api/v5/"
    f"achievements?{params}"
)

print()
print("Downloading GenshinDB achievement data...")
print(url)

request = urllib.request.Request(
    url,
    headers={
        "User-Agent": "Cyrene Achievement Importer"
    }
)

with urllib.request.urlopen(request) as response:
    genshin_data = json.loads(
        response.read().decode("utf-8")
    )


# ========================================
# Inspect response
# ========================================

if not isinstance(genshin_data, list):
    genshin_data = [genshin_data]


print()
print(f"GenshinDB records: {len(genshin_data)}")


# ========================================
# Extract GenshinDB IDs
# ========================================

genshin_ids = set()

for achievement in genshin_data:

    ids = achievement.get("id", [])

    if isinstance(ids, int):
        ids = [ids]

    for achievement_id in ids:
        genshin_ids.add(int(achievement_id))


# ========================================
# Compare
# ========================================

present = export_ids & genshin_ids

missing_from_export = (
    genshin_ids - export_ids
)

unknown_to_genshin = (
    export_ids - genshin_ids
)


print()
print("========================================")
print("COMPARISON")
print("========================================")

print(
    f"GenshinDB IDs:        {len(genshin_ids)}"
)

print(
    f"Export IDs:           {len(export_ids)}"
)

print(
    f"Present in both:      {len(present)}"
)

print(
    f"Missing from export:  "
    f"{len(missing_from_export)}"
)

print(
    f"Unknown to GenshinDB: "
    f"{len(unknown_to_genshin)}"
)


# ========================================
# Show missing IDs
# ========================================

print()
print("First missing IDs:")

for achievement_id in sorted(
    missing_from_export
)[:100]:

    print(achievement_id)