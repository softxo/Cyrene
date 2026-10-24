import discord
from discord.ext import commands
from discord import app_commands
from utils.shield.wards import get_ward
from utils.shield.ward_autocomplete import ward_autocomplete
from utils.constants.colours import WARD_COLOURS
from utils.constants.emojis import COLOURED_ELEMENT_EMOJIS, WARD_EMOJIS, MISC_EMOJIS
from utils.errors.error_handler import send_interaction_error, send_not_found, send_missing_argument, send_not_your_command


def get_ward_url(emoji: str) -> str:
    return (
        "https://raw.githubusercontent.com/"
        f"softxo/Genshin-Bot/main/assets/wards/{emoji}.png"
    )

def format_notes(notes: list[str]) -> str:
    prefixes = {
        "!": MISC_EMOJIS["important"],
        "?": MISC_EMOJIS["info"],
    }

    formatted = []

    for note in notes:
        emoji = prefixes.get(note[:1])

        if emoji:
            note = f"{emoji}{note[1:]}"

        formatted.append(note)

    return "\n".join(formatted)

def format_element(element: str) -> str:
    lookup = (
        element.lower()
        .replace("-", "_")
        .replace(" ", "_")
    )

    special = {
        "all_elements": ("all_elements", "Elemental Damage"),
        "elemental_damage": ("all_elements", "Elemental Damage"),

        "physical_damage": ("physical_damage", "Physical Damage"),

        "blunt_attacks": ("blunt_attacks", "Blunt Attacks"),
        "geo_attacks": ("geo_attacks", "Geo Attacks"),

        "nightsoul": ("nightsoul", "Nightsoul"),
        "nightsoul_aligned_attacks": ("nightsoul", "Nightsoul"),

        "lunar": ("lunar", "Lunar Reactions"),

        "phec_+_geo_(crystallize)": (
            "crystallize_reaction",
            "PHEC + Geo (Crystallize)"
        ),
    }

    if lookup in special:
        emoji_key, display = special[lookup]
    else:
        emoji_key = lookup
        display = element.replace("_", " ").title()

    emoji = WARD_EMOJIS.get(emoji_key) or COLOURED_ELEMENT_EMOJIS.get(emoji_key)

    return f"{emoji} {display}" if emoji else display

def build_main_embed(ward_id: str):
    data = get_ward(ward_id)

    if data is None:
        return None

    embed = discord.Embed(
        title=f"Wards • {data["name"]}",
        colour=WARD_COLOURS[data["colour"]]
    )

    effective = data.get("effective", {})

    embed.add_field(
        name="**Effectiveness**",
        value=" ",
        inline=False
    )

    if effective.get("best"):
        embed.add_field(
            name="Best",
            value="\n".join(
                f"**{format_element(item)}**"
                for item in effective["best"]
            ) + "\n",
            inline=False
        )

    if effective.get("good"):
        embed.add_field(
            name="Good",
            value="\n".join(
                f"**{format_element(item)}**"
                for item in effective["good"]
            ) + "\n",
            inline=False
        )

    if data.get("ineffective"):
        embed.add_field(
            name="Ineffective",
            value="\n".join(
                f"**{format_element(item)}**"
                for item in data["ineffective"]
            ) + "\n\u200b",
            inline=False
        )

    elements = []
    values = []

    for element, value in data["coefficient"].items():
        elements.append(f"**{format_element(element)}**")

        if value is None:
            values.append("—")
        elif isinstance(value, (int, float)):
            values.append(f"×**{value}U**")
        else:
            values.append(str(value))

    embed.add_field(
        name="**Values**",
        value=" ",
        inline=False
    )

    embed.add_field(
        name="Source",
        value="\n".join(elements) + "\n\u200b",
        inline=True
    )

    embed.add_field(
        name="Ward Consumption",
        value="\n".join(values),
        inline=True
    )

    if ward_id != "geo":
        notes = format_notes(data["notes"])

        if len(notes) <= 1024:
            embed.add_field(
                name="**Notes**",
                value=notes,
                inline=False
            )
        else:
            split = notes.rfind("\n", 0, 1024)

            if split == -1:
                split = 1024

            embed.add_field(
                name="**Notes**",
                value=notes[:split],
                inline=False
            )

            embed.add_field(
                name="**Notes (continuation)**",
                value=notes[split + 1:],
                inline=False
            )

    embed.set_image(url=get_ward_url(data["emoji"]))

    return embed, data

def build_notes_embed(data):
    embed = discord.Embed(
        title=f"Notes • {data['name']}",
        description=format_notes(data["notes"]),
        colour=WARD_COLOURS[data["colour"]]
    )

    embed.set_image(url=get_ward_url(data["emoji"]))

    return embed

class WardView(discord.ui.View):
    def __init__(self, ward_id, ward_data, owner_id):
        super().__init__(timeout=None)
        self.ward_id = ward_id
        self.ward_data = ward_data
        self.owner_id = owner_id

    @discord.ui.button(
        label="Notes →",
        style=discord.ButtonStyle.secondary
    )
    async def notes(self, interaction, button):

        if interaction.user.id != self.owner_id:
            await send_not_your_command(interaction)
            return

        embed = build_notes_embed(self.ward_data)

        await interaction.response.edit_message(
            embed=embed,
            view=WardNotesView(
                self.ward_id,
                self.ward_data,
                self.owner_id
            )
        )


class WardNotesView(discord.ui.View):
    def __init__(self, ward_id, ward_data, owner_id):
        super().__init__(timeout=None)
        self.ward_id = ward_id
        self.ward_data = ward_data
        self.owner_id = owner_id

    @discord.ui.button(
        label="← Back",
        style=discord.ButtonStyle.secondary
    )
    async def back(self, interaction, button):

        if interaction.user.id != self.owner_id:
            await send_not_your_command(interaction)
            return

        embed, _ = build_main_embed(self.ward_id)

        await interaction.response.edit_message(
            embed=embed,
            view=WardView(
                self.ward_id,
                self.ward_data,
                self.owner_id
            )
        )



class Ward(commands.Cog):
    def __init__(self, bot):
        self.bot = bot


    @app_commands.allowed_installs(
        users=True,
        guilds=True
    )
    @app_commands.allowed_contexts(
        guilds=True,
        dms=True,
        private_channels=True
    )
    @app_commands.command(
        name="ward",
        description="Shows information about a ward."
    )
    @app_commands.describe(
        ward="The ward to view."
    )
    @app_commands.autocomplete(ward=ward_autocomplete)
    async def ward(
            self,
            interaction: discord.Interaction,
            ward: str
    ):
        original_ward = ward

        result = build_main_embed(ward.lower())

        if result is None:
            await send_interaction_error(
                interaction,
                "Ward Not Found.",
                f"The ward `{original_ward}` could not be found.",
                "not_found"
            )
            return

        embed, data = result

        view = (
            WardView(
                ward.lower(),
                data,
                interaction.user.id
            )
            if data["emoji"] == "Geo"
            else None
        )

        await interaction.response.send_message(
            embed=embed,
            view=view
        )

    @commands.command(
        name="ward",
        aliases=["wd"]
    )
    async def ward_prefix(
            self,
            ctx,
            *,
            ward: str | None = None
    ):
        if ward is None:
            await send_missing_argument(
                ctx,
                f"{ctx.prefix}ward <ward>",
                "ward"
            )
            return

        original_ward = ward

        result = build_main_embed(ward.lower())

        if result is None:
            await send_not_found(
                ctx,
                f"The ward `{original_ward}` could not be found."
            )
            return

        embed, data = result

        view = (
            WardView(
                ward.lower(),
                data,
                ctx.author.id
            )
            if data["emoji"] == "Geo"
            else None
        )

        await ctx.send(
            embed=embed,
            view=view
        )


async def setup(bot):
    await bot.add_cog(Ward(bot))