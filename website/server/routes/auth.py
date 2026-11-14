"""Discord verification page and the sign-in status APIs."""

from fastapi import APIRouter, Cookie, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse

from website.server.core.auth import (
    create_verification,
    create_web_session,
    delete_web_session,
    get_discord_profile,
    get_verification,
    get_web_session,
    save_discord_profile,
)
from website.server.core.discord_oauth import refresh_profile as refresh_discord_profile
from website.server.core.templating import templates

router = APIRouter()


@router.get(
    "/verify",
    response_class=HTMLResponse,
)
async def verify_page(
    request: Request,
    next: str | None = None,
    cyrene_session: str | None = Cookie(default=None),
):
    if next and (not next.startswith("/") or next.startswith("//")):
        next = None

    session = await get_web_session(cyrene_session)
    if session:
        await refresh_discord_profile(session.user_id)
    discord_profile = await get_discord_profile(session.user_id) if session else None

    return templates.TemplateResponse(
        request=request,
        name="verification.html",
        context={
            "request": request,
            "next": next,
            "discord_profile": discord_profile,
            "discord_oauth_error": request.query_params.get("discord_error")
            if request.query_params.get("discord_error") in {"failed", "unavailable"}
            else None,
        },
    )


@router.post("/api/verify/create")
async def create_web_verification():
    verification = create_verification()

    return {
        "success": True,
        "token": verification.token,
        "code": verification.code,
        "expires_in": 300,
    }


@router.get("/api/verify/status")
async def verification_status(token: str):
    verification = get_verification(token)

    if verification is None:
        raise HTTPException(
            status_code=404,
            detail="Verification request expired.",
        )

    if verification.user_id is None:
        return {
            "verified": False,
        }

    await save_discord_profile(verification)
    session = await create_web_session(verification.user_id)
    response = JSONResponse(
        content={
            "verified": True,
        }
    )

    response.set_cookie(
        key="cyrene_session",
        value=session.token,
        max_age=30 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="lax",
    )

    return response


@router.post("/api/auth/logout")
async def logout(cyrene_session: str | None = Cookie(default=None)):
    if cyrene_session:
        await delete_web_session(cyrene_session)

    response = JSONResponse(
        content={
            "success": True,
        }
    )

    response.delete_cookie(key="cyrene_session")

    return response


@router.get("/api/auth/status")
async def auth_status(cyrene_session: str | None = Cookie(default=None)):
    session = await get_web_session(cyrene_session)

    if session is None:
        return {
            "authenticated": False,
        }

    return {
        "authenticated": True,
        "user_id": session.user_id,
    }
