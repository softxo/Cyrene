import unittest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp

from utils.web import theater_elements as source


def season_markup(elements=("Hydro", "Cryo", "Anemo")):
    return (
        '<h3>Opening Characters</h3><img alt="Pyro">'
        '<h3><span id="Alternate_Cast_Elements">Alternate Cast Elements</span></h3>'
        + "".join(f'<a title="{element}"><img alt="{element}"></a>' for element in elements)
        + '<h3>Special Guest Stars</h3><img alt="Electro"><img alt="Geo">'
    )


def cast_markup(count=6):
    cards = "".join(
        f'<div class="card-container"><span class="card-image-container card-quality-{5 if i % 2 == 0 else 4} card-element-hydro">'
        f'<img alt="Character {i}" src="data:image/gif;base64,blank" '
        f'data-src="https://static.wikia.nocookie.net/test/Character_{i}.png"></span>'
        f'<span class="card-icon"><img alt="Hydro"></span>'
        f'<span class="card-text">Character {i}</span></div>'
        for i in range(count)
    )
    return '<h3><span id="Opening_Characters">Opening Characters</span></h3>' + cards


class ElementParsingTests(unittest.TestCase):
    def test_opening_cast_reads_portraits_without_guest_stars_or_element_icons(self):
        markup = (
            cast_markup()
            + season_markup()
            + "<h3>Guests</h3>"
            + cast_markup().replace("Opening_Characters", "Guests")
        )
        cast = source.parse_opening_cast(markup)
        self.assertEqual(len(cast), 6)
        self.assertEqual(cast[0]["name"], "Character 0")
        self.assertEqual(cast[0]["rarity"], 5)
        self.assertEqual(cast[1]["rarity"], 4)
        self.assertEqual(cast[0]["element"], "Hydro")
        self.assertTrue(cast[0]["icon"].startswith("https://static.wikia.nocookie.net/"))

    def test_incomplete_cast_and_untrusted_images_are_rejected(self):
        for markup in [
            cast_markup(5),
            cast_markup().replace("static.wikia.nocookie.net", "example.com"),
        ]:
            self.assertEqual(source.parse_opening_cast(markup), [])

    def test_reads_allowed_section_only_and_deduplicates_icons_and_links(self):
        self.assertEqual(source.parse_theater_elements(season_markup()), ("Hydro", "Cryo", "Anemo"))

    def test_incomplete_or_unrecognised_pages_are_not_guessed(self):
        for markup in (
            "",
            '<img alt="Hydro">',
            season_markup(("Hydro", "Cryo")),
            season_markup(("Hydro", "Cryo", "Anemo", "Geo")),
        ):
            self.assertEqual(source.parse_theater_elements(markup), ())

    def test_season_page_uses_account_server_date_at_month_boundary(self):
        timestamp = int(datetime.fromisoformat("2026-09-30T20:00:00+00:00").timestamp())
        self.assertTrue(source.season_page(timestamp, "os_asia").endswith("2026-10-01"))
        self.assertTrue(source.season_page(timestamp, "os_usa").endswith("2026-09-30"))
        self.assertIsNone(source.season_page(0, "os_asia"))


class ElementLookupTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        source._cache.clear()
        localise = patch.object(source, "localise_reward_images", AsyncMock())
        self.localise = localise.start()
        self.addCleanup(localise.stop)
        self.start = int(datetime.fromisoformat("2026-10-01T04:00:00+08:00").timestamp())

    def session(self, markup):
        response = MagicMock()
        response.json = AsyncMock(return_value={"parse": {"text": {"*": markup}}})
        request = MagicMock()
        request.__aenter__ = AsyncMock(return_value=response)
        session = MagicMock()
        session.get.return_value = request
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=session)
        return context, session

    async def test_fetch_is_cached_across_accounts_and_returns_independent_lists(self):
        context, session = self.session(season_markup())
        with patch.object(source.aiohttp, "ClientSession", return_value=context):
            first = await source.get_theater_elements(self.start, "os_asia")
            first.clear()
            self.assertEqual(
                await source.get_theater_elements(self.start, "os_cht"), ["Hydro", "Cryo", "Anemo"]
            )
        self.assertEqual(session.get.call_count, 1)

    async def test_elements_and_cast_share_one_lookup_and_cannot_mutate_cache(self):
        context, session = self.session(cast_markup() + season_markup())
        with patch.object(source.aiohttp, "ClientSession", return_value=context):
            season = await source.get_theater_season(self.start, "os_asia")
            self.assertEqual(len(season["opening_cast"]), 6)
            season["opening_cast"][0]["name"] = "Changed"
            self.assertEqual(
                await source.get_theater_elements(self.start, "os_asia"), ["Hydro", "Cryo", "Anemo"]
            )
            again = await source.get_theater_season(self.start, "os_asia")
            self.assertEqual(again["opening_cast"][0]["name"], "Character 0")
        self.assertEqual(session.get.call_count, 1)
        self.localise.assert_awaited_once()

    async def test_new_season_does_not_reuse_previous_seasons_elements(self):
        context, _ = self.session(season_markup())
        with patch.object(source.aiohttp, "ClientSession", return_value=context):
            await source.get_theater_elements(self.start, "os_asia")
        next_start = int(datetime.fromisoformat("2026-11-01T04:00:00+08:00").timestamp())
        with patch.object(source.aiohttp, "ClientSession", side_effect=aiohttp.ClientError):
            self.assertEqual(await source.get_theater_elements(next_start, "os_asia"), [])

    async def test_temporary_failure_keeps_verified_elements_for_same_season(self):
        page = source.season_page(self.start, "os_asia")
        source._cache[page] = (0, {"elements": ["Hydro", "Cryo", "Anemo"], "opening_cast": []})
        with patch.object(source.aiohttp, "ClientSession", side_effect=aiohttp.ClientError):
            self.assertEqual(
                await source.get_theater_elements(self.start, "os_asia"), ["Hydro", "Cryo", "Anemo"]
            )


if __name__ == "__main__":
    unittest.main()
