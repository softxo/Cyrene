import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

from utils.web import app as web


class WishUidApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_unlinked_account_is_denied_before_reading_history(self):
        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=20)),
            patch.object(
                web, "get_accounts", AsyncMock(return_value=[{"id": 2, "genshin_uid": "777000001"}])
            ),
            patch.object(web, "get_wish_history", AsyncMock()) as read,
        ):
            with self.assertRaises(HTTPException) as error:
                await web.wishes_data(1, "session")
            self.assertEqual(error.exception.status_code, 404)
            read.assert_not_awaited()

    async def test_linked_account_keeps_the_existing_response_shape(self):
        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=20)),
            patch.object(
                web, "get_accounts", AsyncMock(return_value=[{"id": 2, "genshin_uid": "777000001"}])
            ),
            patch.object(web, "get_wish_history", AsyncMock(return_value=[])) as read,
        ):
            self.assertEqual(await web.wishes_data(2, "session"), {"wishes": []})
            read.assert_awaited_once_with(2)

    async def test_different_uid_import_is_rejected_before_saving(self):
        with (
            patch.object(web, "get_authenticated_user", AsyncMock(return_value=20)),
            patch.object(
                web, "get_accounts", AsyncMock(return_value=[{"id": 2, "genshin_uid": "777000001"}])
            ),
            patch.object(web, "_validated_wish_url", return_value="validated"),
            patch.object(
                web, "_fetch_wishes_from_hoyoverse", AsyncMock(return_value=[{"uid": "777000003"}])
            ),
            patch.object(web, "import_wish_history", AsyncMock()) as save,
        ):
            with self.assertRaises(HTTPException) as error:
                await web.import_wishes_api(
                    SimpleNamespace(json=AsyncMock(return_value={"url": "url"})), 2, "session"
                )
            self.assertEqual(error.exception.status_code, 409)
            save.assert_not_awaited()
