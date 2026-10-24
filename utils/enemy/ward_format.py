from utils.constants.emojis import COLOURED_ELEMENT_EMOJIS, WARD_EMOJIS, STAT_EMOJIS
from utils.constants.stats import REFERENCE_NAMES

TYPE_NAMES = {
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


def format_wards(wards):

    if not wards:
        return "None"

    text = []

    for ward in wards:

        if ward["type"] == "elementless":
            emoji = WARD_EMOJIS.get(ward["type"], "")

            hp = ward["hp"]
            hp_emoji = STAT_EMOJIS.get("hp", "")

            percent = hp["multiplier"] * 100

            reference = REFERENCE_NAMES.get(
                hp["reference"],
                hp["reference"].replace("_", " ").title()
            )

            text.append(
                f"{emoji} **Elementless Ward**\n"
                f"{hp_emoji} **HP**: {percent:.0f}% of **{reference}**"
            )


        elif ward["type"] == "elemental":
            emoji = COLOURED_ELEMENT_EMOJIS.get(
                ward["element"],
                ""
            )

            element = TYPE_NAMES.get(
                ward["element"],
                ward["element"].replace("_", " ").title()
            )

            if "gauge" in ward:

                text.append(
                    f"{emoji} **{element} Ward**\n"
                    f"**Gauge:** {ward['gauge']['value']}U"
                )


            elif "hp" in ward:

                hp = ward["hp"]
                hp_emoji = STAT_EMOJIS.get("hp", "")

                percent = hp["multiplier"] * 100

                reference = REFERENCE_NAMES.get(
                    hp["reference"],
                    hp["reference"].replace("_", " ").title()
                )

                text.append(
                    f"{emoji} **{element} Ward**\n"
                    f"{hp_emoji} **HP:** {percent:.0f}% of **{reference}**"
                )

        elif ward["type"] in ("void", "deepdark"):
            emoji = WARD_EMOJIS.get(ward["type"], "")

            ward_type = TYPE_NAMES[ward["type"]]

            hp = ward["hp"]
            hp_emoji = STAT_EMOJIS.get("hp", "")

            percent = hp["multiplier"] * 100

            reference = REFERENCE_NAMES.get(
                hp["reference"],
                hp["reference"].replace("_", " ").title()
            )

            text.append(
                f"{emoji} **{ward_type} Ward**\n"
                f"{hp_emoji} **HP:** {percent:.0f}% of **{reference}**"
            )

    return "\n\n".join(text)