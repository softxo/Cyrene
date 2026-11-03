"""Discord identity authorisation. Tokens never leave the server."""

import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit

import aiohttp
from cryptography.fernet import InvalidToken
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from utils.hoyolab.crypto import HoYoLABCrypto
from utils.hoyolab.database import get_pool
from utils.web.auth import VerificationRequest, create_web_session, save_discord_profile

router = APIRouter()
API = "https://discord.com/api/v10"
STATE_COOKIE = "cyrene_discord_oauth"


def configuration():
    values = tuple(
        os.getenv(key, "")
        for key in ("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI")
    )
    return values if all(values) else None


def safe_next(value: str | None) -> str:
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/verify"
    if "\\" in value or any(ord(char) < 32 for char in value) or urlsplit(value).netloc:
        return "/verify"
    return value


class DiscordUnavailable(Exception):
    pass


async def discord_request(method, path, **kwargs):
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as client:
        async with client.request(method, API + path, **kwargs) as response:
            if response.status != 200:
                raise DiscordUnavailable()
            return await response.json()


async def exchange(**grant):
    config = configuration()
    if not config:
        raise DiscordUnavailable()
    return await discord_request(
        "POST",
        "/oauth2/token",
        data={
            "client_id": config[0],
            "client_secret": config[1],
            **grant,
        },
    )


async def save_tokens(user_id, tokens, connection):
    crypto = HoYoLABCrypto()
    expires = datetime.now(timezone.utc) + timedelta(seconds=int(tokens["expires_in"]))
    await connection.execute(
        """INSERT INTO web_discord_oauth (discord_user_id, access_token, refresh_token, expires_at)
        VALUES (%s, %s, %s, %s) ON CONFLICT (discord_user_id) DO UPDATE SET
        access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
        expires_at=EXCLUDED.expires_at""",
        (
            user_id,
            crypto.encrypt(tokens["access_token"]),
            crypto.encrypt(tokens["refresh_token"]),
            expires,
        ),
    )


async def fetch_profile(access_token, expected_id=None):
    user = await discord_request(
        "GET",
        "/users/@me",
        headers={
            "Authorization": "Bearer " + access_token,
        },
    )
    user_id = int(user["id"])
    if expected_id is not None and user_id != expected_id:
        raise DiscordUnavailable()
    return VerificationRequest(
        "",
        "",
        0,
        user_id,
        user["username"],
        user.get("global_name") or user["username"],
        user.get("avatar"),
    )


async def refresh_profile(user_id):
    if not configuration():
        return
    try:
        async with get_pool().connection() as connection:
            # Serialise refresh-token rotation for concurrent visits.
            result = await connection.execute(
                "SELECT * FROM web_discord_oauth WHERE discord_user_id=%s FOR UPDATE", (user_id,)
            )
            row = await result.fetchone()
            if not row:
                return
            crypto = HoYoLABCrypto()
            access = crypto.decrypt(row["access_token"])
            if row["expires_at"] <= datetime.now(timezone.utc) + timedelta(seconds=60):
                tokens = await exchange(
                    grant_type="refresh_token", refresh_token=crypto.decrypt(row["refresh_token"])
                )
                await save_tokens(user_id, tokens, connection)
                access = tokens["access_token"]
        profile = await fetch_profile(access, user_id)
        await save_discord_profile(profile)
    except (
        DiscordUnavailable,
        aiohttp.ClientError,
        TimeoutError,
        InvalidToken,
        KeyError,
        ValueError,
    ):
        # Keep the saved identity and web session during outages or revoked consent.
        return


@router.get("/auth/discord")
async def start(request: Request, next: str | None = None):
    config = configuration()
    if not config:
        return RedirectResponse("/verify?discord_error=unavailable", status_code=303)
    state = secrets.token_urlsafe(32)
    payload = HoYoLABCrypto().encrypt(json.dumps({"state": state, "next": safe_next(next)}))
    response = RedirectResponse(
        "https://discord.com/oauth2/authorize?"
        + urlencode(
            {
                "client_id": config[0],
                "redirect_uri": config[2],
                "response_type": "code",
                "scope": "identify",
                "state": state,
                "prompt": "consent",
            }
        ),
        status_code=303,
    )
    response.set_cookie(
        STATE_COOKIE,
        payload,
        max_age=600,
        httponly=True,
        secure=True,
        samesite="lax",
        path="/auth/discord",
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get("/auth/discord/callback")
async def callback(request: Request, state: str = "", code: str = "", error: str = ""):
    response = RedirectResponse("/verify?discord_error=failed", status_code=303)
    response.delete_cookie(
        STATE_COOKIE, path="/auth/discord", secure=True, httponly=True, samesite="lax"
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    try:
        raw = request.cookies.get(STATE_COOKIE, "")
        payload = json.loads(HoYoLABCrypto().fernet.decrypt(raw.encode(), ttl=600))
        if not state or not secrets.compare_digest(state, payload["state"]) or error or not code:
            return response
        config = configuration()
        if not config:
            return response
        tokens = await exchange(grant_type="authorization_code", code=code, redirect_uri=config[2])
        if "identify" not in tokens.get("scope", "").split():
            return response
        profile = await fetch_profile(tokens["access_token"])
        async with get_pool().connection() as connection:
            await save_tokens(profile.user_id, tokens, connection)
        await save_discord_profile(profile)
        session = await create_web_session(profile.user_id)
        response.headers["location"] = safe_next(payload.get("next"))
        response.set_cookie(
            "cyrene_session",
            session.token,
            max_age=30 * 24 * 60 * 60,
            httponly=True,
            secure=True,
            samesite="lax",
        )
    except (
        DiscordUnavailable,
        aiohttp.ClientError,
        TimeoutError,
        InvalidToken,
        KeyError,
        ValueError,
    ):
        pass
    return response
