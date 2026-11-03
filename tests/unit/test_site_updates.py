import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from utils.web import site_updates
from utils.web.app import app


class SiteUpdatesTests(unittest.TestCase):
    def test_fingerprint_changes_with_content_not_file_timestamps(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            template = root / "website/templates/base.html"
            template.parent.mkdir(parents=True)
            template.write_text("Original")
            with (
                patch.object(site_updates, "ROOT", root),
                patch.object(site_updates, "_version", ""),
                patch.object(site_updates, "_cached_at", 0),
            ):
                first = site_updates.site_version()
                template.touch()
                site_updates._cached_at = 0
                self.assertEqual(site_updates.site_version(), first)
                template.write_text("Updated")
                site_updates._cached_at = 0
                self.assertNotEqual(site_updates.site_version(), first)

    def test_version_endpoint_is_public_and_uncached(self):
        with patch.object(site_updates, "site_version", return_value="a" * 20):
            response = TestClient(app).get("/api/site-version")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"version": "a" * 20})
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_home_and_built_assets_revalidate(self):
        client = TestClient(app)
        for path in ["/", "/static/build/js/app.js"]:
            response = client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-cache")
