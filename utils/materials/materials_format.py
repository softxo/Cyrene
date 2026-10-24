from utils.icons import get_material_emoji

def format_materials(material_data, costs, emojis):
    text = ""

    for tier, amount in costs.items():
        if not tier.startswith("tier"):
            continue

        material = material_data["tiers"][tier]

        emoji = get_material_emoji(
            emojis,
            material["emoji"]
        )

        text += (
            f"{emoji} **{material['name']}** ×{amount}\n"
        )

    return text