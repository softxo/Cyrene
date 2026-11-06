import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import update_achievements as updater
from utils.achievements import achievements as catalogue


def entry(identifier):
    return {
        "id": [identifier],
        "name": str(identifier),
        "achievementGroupId": 0,
        "achievementGroupName": "Wonders of the World",
        "sortOrder": identifier,
        "stages": 1,
        "version": "7.2",
        "stage1": {"description": "Test", "progress": 1, "reward": {"count": 5}},
    }


class CatalogueTests(unittest.IsolatedAsyncioTestCase):
    async def test_refresh_is_shared_and_imports_use_refreshed_catalogue(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(catalogue, "_SNAPSHOT", Path(folder) / "cache.json"),
            patch.object(catalogue, "_catalogue", None),
            patch.object(catalogue, "_next_refresh", 0),
            patch.object(catalogue, "_refresh_lock", asyncio.Lock()),
            patch.object(catalogue, "load_achievements", return_value=[entry(1)]),
            patch.object(
                updater, "download_achievements", return_value=[entry(1), entry(2)]
            ) as download,
        ):
            results = await asyncio.gather(
                *[catalogue.load_current_achievements() for _ in range(3)]
            )
            self.assertTrue(all(len(result) == 2 for result in results))
            download.assert_called_once()
            self.assertEqual(len(json.loads(catalogue._SNAPSHOT.read_text())["achievements"]), 2)

    async def test_failed_refresh_retains_data_and_backs_off(self):
        with (
            patch.object(catalogue, "_catalogue", [entry(1)]),
            patch.object(catalogue, "_next_refresh", 0),
            patch.object(catalogue, "_refresh_lock", asyncio.Lock()),
            patch.object(
                updater, "download_achievements", side_effect=OSError("Offline")
            ) as download,
        ):
            with self.assertLogs(catalogue.__name__, level="WARNING"):
                self.assertEqual(await catalogue.load_current_achievements(), [entry(1)])
            self.assertEqual(await catalogue.load_current_achievements(), [entry(1)])
            download.assert_called_once()

    def test_incomplete_download_cannot_replace_known_data(self):
        with patch.object(updater, "download_achievements", return_value=[entry(2)]):
            with self.assertRaises(ValueError):
                catalogue._refresh_catalogue([entry(1)])

    def test_bundled_data_contains_72_and_unique_ids(self):
        with patch.object(catalogue, "_catalogue", None):
            data = catalogue.load_achievements()
        ids = [identifier for item in data for identifier in item["id"]]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(any(item["version"] == "7.2" for item in data))

    async def test_page_reads_do_not_wait_for_a_slow_refresh(self):
        started, release = asyncio.Event(), asyncio.Event()

        async def slow_download(*args):
            started.set()
            await release.wait()
            return [entry(1), entry(2)]

        with (
            patch.object(catalogue, "_catalogue", [entry(1)]),
            patch.object(catalogue, "_next_refresh", 0),
            patch.object(catalogue, "_refresh_task", None),
            patch.object(catalogue, "_refresh_lock", asyncio.Lock()),
            patch.object(catalogue.asyncio, "to_thread", side_effect=slow_download) as download,
        ):
            first = await asyncio.wait_for(
                catalogue.load_current_achievements(wait_for_refresh=False), 0.1
            )
            self.assertEqual(first, [entry(1)])
            await asyncio.wait_for(started.wait(), 0.1)
            second = await asyncio.wait_for(
                catalogue.load_current_achievements(wait_for_refresh=False), 0.1
            )
            self.assertEqual(second, first)
            download.assert_called_once()
            release.set()
            await catalogue._refresh_task
            self.assertEqual(catalogue.load_achievements(), [entry(1), entry(2)])
