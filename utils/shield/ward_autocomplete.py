from discord import app_commands

WARD_CHOICES = [
    "Pyro",
    "Hydro",
    "Electro",
    "Cryo",
    "Dendro",
    "Geo",
    "Void",
    "Deepdark"
]

async def ward_autocomplete(
    interaction,
    current: str
):
    return [
        app_commands.Choice(name=ward, value=ward.lower())
        for ward in WARD_CHOICES
        if current.lower() in ward.lower()
    ][:25]