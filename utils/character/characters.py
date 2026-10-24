from utils.character.character_loader import CHARACTERS

def get_character(character_id: str):
    return CHARACTERS.get(character_id.lower())

def search_characters(query: str):
    results = []

    for char_id, data in CHARACTERS.items():
        if query.lower() in data["name"].lower():
            results.append(char_id)

    return results[:25]