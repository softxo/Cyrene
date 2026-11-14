from collections import defaultdict

import discord
from discord import app_commands
from discord.ext import commands

from bot.utils.characters.characters import character_autocomplete, get_character
from bot.utils.errors.error_handler import (
    lookup_entity,
)
from bot.utils.icons import get_character_icon, get_material_emoji
from bot.utils.materials.materials import (
    BOOKS,
    BOSSES,
    COMMON,
    GEMS,
    LOCAL_SPECIALTIES,
    MISC,
    WEEKLY,
    material_line,
    tier_lines,
)
from bot.utils.views import OwnedView
from shared.constants.costs import (
    ASCENSION_MORA_COSTS,
    LEVEL_EXP_COSTS,
    LEVEL_MORA_COSTS,
    TALENT_MORA_COSTS,
)

ASCENSION_MORA_TOTAL = sum(ASCENSION_MORA_COSTS)
LEVEL_MORA_TOTAL = sum(LEVEL_MORA_COSTS)
SINGLE_TALENT_MORA_TOTAL = sum(TALENT_MORA_COSTS)

GEM_TIERS = ("sliver", "fragment", "chunk", "gemstone")
COMMON_TIERS = ("tier1", "tier2", "tier3")
BOOK_TIERS = ("teachings", "guide", "philosophies")
LEVEL_BOOKS = ("heros_wit", "adventurers_experience", "wanderers_advice")


def get_ascension_text(data, emojis):
    ascension = data["materials"]["ascension"]
    gem = GEMS[ascension["gem"]["id"]]
    boss = BOSSES[ascension["boss"]["id"]]
    local = LOCAL_SPECIALTIES[ascension["local_specialty"]["id"]]
    common = COMMON[ascension["common"]["id"]]

    return "\n\n".join(
        (
            tier_lines(emojis, gem, ascension["gem"], GEM_TIERS),
            material_line(emojis, boss, ascension["boss"]["amount"]),
            material_line(emojis, local, ascension["local_specialty"]["amount"]),
            tier_lines(emojis, common, ascension["common"], COMMON_TIERS),
            material_line(emojis, MISC["mora"], f"{ASCENSION_MORA_TOTAL:,}"),
        )
    )


def get_ascension_misc_text(emojis):
    books = "\n".join(
        material_line(emojis, MISC[book], f"{LEVEL_EXP_COSTS[book]:,}") for book in LEVEL_BOOKS
    )

    return f"{books}\n\n{material_line(emojis, MISC['mora'], f'{LEVEL_MORA_TOTAL:,}')}"


def get_total_mora_ascension(emojis):
    total = LEVEL_MORA_TOTAL + ASCENSION_MORA_TOTAL

    return material_line(emojis, MISC["mora"], f"{total:,}")


def build_ascension_embed(data, emojis):
    embed = discord.Embed(
        title=f"Ascension Materials • {data['name']}",
        colour=discord.Colour.from_str(data["colour"]),
    )

    embed.set_thumbnail(url="attachment://character.png")

    embed.add_field(
        name="Character Ascension • Lv. 1 → 90",
        value=get_ascension_text(data, emojis) + "\n\u200b",
        inline=False,
    )

    embed.add_field(
        name="Character Levels • Lv. 1 → 90",
        value=get_ascension_misc_text(emojis) + "\n\u200b",
        inline=False,
    )

    embed.add_field(
        name="Total Mora • Lv. 1 → 90", value=get_total_mora_ascension(emojis), inline=False
    )

    return embed


def get_talent_text(data, emojis, talent_count=1):
    talents = data["materials"]["talents"]
    book = BOOKS[talents["book"]["id"]]
    common = COMMON[talents["common"]["id"]]
    weekly = WEEKLY[talents["weekly_boss"]["id"]]
    weekly_drop = weekly["drops"][talents["weekly_boss"]["material"]]
    crown = MISC[talents["crown"]["id"]]

    def scaled(amount):
        return amount // 3 * talent_count

    return "\n\n".join(
        (
            "\n".join(
                material_line(emojis, book["tiers"][tier], scaled(talents["book"][tier]))
                for tier in BOOK_TIERS
            ),
            "\n".join(
                material_line(emojis, common["tiers"][tier], scaled(talents["common"][tier]))
                for tier in COMMON_TIERS
            ),
            material_line(emojis, weekly_drop, scaled(talents["weekly_boss"]["amount"])),
            material_line(emojis, crown, scaled(talents["crown"]["amount"])),
            material_line(emojis, MISC["mora"], f"{SINGLE_TALENT_MORA_TOTAL * talent_count:,}"),
        )
    )


def build_talents_embed(data, emojis, talent_count=1):
    embed = discord.Embed(
        title=f"Talent Materials • {data['name']}", colour=discord.Colour.from_str(data["colour"])
    )

    embed.set_thumbnail(url="attachment://character.png")

    embed.add_field(
        name=f"{talent_count}/3 Max Talents • Lv. 1 → 10",
        value=get_talent_text(data, emojis, talent_count),
        inline=False,
    )

    return embed


def get_total_materials(data, talent_count=1):
    totals = defaultdict(int)
    ascension = data["materials"]["ascension"]
    talents = data["materials"]["talents"]

    totals["mora"] += ASCENSION_MORA_TOTAL + LEVEL_MORA_TOTAL
    totals["mora"] += SINGLE_TALENT_MORA_TOTAL * talent_count

    for book in LEVEL_BOOKS:
        totals[book] += LEVEL_EXP_COSTS[book]

    for tier in GEM_TIERS:
        totals[(ascension["gem"]["id"], tier)] += ascension["gem"][tier]

    totals[ascension["boss"]["id"]] += ascension["boss"]["amount"]
    totals[ascension["local_specialty"]["id"]] += ascension["local_specialty"]["amount"]

    for tier in COMMON_TIERS:
        totals[(ascension["common"]["id"], tier)] += ascension["common"][tier]
        totals[(talents["common"]["id"], tier)] += talents["common"][tier] // 3 * talent_count

    for tier in BOOK_TIERS:
        totals[(talents["book"]["id"], tier)] += talents["book"][tier] // 3 * talent_count

    totals[(talents["weekly_boss"]["id"], talents["weekly_boss"]["material"])] += (
        talents["weekly_boss"]["amount"] // 3 * talent_count
    )

    totals["crown_of_insight"] += talents["crown"]["amount"] // 3 * talent_count

    return totals


def format_total_materials(data, emojis, talent_count=1):
    totals = get_total_materials(data, talent_count)
    ascension = data["materials"]["ascension"]
    talents = data["materials"]["talents"]
    gem_id = ascension["gem"]["id"]
    boss_id = ascension["boss"]["id"]
    local_id = ascension["local_specialty"]["id"]
    common_id = ascension["common"]["id"]
    book_id = talents["book"]["id"]
    weekly_id = talents["weekly_boss"]["id"]
    drop_id = talents["weekly_boss"]["material"]

    def tiers(material_id, material, tier_names):
        return "\n".join(
            material_line(emojis, material["tiers"][tier], totals[(material_id, tier)])
            for tier in tier_names
        )

    sections = (
        tiers(gem_id, GEMS[gem_id], GEM_TIERS),
        material_line(emojis, BOSSES[boss_id], totals[boss_id]),
        material_line(emojis, LOCAL_SPECIALTIES[local_id], totals[local_id]),
        tiers(common_id, COMMON[common_id], COMMON_TIERS),
        tiers(book_id, BOOKS[book_id], BOOK_TIERS),
        material_line(emojis, WEEKLY[weekly_id]["drops"][drop_id], totals[(weekly_id, drop_id)]),
        "\n".join(material_line(emojis, MISC[book], totals[book]) for book in LEVEL_BOOKS),
        material_line(emojis, MISC["crown_of_insight"], totals["crown_of_insight"]),
        material_line(emojis, MISC["mora"], f"{totals['mora']:,}"),
    )

    return "\n\n".join(sections)


def build_total_embed(data, emojis, talent_count=1):
    embed = discord.Embed(
        title=f"Total Materials • {data['name']}", colour=discord.Colour.from_str(data["colour"])
    )

    embed.add_field(
        name=f"Character Lv. 90 • {talent_count}/3 Talents Lv. 10", value="", inline=False
    )

    embed.set_thumbnail(url="attachment://character.png")

    totals = format_total_materials(data, emojis, talent_count)
    sections = totals.split("\n\n")

    for section in sections:
        if section.strip():
            embed.add_field(name="\u200b", value=section, inline=False)

    embed.set_footer(text="Talent materials scale with number of maxed talents")

    return embed


class MaterialsView(OwnedView):
    def __init__(self, data, emojis, user_id):
        super().__init__(user_id, timeout=300)

        self.user_id = user_id
        self.talent_page_count = 1
        self.total_page_count = 1
        self.ascension_embed = build_ascension_embed(data, emojis)
        self.talent_embed = build_talents_embed(data, emojis, self.talent_page_count)
        self.data = data
        self.emojis = emojis
        self.total_embed = build_total_embed(data, emojis, self.total_page_count)

    def refresh_embed(self, page: str) -> discord.Embed:
        if page == "ascension":
            self.ascension_embed = build_ascension_embed(self.data, self.emojis)
            return self.ascension_embed

        if page == "talents":
            self.talent_embed = build_talents_embed(self.data, self.emojis, self.talent_page_count)
            return self.talent_embed

        if page == "total":
            self.total_embed = build_total_embed(self.data, self.emojis, self.total_page_count)
            return self.total_embed

        raise ValueError(f"Unknown page: {page}")

    async def ascension_callback(self, interaction):
        await self.change_page(interaction, "ascension")

    async def talents_callback(self, interaction):
        await self.change_page(interaction, "talents")

    async def total_callback(self, interaction):
        await self.change_page(interaction, "total")

    async def update_talent(self, interaction, count):
        self.talent_page_count = count

        self.show_talent_buttons()

        await interaction.response.edit_message(embed=self.refresh_embed("talents"), view=self)

    async def update_total(self, interaction, count):
        self.total_page_count = count

        self.show_total_buttons()

        await interaction.response.edit_message(embed=self.refresh_embed("total"), view=self)

    def show_ascension_buttons(self):
        self.clear_items()

        button = discord.ui.Button(label="Talent →", style=discord.ButtonStyle.secondary)
        button.callback = self.talents_callback

        self.add_item(button)

    def talent_count_buttons(self, selected, update):
        crown_emoji = get_material_emoji(self.emojis, MISC["crown_of_insight"]["emoji"])
        buttons = []

        for count in (1, 2, 3):
            button = discord.ui.Button(
                label=f"{count} Talent" if count == 1 else f"{count} Talents",
                emoji=crown_emoji,
                style=(
                    discord.ButtonStyle.success
                    if selected == count
                    else discord.ButtonStyle.secondary
                ),
            )
            button.callback = lambda interaction, count=count: update(interaction, count)
            buttons.append(button)

        return buttons

    def show_talent_buttons(self):
        self.clear_items()

        ascension = discord.ui.Button(label="← Ascension", style=discord.ButtonStyle.secondary)
        total = discord.ui.Button(label="Total →", style=discord.ButtonStyle.secondary)
        ascension.callback = self.ascension_callback
        total.callback = self.total_callback

        self.add_item(ascension)

        for button in self.talent_count_buttons(self.talent_page_count, self.update_talent):
            self.add_item(button)

        self.add_item(total)

    def show_total_buttons(self):
        self.clear_items()

        back = discord.ui.Button(label="← Talent", style=discord.ButtonStyle.secondary)
        back.callback = self.talents_callback

        self.add_item(back)

        for button in self.talent_count_buttons(self.total_page_count, self.update_total):
            self.add_item(button)

    async def change_page(self, interaction, page):
        if page == "ascension":
            self.show_ascension_buttons()
        elif page == "talents":
            self.show_talent_buttons()
        elif page == "total":
            self.show_total_buttons()

        await interaction.response.edit_message(embed=self.refresh_embed(page), view=self)


class Materials(commands.Cog):
    def __init__(self, bot):
        self.bot = bot

    async def _send_materials(
        self,
        destination,
        user_id: int,
        character: str,
        *,
        interaction: discord.Interaction | None = None,
        ctx: commands.Context | None = None,
    ):
        data = await lookup_entity(
            get_character, character, "Character", interaction=interaction, ctx=ctx
        )

        if data is None:
            return

        thumbnail = discord.File(get_character_icon(data["id"]), filename="character.png")
        view = MaterialsView(data, self.bot.application_emojis, user_id)

        view.show_ascension_buttons()

        await destination.send(embed=view.ascension_embed, file=thumbnail, view=view)

    @app_commands.allowed_installs(users=True, guilds=True)
    @app_commands.allowed_contexts(guilds=True, dms=True, private_channels=True)
    @app_commands.command(
        name="materials", description="Shows a character's Ascension and Talent materials."
    )
    @app_commands.autocomplete(character=character_autocomplete)
    async def materials_slash(self, interaction: discord.Interaction, character: str):
        await interaction.response.defer()

        await self._send_materials(
            interaction.followup, interaction.user.id, character, interaction=interaction
        )

    @commands.command(name="materials", aliases=["mats"])
    async def materials(self, ctx: commands.Context, *, character: str):
        await self._send_materials(ctx, ctx.author.id, character, ctx=ctx)


async def setup(bot):
    await bot.add_cog(Materials(bot))
