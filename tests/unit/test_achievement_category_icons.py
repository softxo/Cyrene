import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from utils.achievements import category_icons as icons
from utils.achievements.achievements import load_achievements

URL = "https://static.wikia.nocookie.net/gensin-impact/images/1/17/Achievement_Test.png"


class CategoryIconTests(unittest.IsolatedAsyncioTestCase):
    def test_lazy_wiki_images_are_normalised_and_validated(self):
        markup = f'<img alt="New Category: Series I" data-image-name="Achievement Test.png" data-src="{URL}/revision/latest/scale-to-width-down/20?cb=123">'
        self.assertEqual(icons.parse_category_icons(markup), {"newcategoryseriesi": URL})
        self.assertEqual(
            icons.parse_category_icons(markup.replace(URL, "https://evil.test/icon.png")), {}
        )
        self.assertFalse(icons.valid_icon_url(URL + "?unsafe=1"))

    def test_every_current_category_has_a_wiki_icon(self):
        saved = json.loads(icons.MANIFEST.read_text())
        for category in {a["achievementGroupName"] for a in load_achievements()}:
            self.assertTrue(
                icons.valid_icon_url(saved[icons.normalise_category(category)]), category
            )

    async def test_new_categories_are_discovered_and_persisted_automatically(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(icons, "MANIFEST", Path(folder) / "icons.json"),
            patch.object(icons, "_icons", {}),
            patch.object(icons, "_next_refresh", 0),
            patch.object(icons, "_lock", asyncio.Lock()),
            patch.object(icons, "_wiki_icons", side_effect=[{}, {"newcategory": URL}]) as fetch,
        ):
            self.assertEqual(
                await icons.load_category_icons(["New Category"]), {"New Category": URL}
            )
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(json.loads(icons.MANIFEST.read_text()), {"newcategory": URL})

    async def test_wiki_failure_keeps_saved_icons_and_retries_later(self):
        with (
            patch.object(icons, "_icons", {"test": URL}),
            patch.object(icons, "_next_refresh", 0),
            patch.object(icons, "_lock", asyncio.Lock()),
            patch.object(icons, "_wiki_icons", side_effect=OSError("Offline")) as fetch,
        ):
            with self.assertLogs(icons.__name__, level="WARNING"):
                self.assertEqual(await icons.load_category_icons(["Test"]), {"Test": URL})
            await icons.load_category_icons(["Test"])
            fetch.assert_called_once()

    async def test_page_reads_do_not_wait_for_a_slow_wiki(self):
        started, release = asyncio.Event(), asyncio.Event()

        async def slow_wiki(*args):
            started.set()
            await release.wait()
            return {"test": URL, "new": URL}

        with (
            patch.object(icons, "_icons", {"test": URL}),
            patch.object(icons, "_next_refresh", 0),
            patch.object(icons, "_refresh_task", None),
            patch.object(icons, "_lock", asyncio.Lock()),
            patch.object(icons.asyncio, "to_thread", side_effect=slow_wiki) as fetch,
        ):
            first = await asyncio.wait_for(
                icons.load_category_icons(["Test", "New"], wait_for_refresh=False), 0.1
            )
            self.assertEqual(first, {"Test": URL, "New": ""})
            await asyncio.wait_for(started.wait(), 0.1)
            second = await asyncio.wait_for(
                icons.load_category_icons(["Test"], wait_for_refresh=False), 0.1
            )
            self.assertEqual(second, {"Test": URL})
            fetch.assert_called_once()
            release.set()
            await icons._refresh_task
            self.assertEqual(
                await icons.load_category_icons(["New"], wait_for_refresh=False), {"New": URL}
            )
