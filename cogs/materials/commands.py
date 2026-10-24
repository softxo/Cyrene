import json
import discord
from pathlib import Path
from discord.ext import commands
from discord import app_commands
from utils.character.characters import get_character
from utils.character.character_autocomplete import character_autocomplete
from utils.icons import get_character_icon, get_material_emoji
from utils.constants.costs import ASCENSION_MORA_COSTS, LEVEL_MORA_COSTS, LEVEL_EXP_COSTS, TALENT_MORA_COSTS
from collections import defaultdict
from utils.errors.error_handler import send_interaction_error, send_not_found, send_not_your_command



MATERIALS_PATH = Path("data/materials")


def load_json(filename):
    with open(
        MATERIALS_PATH / filename,
        encoding="utf-8"
    ) as f:
        return json.load(f)


GEMS = load_json("gems.json")
BOOKS = load_json("books.json")
COMMON = load_json("common_drops.json")
BOSSES = load_json("boss_drops.json")
WEEKLY = load_json("weekly_drops.json")
LOCAL_SPECIALTIES = load_json("local_specialties.json")
MISC = load_json("miscellaneous.json")
ASCENSION_MORA_TOTAL = sum(ASCENSION_MORA_COSTS)
LEVEL_MORA_TOTAL = sum(LEVEL_MORA_COSTS)
SINGLE_TALENT_MORA_TOTAL = sum(TALENT_MORA_COSTS)


def get_ascension_text(data, emojis):
    materials = data["materials"]
    ascension = materials["ascension"]

    gem = GEMS[ascension["gem"]["id"]]
    boss = BOSSES[ascension["boss"]["id"]]
    local = LOCAL_SPECIALTIES[ascension["local_specialty"]["id"]]
    common = COMMON[ascension["common"]["id"]]
    mora = MISC["mora"]

    gem_sliver_emoji = get_material_emoji(emojis, gem["tiers"]["sliver"]["emoji"])
    gem_fragment_emoji = get_material_emoji(emojis, gem["tiers"]["fragment"]["emoji"])
    gem_chunk_emoji = get_material_emoji(emojis, gem["tiers"]["chunk"]["emoji"])
    gem_gemstone_emoji = get_material_emoji(emojis, gem["tiers"]["gemstone"]["emoji"])

    boss_emoji = get_material_emoji(emojis, boss["emoji"])
    local_emoji = get_material_emoji(emojis, local["emoji"])

    common_tier1_emoji = get_material_emoji(emojis, common["tiers"]["tier1"]["emoji"])
    common_tier2_emoji = get_material_emoji(emojis, common["tiers"]["tier2"]["emoji"])
    common_tier3_emoji = get_material_emoji(emojis, common["tiers"]["tier3"]["emoji"])

    mora_emoji = get_material_emoji(emojis, mora["emoji"])

    return (
        f"{gem_sliver_emoji} **{gem['tiers']['sliver']['name']}** ×{ascension['gem']['sliver']}\n"
        f"{gem_fragment_emoji} **{gem['tiers']['fragment']['name']}** ×{ascension['gem']['fragment']}\n"
        f"{gem_chunk_emoji} **{gem['tiers']['chunk']['name']}** ×{ascension['gem']['chunk']}\n"
        f"{gem_gemstone_emoji} **{gem['tiers']['gemstone']['name']}** ×{ascension['gem']['gemstone']}\n\n"
        
        f"{boss_emoji} **{boss['name']}** ×{ascension['boss']['amount']}\n\n"

        f"{local_emoji} **{local['name']}** ×{ascension['local_specialty']['amount']}\n\n"

        f"{common_tier1_emoji} **{common['tiers']['tier1']['name']}** ×{ascension['common']['tier1']}\n"
        f"{common_tier2_emoji} **{common['tiers']['tier2']['name']}** ×{ascension['common']['tier2']}\n"
        f"{common_tier3_emoji} **{common['tiers']['tier3']['name']}** ×{ascension['common']['tier3']}\n\n"
        
        f"{mora_emoji} **{mora['name']}** ×{ASCENSION_MORA_TOTAL:,}"
    )

def get_ascension_misc_text(emojis):
    wit = MISC["heros_wit"]
    adventure = MISC["adventurers_experience"]
    wanderer = MISC["wanderers_advice"]
    mora = MISC["mora"]

    wit_emoji = get_material_emoji(emojis, wit["emoji"])
    adventure_emoji = get_material_emoji(emojis, adventure["emoji"])
    wanderer_emoji = get_material_emoji(emojis, wanderer["emoji"])
    mora_emoji = get_material_emoji(emojis, mora["emoji"])

    return (
        f"{wit_emoji} **{wit['name']}** ×{LEVEL_EXP_COSTS['heros_wit']:,}\n"
        f"{adventure_emoji} **{adventure['name']}** ×{LEVEL_EXP_COSTS['adventurers_experience']}\n"
        f"{wanderer_emoji} **{wanderer['name']}** ×{LEVEL_EXP_COSTS['wanderers_advice']}\n\n"
        
        f"{mora_emoji} **{mora['name']}** ×{LEVEL_MORA_TOTAL:,}"
    )

def get_total_mora_ascension(emojis):
    mora = MISC["mora"]

    mora_emoji = get_material_emoji(emojis, mora["emoji"])

    return (f"{mora_emoji} **{mora['name']}** ×{LEVEL_MORA_TOTAL+ASCENSION_MORA_TOTAL:,}")

def build_ascension_embed(data, emojis):
    embed = discord.Embed(
        title=f"Ascension Materials • {data['name']}",
        colour=discord.Colour.from_str(data["colour"])
    )

    embed.set_thumbnail(url="attachment://character.png")

    embed.add_field(
        name="Character Ascension • Lv. 1 → 90",
        value=get_ascension_text(data, emojis) + "\n\u200b",
        inline=False
    )

    embed.add_field(
        name="Character Levels • Lv. 1 → 90",
        value=get_ascension_misc_text(emojis) + "\n\u200b",
        inline=False
    )

    embed.add_field(
        name="Total Mora • Lv. 1 → 90",
        value=get_total_mora_ascension(emojis),
        inline=False
    )

    return embed


def get_talent_text(data, emojis, talent_count=1):
    materials = data["materials"]
    talents = materials["talents"]

    mora = MISC["mora"]
    book = BOOKS[talents['book']['id']]
    common = COMMON[talents['common']['id']]
    weekly = WEEKLY[talents['weekly_boss']['id']]
    weekly_drop = weekly["drops"][talents["weekly_boss"]["material"]]
    crown = MISC[talents["crown"]["id"]]

    book_tier1_emoji = get_material_emoji(emojis, book["tiers"]["teachings"]["emoji"])
    book_tier2_emoji = get_material_emoji(emojis, book["tiers"]["guide"]["emoji"])
    book_tier3_emoji = get_material_emoji(emojis, book["tiers"]["philosophies"]["emoji"])

    common_tier1_emoji = get_material_emoji(emojis, common["tiers"]["tier1"]["emoji"])
    common_tier2_emoji = get_material_emoji(emojis, common["tiers"]["tier2"]["emoji"])
    common_tier3_emoji = get_material_emoji(emojis, common["tiers"]["tier3"]["emoji"])

    weekly_emoji = get_material_emoji(emojis, weekly["emoji"])
    weekly_drop_emoji = get_material_emoji(emojis, weekly_drop["emoji"])

    crown_emoji = get_material_emoji(emojis, crown["emoji"])

    mora_emoji = get_material_emoji(emojis, mora["emoji"])

    return (
        f"{book_tier1_emoji} **{book['tiers']['teachings']['name']}** ×{talents['book']['teachings'] // 3 * talent_count}\n"
        f"{book_tier2_emoji} **{book['tiers']['guide']['name']}** ×{talents['book']['guide'] // 3 * talent_count}\n"
        f"{book_tier3_emoji} **{book['tiers']['philosophies']['name']}** ×{talents['book']['philosophies'] // 3 * talent_count}\n\n"

        f"{common_tier1_emoji} **{common['tiers']['tier1']['name']}** ×{talents['common']['tier1'] // 3 * talent_count}\n"
        f"{common_tier2_emoji} **{common['tiers']['tier2']['name']}** ×{talents['common']['tier2'] // 3 * talent_count}\n"
        f"{common_tier3_emoji} **{common['tiers']['tier3']['name']}** ×{talents['common']['tier3'] // 3 * talent_count}\n\n"

        f"{weekly_drop_emoji} **{weekly_drop['name']}** ×{talents['weekly_boss']['amount'] // 3 * talent_count}\n\n"
        
        f"{crown_emoji} **{crown['name']}** ×{talents['crown']['amount'] // 3 * talent_count}\n\n"

        f"{mora_emoji} **{mora['name']}** ×{SINGLE_TALENT_MORA_TOTAL * talent_count:,}"
    )

def build_talents_embed(data, emojis, talent_count=1):
    embed = discord.Embed(
        title=f"Talent Materials • {data['name']}",
        colour=discord.Colour.from_str(data["colour"])
    )

    embed.set_thumbnail(url="attachment://character.png")

    embed.add_field(
        name=f"{talent_count}/3 Max Talents • Lv. 1 → 10",
        value=get_talent_text(data, emojis, talent_count),
        inline=False
    )

    return embed

def get_total_materials(data, talent_count=1):
    totals = defaultdict(int)

    ascension = data["materials"]["ascension"]
    talents = data["materials"]["talents"]

    totals["mora"] += ASCENSION_MORA_TOTAL + LEVEL_MORA_TOTAL
    totals["mora"] += SINGLE_TALENT_MORA_TOTAL * talent_count

    totals["heros_wit"] += LEVEL_EXP_COSTS["heros_wit"]
    totals["adventurers_experience"] += LEVEL_EXP_COSTS["adventurers_experience"]
    totals["wanderers_advice"] += LEVEL_EXP_COSTS["wanderers_advice"]

    totals[(ascension["gem"]["id"], "sliver")] += ascension["gem"]["sliver"]
    totals[(ascension["gem"]["id"], "fragment")] += ascension["gem"]["fragment"]
    totals[(ascension["gem"]["id"], "chunk")] += ascension["gem"]["chunk"]
    totals[(ascension["gem"]["id"], "gemstone")] += ascension["gem"]["gemstone"]

    totals[ascension["boss"]["id"]] += ascension["boss"]["amount"]

    totals[ascension["local_specialty"]["id"]] += ascension["local_specialty"]["amount"]

    totals[(ascension["common"]["id"], "tier1")] += ascension["common"]["tier1"]
    totals[(ascension["common"]["id"], "tier2")] += ascension["common"]["tier2"]
    totals[(ascension["common"]["id"], "tier3")] += ascension["common"]["tier3"]

    totals[(talents["book"]["id"], "teachings")] += talents["book"]["teachings"] // 3 * talent_count
    totals[(talents["book"]["id"], "guide")] += talents["book"]["guide"] // 3 * talent_count
    totals[(talents["book"]["id"], "philosophies")] += talents["book"]["philosophies"] // 3 * talent_count

    totals[(talents["common"]["id"], "tier1")] += talents["common"]["tier1"] // 3 * talent_count
    totals[(talents["common"]["id"], "tier2")] += talents["common"]["tier2"] // 3 * talent_count
    totals[(talents["common"]["id"], "tier3")] += talents["common"]["tier3"] // 3 * talent_count

    totals[(talents["weekly_boss"]["id"], talents["weekly_boss"]["material"])] += talents["weekly_boss"]["amount"] // 3 * talent_count

    totals["crown_of_insight"] += talents["crown"]["amount"] // 3 * talent_count

    return totals

def format_total_materials(data, emojis, talent_count=1):
    totals = get_total_materials(data, talent_count)
    lines = []

    gem_id = data["materials"]["ascension"]["gem"]["id"]
    gem = GEMS[gem_id]

    for tier in ("sliver", "fragment", "chunk", "gemstone"):
        amount = totals[(gem_id, tier)]
        emoji = get_material_emoji(emojis, gem["tiers"][tier]["emoji"])
        name = gem["tiers"][tier]["name"]
        lines.append(f"{emoji} **{name}** ×{amount}")

    lines.append("")

    boss_id = data["materials"]["ascension"]["boss"]["id"]
    boss = BOSSES[boss_id]

    boss_emoji = get_material_emoji(emojis, boss["emoji"])

    lines.append(
        f"{boss_emoji} **{boss['name']}** ×{totals[boss_id]}"
    )

    lines.append("")

    local_id = data["materials"]["ascension"]["local_specialty"]["id"]
    local = LOCAL_SPECIALTIES[local_id]

    local_emoji = get_material_emoji(emojis, local["emoji"])

    lines.append(
        f"{local_emoji} **{local['name']}** ×{totals[local_id]}"
    )

    lines.append("")

    common_id = data["materials"]["ascension"]["common"]["id"]
    common = COMMON[common_id]

    for tier in ("tier1", "tier2", "tier3"):
        amount = totals[(common_id, tier)]
        emoji = get_material_emoji(emojis, common["tiers"][tier]["emoji"])
        name = common["tiers"][tier]["name"]

        lines.append(f"{emoji} **{name}** ×{amount}")

    lines.append("")

    book_id = data["materials"]["talents"]["book"]["id"]
    book = BOOKS[book_id]

    for tier in ("teachings", "guide", "philosophies"):
        amount = totals[(book_id, tier)]
        emoji = get_material_emoji(emojis, book["tiers"][tier]["emoji"])
        name = book["tiers"][tier]["name"]

        lines.append(f"{emoji} **{name}** ×{amount}")

    lines.append("")

    weekly_id = data["materials"]["talents"]["weekly_boss"]["id"]
    weekly = WEEKLY[weekly_id]

    drop_id = data["materials"]["talents"]["weekly_boss"]["material"]
    drop = weekly["drops"][drop_id]

    weekly_emoji = get_material_emoji(emojis, drop["emoji"])

    lines.append(
        f"{weekly_emoji} **{drop['name']}** ×{totals[(weekly_id, drop_id)]}"
    )

    lines.append("")


    wit = MISC["heros_wit"]
    adventure = MISC["adventurers_experience"]
    wanderer = MISC["wanderers_advice"]

    lines.append(
        f"{get_material_emoji(emojis, wit['emoji'])} **{wit['name']}** ×{totals['heros_wit']}"
    )

    lines.append(
        f"{get_material_emoji(emojis, adventure['emoji'])} **{adventure['name']}** ×{totals['adventurers_experience']}"
    )

    lines.append(
        f"{get_material_emoji(emojis, wanderer['emoji'])} **{wanderer['name']}** ×{totals['wanderers_advice']}"
    )

    lines.append("")


    crown = MISC["crown_of_insight"]

    lines.append(
        f"{get_material_emoji(emojis, crown['emoji'])} **{crown['name']}** ×{totals['crown_of_insight']}"
    )

    lines.append("")


    mora = MISC["mora"]

    lines.append(
        f"{get_material_emoji(emojis, mora['emoji'])} **{mora['name']}** ×{totals['mora']:,}"
    )

    return "\n".join(lines)

def build_total_embed(data, emojis, talent_count=1):
    embed = discord.Embed(
        title=f"Total Materials • {data['name']}",
        colour=discord.Colour.from_str(data["colour"])
    )

    embed.add_field(
        name=f"Character Lv. 90 • {talent_count}/3 Talents Lv. 10",
        value="",
        inline=False
    )

    embed.set_thumbnail(url="attachment://character.png")

    totals = format_total_materials(data, emojis, talent_count)

    sections = totals.split("\n\n")

    for section in sections:
        if section.strip():
            embed.add_field(
                name="\u200b",
                value=section,
                inline=False
            )

    embed.set_footer(
        text="Talent materials scale with number of maxed talents"
    )

    return embed

class MaterialsView(discord.ui.View):
    def __init__(self, data, emojis, user_id):
        super().__init__(timeout=300)

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
            self.ascension_embed = build_ascension_embed(
                self.data,
                self.emojis
            )
            return self.ascension_embed

        if page == "talents":
            self.talent_embed = build_talents_embed(
                self.data,
                self.emojis,
                self.talent_page_count
            )
            return self.talent_embed

        if page == "total":
            self.total_embed = build_total_embed(
                self.data,
                self.emojis,
                self.total_page_count
            )
            return self.total_embed

        raise ValueError(f"Unknown page: {page}")

    async def ascension_callback(self, interaction):
        await self.change_page(interaction, "ascension")

    async def talents_callback(self, interaction):
        await self.change_page(interaction, "talents")

    async def total_callback(self, interaction):
        await self.change_page(interaction, "total")

    async def interaction_check(self, interaction: discord.Interaction):
        if interaction.user.id != self.user_id:
            await send_not_your_command(interaction)
            return False

        return True

    async def update_talent(self, interaction, count):
        self.talent_page_count = count

        self.show_talent_buttons()

        await interaction.response.edit_message(
            embed=self.refresh_embed("talents"),
            view=self
        )

    async def update_total(self, interaction, count):
        self.total_page_count = count

        self.show_total_buttons()

        await interaction.response.edit_message(
            embed=self.refresh_embed("total"),
            view=self
        )


    def show_ascension_buttons(self):
        self.clear_items()

        button = discord.ui.Button(
            label="Talent →",
            style=discord.ButtonStyle.secondary
        )

        button.callback = self.talents_callback

        self.add_item(button)


    def show_talent_buttons(self):
        self.clear_items()

        ascension = discord.ui.Button(
            label="← Ascension",
            style=discord.ButtonStyle.secondary
        )

        crown_emoji = get_material_emoji(
            self.emojis,
            MISC["crown_of_insight"]["emoji"]
        )

        talent1 = discord.ui.Button(
            label="1 Talent",
            emoji=crown_emoji,
            style=(
                discord.ButtonStyle.success
                if self.talent_page_count == 1
                else discord.ButtonStyle.secondary
            )
        )

        talent2 = discord.ui.Button(
            label="2 Talents",
            emoji=crown_emoji,
            style=(
                discord.ButtonStyle.success
                if self.talent_page_count == 2
                else discord.ButtonStyle.secondary
            )
        )

        talent3 = discord.ui.Button(
            label="3 Talents",
            emoji=crown_emoji,
            style=(
                discord.ButtonStyle.success
                if self.talent_page_count == 3
                else discord.ButtonStyle.secondary
            )
        )

        total = discord.ui.Button(
            label="Total →",
            style=discord.ButtonStyle.secondary
        )

        ascension.callback = self.ascension_callback

        talent1.callback = lambda i: self.update_talent(i, 1)
        talent2.callback = lambda i: self.update_talent(i, 2)
        talent3.callback = lambda i: self.update_talent(i, 3)

        total.callback = self.total_callback

        self.add_item(ascension)
        self.add_item(talent1)
        self.add_item(talent2)
        self.add_item(talent3)
        self.add_item(total)

    def show_total_buttons(self):
        self.clear_items()

        back = discord.ui.Button(
            label="← Talent",
            style=discord.ButtonStyle.secondary
        )

        crown_emoji = get_material_emoji(
            self.emojis,
            MISC["crown_of_insight"]["emoji"]
        )

        talent1 = discord.ui.Button(
            label="1 Talent",
            emoji=crown_emoji,
            style=(
                discord.ButtonStyle.success
                if self.total_page_count == 1
                else discord.ButtonStyle.secondary
            )
        )

        talent2 = discord.ui.Button(
            label="2 Talents",
            emoji=crown_emoji,
            style=(
                discord.ButtonStyle.success
                if self.total_page_count == 2
                else discord.ButtonStyle.secondary
            )
        )

        talent3 = discord.ui.Button(
            label="3 Talents",
            emoji=crown_emoji,
            style=(
                discord.ButtonStyle.success
                if self.total_page_count == 3
                else discord.ButtonStyle.secondary
            )
        )

        talent1.callback = lambda i: self.update_total(i, 1)
        talent2.callback = lambda i: self.update_total(i, 2)
        talent3.callback = lambda i: self.update_total(i, 3)
        back.callback = self.talents_callback

        self.add_item(back)
        self.add_item(talent1)
        self.add_item(talent2)
        self.add_item(talent3)

    async def change_page(self, interaction, page):
        if page == "ascension":
            self.show_ascension_buttons()
        elif page == "talents":
            self.show_talent_buttons()
        elif page == "total":
            self.show_total_buttons()

        await interaction.response.edit_message(
            embed=self.refresh_embed(page),
            view=self
        )



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
            ctx: commands.Context | None = None
    ):
        original_character = character

        character = character.lower().replace(" ", "_")

        data = get_character(character)

        if data is None:
            if interaction is not None:
                await send_interaction_error(
                    interaction,
                    "Character Not Found.",
                    f"The character `{original_character}` could not be found.",
                    "not_found",
                )
            elif ctx is not None:
                await send_not_found(
                    ctx,
                    f"The character `{original_character}` could not be found.",
                )

            return

        thumbnail = discord.File(
            get_character_icon(data["id"]),
            filename="character.png"
        )

        view = MaterialsView(
            data,
            self.bot.application_emojis,
            user_id
        )

        view.show_ascension_buttons()

        await destination.send(
            embed=view.ascension_embed,
            file=thumbnail,
            view=view
        )

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
        name="materials",
        description="Shows a character's Ascension and Talent materials."
    )
    @app_commands.autocomplete(character=character_autocomplete)
    async def materials_slash(
        self,
        interaction: discord.Interaction,
        character: str
    ):
        await interaction.response.defer()

        await self._send_materials(
            interaction.followup,
            interaction.user.id,
            character,
            interaction=interaction
        )

    @commands.command(
        name="materials",
        aliases=["mats"]
    )
    async def materials(
        self,
        ctx: commands.Context,
        *,
        character: str
    ):
        await self._send_materials(
            ctx,
            ctx.author.id,
            character,
            ctx=ctx
        )

async def setup(bot):
    await bot.add_cog(Materials(bot))
