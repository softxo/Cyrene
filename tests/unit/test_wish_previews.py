import unittest
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from utils.web.wish_previews import (
    _artwork,
    clean_wish_title,
    enrich_wish_previews,
    matching_notice,
    parse_wish_preview,
    signature_wish_previews,
    upcoming_pages,
)

NOW = int(datetime(2026, 11, 6, tzinfo=timezone.utc).timestamp())


def card(name, rarity=5):
    return f'<div class="card-container mini-card"><span class="card-image-container card-quality-{rarity}"><img alt="{name}" data-src="https://static.wikia.nocookie.net/gensin-impact/images/a/ab/{name}_Icon.png"></span></div>'


def page(kind="Character Event", four_stars=False):
    return (
        '<table><tr><td data-source="time_start">November 24, 2026 18:00 (Server Time)</td><td data-source="time_end">TBA</td></tr></table>'
        + f'<div data-source="type">{kind}</div><table class="wish-pool-table"><tr><td>'
        + card("Zibai")
        + (card("Fischl", 4) if four_stars else card("Unknown Character", 1))
        + "</td></tr></table>"
        + '<table class="wish-pool-table"><tr><td>'
        + card("Diluc")
        + "</td></tr></table>"
    )


class WishPreviewTests(unittest.IsolatedAsyncioTestCase):
    def test_only_upcoming_index_links_are_read(self):
        markup = '<h3 id="Current_Event_Wishes"></h3><a href="/wiki/Old/2026-10-01">Old</a><h3><span id="Upcoming_Event_Wishes">Upcoming</span></h3><table><tr><td>Character Event</td><td><a href="/wiki/Harmonious_Abundance/2026-11-24">Next</a></td></tr><tr><td>Chronicled</td><td><a href="/wiki/Collection/2026-11-24">Collection</a></td></tr></table><h2>History</h2><a href="/wiki/Past/2025-01-01">Past</a>'
        self.assertEqual(
            upcoming_pages(markup),
            [("Harmonious Abundance/2026-11-24", 301), ("Collection/2026-11-24", 500)],
        )

    def test_unknown_items_and_standard_pool_are_excluded(self):
        banner = parse_wish_preview(page(), "Next/2026-11-24", 301, "os_euro", NOW)
        self.assertEqual([item["name"] for item in banner["r5_up_items"]], ["Zibai"])
        self.assertEqual(banner["r4_up_items"], [])
        self.assertEqual(banner["end_time"], 0)

    def test_server_offsets_and_past_starts(self):
        eu = parse_wish_preview(page(), "Next/2026-11-24", 301, "os_euro", NOW)
        asia = parse_wish_preview(page(), "Next/2026-11-24", 301, "os_asia", NOW)
        usa = parse_wish_preview(page(), "Next/2026-11-24", 301, "os_usa", NOW)
        self.assertEqual(eu["start_time"] - asia["start_time"], 7 * 3600)
        self.assertEqual(usa["start_time"] - eu["start_time"], 6 * 3600)
        self.assertIsNone(parse_wish_preview(page(), "Next", 301, "os_euro", eu["start_time"]))

    def test_infobox_identifies_chronicled(self):
        banner = parse_wish_preview(
            page("Chronicled"), "Collection/2026-11-24", 301, "os_euro", NOW
        )
        self.assertEqual(banner["banner_type"], 500)

    def test_old_or_partially_matching_notices_do_not_replace_art(self):
        banner = parse_wish_preview(page(four_stars=True), "Next/2026-11-24", 301, "os_euro", NOW)

        def notice(content):
            return SimpleNamespace(
                subtitle="Event Wish Next", content=content, banner="https://example.test/full.png"
            )

        self.assertIsNone(matching_notice(banner, [notice("2026/10/24 Zibai Fischl")], "os_euro"))
        self.assertIsNone(
            matching_notice(banner, [notice("2026/11/24 Zibai another character")], "os_euro")
        )
        correct = notice('<t class="t_lc">2026/11/24 18:00</t> Zibai Fischl')
        self.assertIs(matching_notice(banner, [correct], "os_euro"), correct)

    async def test_preview_upgrades_without_duplicating_calendar_banner(self):
        wiki = parse_wish_preview(page(four_stars=True), "Next/2026-11-24", 301, "os_euro", NOW)
        wiki["preview_art"] = [{"name": "Zibai", "icon": "/static/preview.png"}]
        official = SimpleNamespace(
            subtitle="Event Wish Next",
            content="2026/11/24 Zibai Fischl",
            banner="https://example.test/full.png",
        )
        calendar = deepcopy(wiki)
        calendar["banner_id"] = "official"
        with patch(
            "utils.web.wish_previews.wiki_wish_previews", AsyncMock(return_value=[deepcopy(wiki)])
        ):
            banners = [calendar]
            await enrich_wish_previews(banners, [official], "os_euro", NOW)
            self.assertEqual(len(banners), 1)
            self.assertEqual(banners[0]["image"], official.banner)
            self.assertEqual(banners[0]["banner_id"], "official")

    async def test_missing_notice_keeps_splash_and_hides_unannounced_four_stars(self):
        wiki = parse_wish_preview(page(four_stars=True), "Next/2026-11-24", 301, "os_euro", NOW)
        wiki["preview_art"] = [{"name": "Zibai", "icon": "/static/preview.png"}]
        active = dict(deepcopy(wiki), start_time=NOW - 1, image="/static/current.png")
        with patch("utils.web.wish_previews.wiki_wish_previews", AsyncMock(return_value=[wiki])):
            banners = [active]
            await enrich_wish_previews(banners, [], "os_euro", NOW)
            self.assertEqual(banners[0]["image"], "/static/current.png")
            self.assertIsNone(banners[1]["image"])
            self.assertEqual(banners[1]["r4_up_items"], [])
            self.assertTrue(banners[1]["preview_art"])

    async def test_official_notice_can_upgrade_before_wiki_four_stars_are_filled(self):
        wiki = parse_wish_preview(page(), "Next/2026-11-24", 301, "os_euro", NOW)
        wiki["preview_art"] = [{"name": "Zibai", "icon": "/static/preview.png"}]
        notice = SimpleNamespace(
            subtitle="Event Wish Next",
            content="2026/11/24 Zibai with featured 4-star characters",
            banner="https://example.test/full.png",
        )
        with patch("utils.web.wish_previews.wiki_wish_previews", AsyncMock(return_value=[wiki])):
            banners = []
            await enrich_wish_previews(banners, [notice], "os_euro", NOW)
            self.assertEqual(banners[0]["image"], notice.banner)

    def test_title_prefixes_and_quotes_are_normalised(self):
        self.assertEqual(
            clean_wish_title('Event Wish - "Chanson of Many Waters"'), "Chanson of Many Waters"
        )
        self.assertEqual(
            clean_wish_title("<color=#fff>Event Event Wish</color> - Chanson of Many Waters"),
            "Chanson of Many Waters",
        )
        self.assertEqual(
            clean_wish_title(
                "Event Wish " + chr(8212) + " " + chr(8220) + "Chanson of Many Waters" + chr(8221)
            ),
            "Chanson of Many Waters",
        )

    def test_signature_weapon_pair_and_chronicled_lineup(self):
        def banner(name, kind=301):
            return dict(
                banner_id=name,
                title="Next",
                banner_type=kind,
                is_upcoming=True,
                start_time=2000000000,
                end_time=0,
                r5_up_items=[dict(name=name, icon="/static/icon.png")],
            )

        characters = [banner("Zibai"), banner("Linnea")]
        derived = signature_wish_previews(characters)
        self.assertEqual(len(derived), 1)
        self.assertEqual(
            [item["name"] for item in derived[0]["r5_up_items"]],
            ["Lightbearing Moonshard", "Golden Frostbound Oath"],
        )
        self.assertEqual(derived[0]["banner_type"], 302)
        self.assertEqual(derived[0]["start_time"], characters[0]["start_time"])
        self.assertEqual(signature_wish_previews(characters + [dict(derived[0])]), [])
        chronicled = signature_wish_previews([banner("Varesa", 500)])
        self.assertEqual(chronicled[0]["preview_kind"], "weapons")
        self.assertEqual(chronicled[0]["r5_up_items"][0]["name"], "Vivid Notions")

    async def test_chronicled_art_uses_transparent_game_slices(self):
        catalogue = SimpleNamespace(
            get=AsyncMock(
                return_value={"images": {"filename_gachaSlice": "UI_Gacha_AvatarIcon_Varesa"}}
            )
        )
        with patch("utils.web.wish_previews.GenshinDB", return_value=catalogue):
            art = await _artwork(None, {"name": "Varesa", "icon": "/static/icon.png"}, 500)
        self.assertEqual(art, "https://enka.network/ui/UI_Gacha_AvatarIcon_Varesa.png")
