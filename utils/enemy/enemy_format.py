from utils.constants.emojis import COLOURED_ELEMENT_EMOJIS

ELEMENT_NAMES = {
    "physical": "Physical",
    "pyro": "Pyro",
    "hydro": "Hydro",
    "electro": "Electro",
    "cryo": "Cryo",
    "dendro": "Dendro",
    "anemo": "Anemo",
    "geo": "Geo",
    "void": "Void",
    "deepdark": "Deepdark"
}

def format_elements(values):
    lines = []

    for element in values:
        emoji = COLOURED_ELEMENT_EMOJIS[element]
        name = ELEMENT_NAMES[element]

        lines.append(f"{emoji} **{name}**")

    return "\n".join(lines)

def format_values(values, immune=None):
    immune = immune or []

    lines = []

    for element, value in values.items():
        if element in immune:
            lines.append("**Immune**")
        else:
            lines.append(f"**{value}%**")

    return "\n".join(lines)
