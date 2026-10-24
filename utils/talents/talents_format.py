def format_description(description):
    text = []

    if isinstance(description, list):
        text.extend(description)

    elif isinstance(description, dict):
        for key, value in description.items():
            text.append(f"**{key.capitalize()}**")

            if isinstance(value, list):
                text.extend(value)
                text.append("")

            elif isinstance(value, dict):
                for sub_key, sub_value in value.items():
                    if isinstance(sub_value, list):
                        text.extend(sub_value)

    return "\n".join(text).strip()


def format_sections(sections):
    text = []

    for section in sections:
        text.append(f"**{section['title']}**")
        text.extend(section["text"])
        text.append("")

    return "\n".join(text).strip()