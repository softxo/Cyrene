import json
import sqlite3
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from utils.web import changelog
from utils.web.app import app


class ChangelogTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("""CREATE TABLE site_changelog (
            id INTEGER PRIMARY KEY, entry_date TEXT, content TEXT,
            author_id INTEGER, updated_at TEXT, pill_colour TEXT, pill_colour_end TEXT, entry_time TEXT
        )""")
        self.addCleanup(self.db.close)
        db = self.db

        class Connection:
            def connection(self):
                return self

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

            async def execute(self, query, params=()):
                cursor = db.execute(
                    query.replace("%s", "?").replace("NOW()", "CURRENT_TIMESTAMP"), params
                )

                class Result:
                    rowcount = cursor.rowcount

                    async def fetchall(self):
                        return [
                            dict(row, entry_date=date.fromisoformat(row["entry_date"]))
                            for row in cursor.fetchall()
                        ]

                return Result()

        self.pool = patch.object(changelog, "get_pool", return_value=Connection()).start()
        self.session = patch.object(
            changelog, "get_web_session", AsyncMock(return_value=None)
        ).start()
        self.addCleanup(patch.stopall)

    def editor(self):
        self.session.return_value = SimpleNamespace(user_id=next(iter(changelog.SPECIAL_USER_IDS)))

    def test_public_feed_and_reserved_icon(self):
        response = self.client.get("/api/changelog")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["can_edit"])
        names = {icon["name"] for icon in response.json()["icons"]}
        self.assertIn("Bugfix", names)
        self.assertNotIn("Live_Status", names)
        self.assertNotIn("Changelog", names)
        self.assertEqual(
            next(
                icon["label"] for icon in response.json()["icons"] if icon["name"] == "Fix_Redesign"
            ),
            "Fix/Redesign",
        )

    def test_all_writes_require_special_discord_session(self):
        for user, expected in [(None, 401), (SimpleNamespace(user_id=123), 403)]:
            self.session.return_value = user
            for method, url in [
                ("POST", "/api/changelog"),
                ("PUT", "/api/changelog/1"),
                ("DELETE", "/api/changelog/1"),
            ]:
                response = self.client.request(
                    method, url, json={"date": "2026-11-01", "content": "Test"}
                )
                self.assertEqual(response.status_code, expected)
        self.assertEqual(self.db.execute("SELECT count(*) FROM site_changelog").fetchone()[0], 0)

    def test_editor_crud_persists_and_public_sees_updates_in_date_order(self):
        self.editor()
        content = ":Feature: Added Weapons\n:Bugfix: Fixed scrolling <script>alert(1)</script>"
        response = self.client.post(
            "/api/changelog", json={"date": "2026-11-01", "content": content}
        )
        self.assertEqual(response.status_code, 200)
        self.client.post("/api/changelog", json={"date": "2026-10-31", "content": "Older"})
        feed = self.client.get("/api/changelog").json()
        self.assertTrue(feed["can_edit"])
        entry = feed["entries"][0]
        self.assertEqual(entry["date_label"], "1 Nov 2026, 00:00")
        self.assertEqual(entry["content"], content)
        self.assertEqual(entry["lines"][0][0]["name"], "Feature")
        self.assertEqual(
            self.client.put(
                f"/api/changelog/{entry['id']}",
                json={
                    "date": "2026-11-02",
                    "content": ":Weapons: Updated",
                    "pill_colour": "#ff99aa",
                },
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client.get("/api/changelog").json()["entries"][0]["pill_colour"], "#ff99aa"
        )
        self.session.return_value = None
        self.assertEqual(
            self.client.get("/api/changelog").json()["entries"][0]["content"], ":Weapons: Updated"
        )
        self.editor()
        self.assertEqual(self.client.delete(f"/api/changelog/{entry['id']}").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/changelog/{entry['id']}").status_code, 404)

    def test_validation_and_unknown_icons(self):
        self.editor()
        for body in [
            {},
            [],
            {"date": "2026-02-30", "content": "Test"},
            {"date": "2026-11-01", "content": " "},
            {"date": "2026-11-01", "content": "x" * 8001},
        ]:
            self.assertEqual(self.client.post("/api/changelog", json=body).status_code, 422)
        self.assertEqual(
            self.client.post(
                "/api/changelog",
                content=json.dumps({"date": "2026-11-01", "content": "Text"}),
                headers={"Content-Type": "text/plain"},
            ).status_code,
            415,
        )
        self.assertEqual(
            changelog.content_lines(":Live_Status: :Unknown: <img src=x>"),
            [
                [
                    {"text": ":Live_Status:"},
                    {"text": " "},
                    {"text": ":Unknown:"},
                    {"text": " <img src=x>"},
                ]
            ],
        )

    def test_colour_rejects_css_injection(self):
        self.editor()
        for colour in ["red", "#fff", "url(https://example.com)", None]:
            self.assertEqual(
                self.client.post(
                    "/api/changelog",
                    json={"date": "2026-11-01", "content": "Test", "pill_colour": colour},
                ).status_code,
                422,
            )

    def test_gradient_persists_and_can_return_to_solid(self):
        self.editor()
        body = {
            "date": "2026-12-25",
            "content": "Christmas",
            "pill_colour": "#ee4455",
            "pill_colour_end": "#44aa66",
        }
        self.assertEqual(self.client.post("/api/changelog", json=body).status_code, 200)
        entry = self.client.get("/api/changelog").json()["entries"][0]
        self.assertEqual(entry["pill_colour_end"], "#44aa66")
        self.assertEqual(
            self.client.put(
                f"/api/changelog/{entry['id']}", json=dict(body, pill_colour_end=None)
            ).status_code,
            200,
        )
        self.assertIsNone(self.client.get("/api/changelog").json()["entries"][0]["pill_colour_end"])
        self.assertEqual(
            self.client.post(
                "/api/changelog", json=dict(body, pill_colour_end="url(bad)")
            ).status_code,
            422,
        )

    def test_time_persists_sorts_and_rejects_invalid_minutes(self):
        self.editor()
        for value in ["22:19", "09:30"]:
            self.assertEqual(
                self.client.post(
                    "/api/changelog",
                    json={"date": "2026-11-01", "time": value, "content": "Update"},
                ).status_code,
                200,
            )
        entries = self.client.get("/api/changelog").json()["entries"]
        self.assertEqual(entries[0]["date_label"], "1 Nov 2026, 22:19")
        self.assertEqual(entries[0]["time"], "22:19")
        for value in ["24:00", "22:60", "9:30", None]:
            self.assertEqual(
                self.client.post(
                    "/api/changelog",
                    json={"date": "2026-11-01", "time": value, "content": "Update"},
                ).status_code,
                422,
            )
