"""Generate browser fixtures using production templates and challenge handlers."""

import asyncio
import contextlib
import io
import json
from pathlib import Path

from genshin.models.auth.geetest import SessionMMT, SessionMMTv4
from jinja2 import Environment

from utils.web import app, sessions


async def pages():
    result = {}
    payload = '</ScRiPt><script>window.injected = true</script><img src=x onerror="window.injected=true">'
    for v4 in (False, True):
        values = dict(new_captcha=True, success=1, gt=payload, session_id=payload)
        model = SessionMMTv4(**values, risk_type="slide") if v4 else SessionMMT(**values, challenge=payload)
        session = sessions.create_challenge_session(123, model)
        with contextlib.redirect_stdout(io.StringIO()):
            response = await app.challenge(session.token)
        result[f"v{4 if v4 else 3}"] = {"html": response.body.decode(), "token": session.token, "payload": payload}

    template = Path("website/templates/events.html").read_text(encoding="utf-8")
    start = template.rfind("<div", 0, template.index('class="events-custom-modal"'))
    end = template.index("</form>", start) + len("</form>")
    result["eventModal"] = Environment(autoescape=True).from_string(
        template[start:end] + "</section></div>"
    ).render(accounts=[{"id": 7, "nickname": payload, "genshin_uid": "123456789"}])
    return result


if __name__ == "__main__":
    print(json.dumps(asyncio.run(pages())))
