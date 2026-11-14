"""Documentation structure, command reference and search index for the /docs pages."""

DEFAULT_PREFIX = "?"


def command(
    name,
    summary,
    details="",
    options=(),
    prefix=None,
    example="",
    note="",
):
    return {
        "name": name,
        "anchor": "cmd-" + name.replace(" ", "-"),
        "summary": summary,
        "details": details,
        "options": [
            {"name": option[0], "description": option[1], "required": option[2]}
            for option in options
        ],
        "prefix": prefix,
        "example": example,
        "note": note,
    }


COMMAND_GROUPS = {
    "characters": {
        "title": "Characters",
        "intro": "Look up any playable character. Start typing a name and pick it from the suggestions.",
        "commands": [
            command(
                "character",
                "A character's profile card.",
                "Shows their title, affiliation, constellation, rarity, birthday and the version they were released in.",
                [("character", "The character to show.", True)],
                ("character", ["char", "c"]),
                "/character character:Furina",
            ),
            command(
                "talents",
                "A character's Normal Attack, Elemental Skill and Elemental Burst.",
                options=[("character", "The character to show.", True)],
                prefix=("talents", ["talent", "skills", "skill", "t"]),
                example="/talents character:Neuvillette",
            ),
            command(
                "passives",
                "A character's passive talents.",
                options=[("character", "The character to show.", True)],
                prefix=("passives", ["passive", "p"]),
                example="/passives character:Bennett",
            ),
            command(
                "constellations",
                "All six of a character's constellations.",
                options=[("character", "The character to show.", True)],
                prefix=("constellations", ["cons", "const", "con"]),
                example="/constellations character:Xiangling",
            ),
            command(
                "materials",
                "Everything a character needs for Ascension and talents.",
                "Use the buttons under the message to switch between Ascension materials, Talent materials and the combined Total.",
                [("character", "The character to show.", True)],
                ("materials", ["mats"]),
                "/materials character:Nahida",
            ),
        ],
    },
    "weapons-artifacts": {
        "title": "Weapons and artifacts",
        "intro": "Weapon stats, refinements and artifact set bonuses.",
        "commands": [
            command(
                "weapon",
                "A weapon's rarity, maximum level, secondary stat and passive.",
                "Set a refinement to see the passive's values at that rank.",
                [
                    ("weapon", "The weapon to show.", True),
                    ("refinement", "Refinement rank from 1 to 5. Defaults to 1.", False),
                ],
                ("weapon", ["w"]),
                "/weapon weapon:Mistsplitter Reforged refinement:3",
                "The prefix version always shows refinement 1.",
            ),
            command(
                "weapon-materials",
                "The ascension materials a weapon needs.",
                options=[("weapon", "The weapon to show.", True)],
                prefix=("weaponmaterials", ["wm"]),
                example="/weapon-materials weapon:The Catch",
            ),
            command(
                "artifact",
                "An artifact set's rarity and its 2-piece and 4-piece bonuses.",
                options=[("artifact", "The artifact set to show.", True)],
                prefix=("artifact", ["a"]),
                example="/artifact artifact:Emblem of Severed Fate",
            ),
            command(
                "artifacts-list",
                "Every artifact set, so you can find the exact name.",
                prefix=("artifacts-list", ["artifacts", "alist", "al"]),
            ),
        ],
    },
    "world": {
        "title": "Enemies and banners",
        "intro": "Combat information and what is on the banners right now.",
        "commands": [
            command(
                "enemy",
                "An enemy's elements and the ward or shield it uses.",
                options=[("enemy", "The enemy to show.", True)],
                prefix=("enemy", ["e"]),
                example="/enemy enemy:Abyss Herald",
            ),
            command(
                "ward",
                "Which elements break a ward and how much each one removes.",
                "Press Notes under the message for extra mechanics, and Back to return.",
                [("ward", "The ward to show.", True)],
                ("ward", ["wd"]),
            ),
            command(
                "banners",
                "The current character event banners, with start and end times.",
                prefix=("banners", []),
            ),
        ],
    },
    "calculators": {
        "title": "Calculators",
        "intro": "Work out every material and the Mora needed between two levels.",
        "commands": [
            command(
                "character-resources",
                "Materials and Mora to level a character from one level to another.",
                "Shows the level-up materials, plus a Mora breakdown. The starting level must be lower than the target level.",
                [
                    ("name", "The character.", True),
                    ("starting_level", "Current level, from 1 to 90.", True),
                    ("end_level", "Target level, from 1 to 90.", True),
                ],
                ("characterresources", ["charresources", "cresources", "cr"]),
                "/character-resources name:Arlecchino starting_level:20 end_level:90",
                'With the prefix version, put names that contain spaces in quotes: ?cr "Hu Tao" 1 90.',
            ),
            command(
                "weapon-resources",
                "Materials and Mora to level a weapon from one level to another.",
                options=[
                    ("name", "The weapon.", True),
                    ("starting_level", "Current level, from 1 to 90.", True),
                    ("end_level", "Target level, from 1 to 90.", True),
                ],
                prefix=("weaponresources", []),
                example="/weapon-resources name:Engulfing Lightning starting_level:1 end_level:90",
                note="With the prefix version, put names that contain spaces in quotes.",
            ),
        ],
    },
    "account": {
        "title": "Linking and managing accounts",
        "intro": "Connect Discord to the website and link your Genshin accounts through HoYoLAB.",
        "commands": [
            command(
                "verify",
                "Connects your Discord account to the website.",
                "Open Connect Discord on the website to get a code, then run this command with it. Codes expire, so generate a new one if it is rejected.",
                [("code", "The code shown on the website.", True)],
                example="/verify code:AB12CD",
            ),
            command(
                "link-account",
                "Links a Genshin account through HoYoLAB.",
                "Choose Discord Login to sign in with your HoYoLAB email or username and password, or Cookie Login to paste your HoYoLAB cookies. If HoYoLAB asks for extra verification, Cyrene gives you a link to complete it. Then pick which Genshin account to link.",
                note="Only you can see the replies. Cyrene never stores your HoYoLAB password.",
            ),
            command(
                "accounts",
                "Lists your linked accounts.",
                "Pick an account from the menu, then use Add Account, Remove Account or Edit Nickname. Nicknames only change how the account appears in Cyrene.",
            ),
            command(
                "unlink-account",
                "Removes a linked Genshin account.",
                "This unlinks it from both Discord and the website.",
                [("genshin_uid", "The UID of the account to remove.", True)],
            ),
        ],
    },
    "daily": {
        "title": "Resin, Expeditions and reminders",
        "intro": "Live data from your linked account. These need a linked HoYoLAB account.",
        "commands": [
            command(
                "resin",
                "Your current Resin, when the next point arrives and when it will be full.",
                "Buttons under the message add or remove a manual or automatic Resin reminder at an amount from 1 to 200. If you have several accounts, pick one from the menu.",
                prefix=("resin", []),
            ),
            command(
                "expeditions",
                "Which characters are on Expeditions and how long each has left.",
                prefix=("expeditions", []),
            ),
            command(
                "reminders",
                "Every reminder set on an account, by type.",
                "Covers Resin, Expeditions, Serenitea Pot, Parametric Transformer and custom reminders. You can also manage them on the Reminders page of the website.",
                prefix=("reminders", []),
            ),
        ],
    },
    "server": {
        "title": "Server management",
        "intro": "Commands for server staff. Each one checks your Discord permissions first.",
        "commands": [
            command(
                "prefix",
                "Changes the text prefix used in this server.",
                f"The default prefix is {DEFAULT_PREFIX}. Slash commands are not affected.",
                [("new_prefix", "The new prefix, for example ! or c!.", True)],
                ("prefix", ["setprefix"]),
                note="Needs the Administrator permission.",
            ),
            command(
                "purge",
                "Deletes recent messages in the channel.",
                options=[("amount", "How many messages to delete, from 1 to 100.", True)],
                prefix=("purge", []),
                example="/purge amount:20",
                note="Needs the Manage Messages permission.",
            ),
            command(
                "error",
                "Looks up an error from the Error ID shown when a command fails.",
                options=[("error_id", "The Error ID from the failed command.", True)],
                prefix=("error", ["err"]),
                note="Needs the Manage Server permission.",
            ),
            command("guild", "Information about this server.", prefix=("guild", [])),
            command("ping", "Shows how quickly Cyrene is responding.", prefix=("ping", [])),
        ],
    },
    "extras": {
        "title": "Chat",
        "intro": "Talk to Cyrene.",
        "commands": [
            command(
                "ai",
                "Talk to Cyrene.",
                "Works in servers and in direct messages.",
                [("prompt", "What you'd like to say.", True)],
                ("ai", ["ask"]),
                "/ai prompt:Who should I pull for next?",
            ),
        ],
    },
}


def command_topics(*group_keys):
    return [(key, COMMAND_GROUPS[key]["title"]) for key in group_keys]


DOCS_SECTIONS = [
    {
        "title": "Start here",
        "pages": [
            {
                "slug": "getting-started",
                "title": "Getting started",
                "summary": "What Cyrene is, and the three steps to set it up.",
                "topics": [
                    ("what-is-cyrene", "What Cyrene is"),
                    ("setup", "Set up in three steps"),
                    ("using-commands", "Using commands"),
                    ("next-steps", "Where to go next"),
                ],
            },
            {
                "slug": "accounts",
                "title": "Connecting your accounts",
                "summary": "Connect Discord to the website, link Genshin accounts and keep them private.",
                "topics": [
                    ("two-connections", "Two kinds of connection"),
                    ("connect-discord", "Connect Discord to the website"),
                    ("link-hoyolab", "Link a Genshin account"),
                    ("manage-accounts", "Manage linked accounts"),
                    ("privacy", "Privacy and security"),
                ],
            },
        ],
    },
    {
        "title": "Discord bot",
        "pages": [
            {
                "slug": "game-info",
                "title": "Game information",
                "summary": "Look up characters, weapons, artifacts, enemies and banners, and calculate materials.",
                "groups": ["characters", "weapons-artifacts", "world", "calculators"],
            },
            {
                "slug": "account-tools",
                "title": "Account commands",
                "summary": "Link accounts, check Resin and Expeditions, and manage reminders from Discord.",
                "groups": ["account", "daily"],
            },
            {
                "slug": "server",
                "title": "Server and chat",
                "summary": "Moderation and setup for staff, plus chatting with Cyrene.",
                "groups": ["server", "extras"],
            },
        ],
    },
    {
        "title": "Website",
        "pages": [
            {
                "slug": "website",
                "title": "Website tour",
                "summary": "How the website is laid out and what each page is for.",
                "topics": [
                    ("layout", "Finding your way around"),
                    ("pages", "What each page does"),
                    ("account-switching", "Switching accounts"),
                    ("settings", "Settings"),
                ],
            },
            {
                "slug": "characters-weapons",
                "title": "Characters and weapons",
                "summary": "Browse your roster, plan upgrades and import your full weapon inventory.",
                "topics": [
                    ("roster", "Your character roster"),
                    ("planner", "Planning a character"),
                    ("weapons", "Weapons"),
                    ("weapon-scanner", "Importing weapons with the scanner"),
                ],
            },
            {
                "slug": "events",
                "title": "Events",
                "summary": "Follow limited and permanent events, endgame modes, banners and your own activities.",
                "topics": [
                    ("event-tabs", "What is on the page"),
                    ("tracking", "Tracking completion"),
                    ("custom-events", "Custom events"),
                ],
            },
            {
                "slug": "progress",
                "title": "Progress tracking",
                "summary": "Wishes, achievements, exploration and inventory in one place.",
                "topics": [
                    ("wishes", "Wishes"),
                    ("achievements", "Achievements"),
                    ("exploration", "Exploration"),
                    ("inventory", "Inventory"),
                ],
            },
            {
                "slug": "codes-reminders",
                "title": "Codes, check-in and reminders",
                "summary": "Redeem gift codes, claim daily rewards automatically and get notified in Discord.",
                "topics": [
                    ("gift-codes", "Gift codes"),
                    ("daily-check-in", "Daily check-in"),
                    ("reminders", "Reminders"),
                    ("reminder-modes", "Manual and automatic reminders"),
                ],
            },
        ],
    },
    {
        "title": "Help",
        "pages": [
            {
                "slug": "troubleshooting",
                "title": "Troubleshooting",
                "summary": "Fixes for the most common problems, and how to get help.",
                "topics": [
                    ("verification", "Verification codes"),
                    ("hoyolab-data", "Missing HoYoLAB data"),
                    ("commands", "Commands not working"),
                    ("get-help", "Getting help"),
                ],
            },
        ],
    },
]

DOCS_PAGES = []

for section in DOCS_SECTIONS:
    for page in section["pages"]:
        page["section"] = section["title"]
        if "groups" in page:
            page["topics"] = command_topics(*page["groups"])
        page["topic_titles"] = dict(page["topics"])
        DOCS_PAGES.append(page)


def build_search_index():
    entries = []

    for page in DOCS_PAGES:
        url = f"/docs/{page['slug']}"
        entries.append(
            {
                "title": page["title"],
                "context": page["section"],
                "text": page["summary"],
                "url": url,
            }
        )

        for anchor, title in page["topics"]:
            entries.append(
                {"title": title, "context": page["title"], "text": "", "url": f"{url}#{anchor}"}
            )

        for key in page.get("groups", []):
            for item in COMMAND_GROUPS[key]["commands"]:
                aliases = []
                if item["prefix"]:
                    aliases = [item["prefix"][0], *item["prefix"][1]]
                entries.append(
                    {
                        "title": "/" + item["name"],
                        "context": page["title"],
                        "text": " ".join([item["summary"], *aliases]),
                        "url": f"{url}#{item['anchor']}",
                    }
                )

    return entries


SEARCH_INDEX = build_search_index()
