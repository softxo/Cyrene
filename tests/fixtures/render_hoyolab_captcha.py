"""Render the actual CAPTCHA page without contacting HoYoLAB."""

import asyncio
import contextlib
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from fastapi import Request
from genshin.models.auth.geetest import SessionMMT

from utils.web.app import challenge
from utils.web.sessions import create_challenge_session


async def render():
    mmt = SessionMMT(
        new_captcha=1,
        success=1,
        challenge="test-challenge",
        gt="test-gt",
        session_id="test-session",
    )
    session = create_challenge_session(1, mmt, app_login=True, link_token="attempt")
    request = Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/challenge/test",
            "headers": [],
            "scheme": "http",
            "server": ("captcha.test", 80),
            "query_string": b"",
        }
    )
    with contextlib.redirect_stdout(io.StringIO()):
        response = await challenge(session.token, request)
    print(response.body.decode())


asyncio.run(render())
