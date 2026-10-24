import discord

ENEMY_ELEMENT_COLOURS = {
    "physical": discord.Colour.light_grey(),
    "pyro": discord.Colour.orange(),
    "hydro": discord.Colour.blue(),
    "electro": discord.Colour.purple(),
    "cryo": discord.Colour.from_rgb(130, 220, 255),
    "dendro": discord.Colour.green(),
    "anemo": discord.Colour.teal(),
    "geo": discord.Colour.gold(),
}

WARD_COLOURS = {
    "pyro": discord.Colour.orange(),
    "hydro": discord.Colour.blue(),
    "electro": discord.Colour.purple(),
    "cryo": discord.Colour.from_rgb(130, 220, 255),
    "dendro": discord.Colour.green(),
    "anemo": discord.Colour.teal(),
    "geo": discord.Colour.gold(),
    "elementless": 0xFFFFFF,
    "void": 0x5A2DA6,
    "deepdark": 0x2B0F3F
}

WEAPON_RARITY_COLOURS = {
    1: 0x8E8E8E,
    2: 0x4CAF50,
    3: 0x3F51B5,
    4: 0x9C27B0,
    5: 0xF4B400,
}

RARITY_COLOURS = {
    1: 0x8E8E8E,
    2: 0x4CAF50,
    3: 0x3F51B5,
    4: 0x9C27B0,
    5: 0xF4B400,
}

ERROR_COLOURS = {
    "error": 0x820505,
    "warning": 0xF1C40F,
    "info": 0x3498DB,
    "success": 0x34E100
}

ERROR_TYPE_COLOURS = {
    "permission": 0x820505,
    "bot_permission": 0x820505,
    "cooldown": 0xF1C40F,
    "not_found": 0xF1C40F,
    "invalid_input": 0x820505,
    "missing_argument": 0xF1C40F,
    "unexpected": 0x820505,
    "success": 0x34E100,
}


### Colour Codes:
# Pyro: #ef7a35
# Hydro: #54b7f0
# Electro: #b08fc2
# Cryo: #a0d7e4
# Dendro: #a6c938
# Geo: ccb133
# Anemo: #75c2aa