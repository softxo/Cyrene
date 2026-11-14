from fastapi import (
    FastAPI,
    Request,
)
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from website.server.core.changelog import router as changelog_router
from website.server.core.discord_oauth import router as discord_oauth_router
from website.server.core.site_updates import router as site_updates_router
from website.server.core.templating import BASE_DIR
from website.server.routes.achievements import router as achievements_router
from website.server.routes.auth import router as auth_router
from website.server.routes.challenge import router as challenge_router
from website.server.routes.characters import router as characters_router
from website.server.routes.codes import router as codes_router
from website.server.routes.custom_events import router as custom_events_router
from website.server.routes.docs import router as docs_router
from website.server.routes.events import router as events_router
from website.server.routes.exploration import router as exploration_router
from website.server.routes.hoyolab_accounts import router as hoyolab_accounts_router
from website.server.routes.inventory import router as inventory_router
from website.server.routes.pages import router as pages_router
from website.server.routes.reminders import router as reminders_router
from website.server.routes.support import router as support_router
from website.server.routes.support_logs import router as support_logs_router
from website.server.routes.uploads import router as uploads_router
from website.server.routes.weapons import router as weapons_router
from website.server.routes.wishes import router as wishes_router

app = FastAPI(
    title="Cyrene",
    docs_url=None,
    redoc_url=None,
)

app.include_router(changelog_router)
app.include_router(discord_oauth_router)
app.include_router(site_updates_router)
app.include_router(challenge_router)
app.include_router(pages_router)
app.include_router(docs_router)
app.include_router(exploration_router)
app.include_router(inventory_router)
app.include_router(events_router)
app.include_router(hoyolab_accounts_router)
app.include_router(auth_router)
app.include_router(reminders_router)
app.include_router(characters_router)
app.include_router(custom_events_router)
app.include_router(wishes_router)
app.include_router(achievements_router)
app.include_router(weapons_router)
app.include_router(codes_router)
app.include_router(support_router)
app.include_router(support_logs_router)
app.include_router(uploads_router)

app.mount(
    "/static",
    StaticFiles(directory=BASE_DIR / "website" / "static"),
    name="static",
)


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
CONTENT_SECURITY_POLICY = "; ".join(
    (
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://*.geetest.com https://gcaptcha4.captchami.com",
        "style-src 'self' 'unsafe-inline' https://static.geetest.com",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' https://*.geetest.com https://gcaptcha4.captchami.com",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self' https://discord.com",
        "object-src 'none'",
    )
)

IMAGE_CACHE_CONTROL = "public, max-age=604800"


@app.middleware("http")
async def revalidate_site_assets(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static/build/") or "text/html" in response.headers.get(
        "content-type", ""
    ):
        response.headers["Cache-Control"] = "no-cache"
    elif request.url.path.startswith("/static/images/"):
        response.headers["Cache-Control"] = IMAGE_CACHE_CONTROL
    for name, value in SECURITY_HEADERS.items():
        response.headers.setdefault(name, value)
    if "text/html" in response.headers.get("content-type", ""):
        response.headers.setdefault("Content-Security-Policy-Report-Only", CONTENT_SECURITY_POLICY)
    return response


class TextGZipMiddleware(GZipMiddleware):
    """Compress pages, scripts, styles and JSON, but leave images and hosted files alone."""

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] == "http" and (
            (path.startswith("/static/images/") and not path.endswith(".svg"))
            or (path.startswith("/f/") and path.count("/") > 2)
        ):
            await self.app(scope, receive, send)
            return
        await super().__call__(scope, receive, send)


app.add_middleware(TextGZipMiddleware, minimum_size=1024)


class HeadAsGetMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] != "HEAD":
            await self.app(scope, receive, send)
            return

        async def send_without_body(message):
            if message["type"] == "http.response.body":
                message = {**message, "body": b""}
            await send(message)

        await self.app({**scope, "method": "GET"}, receive, send_without_body)


app.add_middleware(HeadAsGetMiddleware)
