"""HoYoLAB verification challenge pages and their result submission."""

import logging
import re
import typing

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from genshin import errors as genshin_errors
from genshin.models.auth.geetest import SessionMMTResult, SessionMMTv4, SessionMMTv4Result
from jinja2.utils import htmlsafe_json_dumps

from shared.hoyolab.challenge_sessions import (
    EmailChallenge,
    complete_challenge,
    get_challenge_session,
)
from shared.hoyolab.errors import HoYoLABVerificationError
from website.server.core.templating import templates

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get(
    "/challenge/{token}",
    response_class=HTMLResponse,
)
async def challenge(token: str, request: Request):
    session = get_challenge_session(token)

    if session is None:
        return HTMLResponse(
            content="""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Cyrene • Challenge Expired</title>
            </head>
            <body>
                <h1>Challenge Expired</h1>
                <p>
                    This authentication challenge has expired
                    or is no longer valid.
                </p>
            </body>
            </html>
            """,
            status_code=410,
        )

    if session.completed:
        return HTMLResponse(
            content="""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Cyrene • Challenge Completed</title>
            </head>
            <body>
                <h1>Challenge Already Completed</h1>
                <p>
                    This authentication challenge has already
                    been completed.
                </p>
            </body>
            </html>
            """,
            status_code=410,
        )

    if isinstance(session.mmt, EmailChallenge):
        return templates.TemplateResponse(
            request=request,
            name="hoyolab_email_challenge.html",
            context={
                "submission_url": f"/challenge/{session.token}/send-data",
                "link_token": session.link_token or "",
            },
            headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
        )

    mmt = session.mmt
    mmt_json = htmlsafe_json_dumps(mmt.model_dump(mode="json"))
    submission_url_json = htmlsafe_json_dumps(f"/challenge/{session.token}/send-data")
    is_v4 = isinstance(mmt, SessionMMTv4)

    if is_v4:
        gt_url = "https://static.geetest.com/v4/gt4.js"
        session_field = "session_id" if session.app_login else "mmt_key"
        api_server = "gcaptcha4.captchami.com" if session.app_login else "api-na.geetest.com"
        captcha_script = f"""
        const mmt = {mmt_json};

        const initParams = {{
            captchaId: mmt.captcha_id ?? mmt.gt,
            riskType: mmt.risk_type,
            userInfo: mmt.session_id
                ? JSON.stringify({{
                    {session_field}: mmt.session_id
                }})
                : undefined,
            apiServers: ["{api_server}"],
            product: "bind",
            language: "en"
        }};

        console.log("===== GEETEST INIT =====");
        console.log(initParams);
        console.log("========================");

        initGeetest4(
            initParams,
            (captcha) => {{

                captcha.onReady(() => {{
                    console.log("Geetest v4 ready");
                    captcha.showCaptcha();
                }});

                captcha.onSuccess(async () => {{

                    const result = captcha.getValidate();

                    console.log("===== GEETEST RESULT =====");
                    console.log(result);
                    console.log("==========================");

                    const response = await fetch(
                        {submission_url_json},
                        {{
                            method: "POST",

                            headers: {{
                                "Content-Type": "application/json"
                            }},

                            body: JSON.stringify({{
                                ...(mmt.session_id && {{
                                    session_id: mmt.session_id
                                }}),

                                ...(mmt.check_id && {{
                                    check_id: mmt.check_id
                                }}),

                                ...result
                            }})
                        }}
                    );

                    if (!response.ok) {{
                        const data = await response.json().catch(() => ({{}}));
                        showCaptchaError(data.detail || "The CAPTCHA could not be verified.");
                        return;
                    }}

                    showSuccess();
                }});

                captcha.onError((error) => {{
                    console.error("==== GEETEST ERROR ====");
                    console.error(error);
                    console.error("======================");
                }});
            }}
        );
        """

    else:
        gt_url = "https://static.geetest.com/static/js/gt.0.5.0.js"
        captcha_script = f"""
        const mmt = {mmt_json};

        const initParams = {{
            gt: mmt.gt,
            challenge: mmt.challenge,
            new_captcha: mmt.new_captcha,
            api_server: "api-na.geetest.com",
            https: /^https/i.test(window.location.protocol),
            product: "bind",
            lang: "en"
        }};

        console.log("===== GEETEST INIT =====");
        console.log(initParams);
        console.log("========================");

        initGeetest(
            initParams,
            (captcha) => {{

                captcha.onReady(() => {{
                    console.log("Geetest v3 ready");
                    captcha.verify();
                }});

                captcha.onSuccess(async () => {{

                    const result = captcha.getValidate();

                    console.log("===== GEETEST RESULT =====");
                    console.log(result);
                    console.log("==========================");

                    const response = await fetch(
                        {submission_url_json},
                        {{
                            method: "POST",

                            headers: {{
                                "Content-Type": "application/json"
                            }},

                            body: JSON.stringify({{
                                session_id: mmt.session_id,
                                geetest_challenge:
                                    result.geetest_challenge,
                                geetest_validate:
                                    result.geetest_validate,
                                geetest_seccode:
                                    result.geetest_seccode
                            }})
                        }}
                    );

                    if (!response.ok) {{
                        const data = await response.json().catch(() => ({{}}));
                        showCaptchaError(data.detail || "The CAPTCHA could not be verified.");
                        return;
                    }}

                    showSuccess();
                }});

                captcha.onError((error) => {{
                    console.error("==== GEETEST ERROR ====");
                    console.error(error);
                    console.error("======================");
                }});
            }}
        );
        """

    return HTMLResponse(
        content=f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">

            <meta
                name="viewport"
                content="width=device-width, initial-scale=1.0"
            >

            <meta
                name="referrer"
                content="no-referrer"
            >

            <title>Cyrene • HoYoLAB Verification</title>

            <script>
                function applyTheme() {{
                    try {{
                        document.documentElement.dataset.theme = localStorage.getItem("theme") || "blue";
                    }} catch {{
                        document.documentElement.dataset.theme = "blue";
                    }}
                }}
                applyTheme();
                window.addEventListener("storage", event => {{
                    if (event.key === "theme" || event.key === null) applyTheme();
                }});
            </script>
            <link rel="stylesheet" href="/static/build/css/global.css?v=56">
            <script src="{gt_url}"></script>

            <style>
                body {{
                    margin: 0;
                    min-height: 100vh;

                    display: flex;
                    align-items: center;
                    justify-content: center;

                    background-color: var(--background);
                    color: var(--text);
                }}

                .container {{
                    width: min(90%, 500px);
                    padding: 40px;

                    background-color: var(--surface);
                    border-radius: 16px;

                    text-align: center;
                    box-sizing: border-box;
                }}

                h1 {{
                    margin-bottom: 16px;
                }}

                p {{
                    color: var(--text-muted);
                    line-height: 1.6;
                }}

                #captcha {{
                    margin-top: 24px;
                }}

                .success-screen {{ min-height:100vh; display:flex; align-items:center; justify-content:center; flex-direction:column; text-align:center; animation:success-in 300ms ease-out both; }}
                .success-icon {{ position:relative; width:112px; height:112px; color:#59d58b; }}
                .success-corner {{ position:absolute; width:31px; height:31px; border-color:currentColor; border-style:solid; opacity:0; animation:frame-in 420ms cubic-bezier(.2,.8,.2,1) forwards; }}
                .success-corner.tl {{ top:0; left:0; border-width:4px 0 0 4px; border-radius:14px 0 0; }}
                .success-corner.tr {{ top:0; right:0; border-width:4px 4px 0 0; border-radius:0 14px 0 0; }}
                .success-corner.bl {{ bottom:0; left:0; border-width:0 0 4px 4px; border-radius:0 0 0 14px; }}
                .success-corner.br {{ right:0; bottom:0; border-width:0 4px 4px 0; border-radius:0 0 14px; }}
                .success-scan {{ position:absolute; top:18px; right:16px; left:16px; height:2px; border-radius:999px; background:currentColor; box-shadow:0 0 12px currentColor; opacity:0; animation:scan 700ms 280ms ease-in-out both; }}
                .success-check {{ position:absolute; inset:20px; width:72px; height:72px; }}
                .success-check path {{ fill:none; stroke:currentColor; stroke-width:5; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:50; stroke-dashoffset:50; animation:check-in 440ms 850ms ease-out forwards; }}
                .success-screen h1 {{ margin:24px 0 6px; }}
                .success-screen p {{ margin:0; }}
                @keyframes success-in {{ from {{ opacity:0; transform:scale(.97); }} to {{ opacity:1; transform:scale(1); }} }}
                @keyframes frame-in {{ from {{ opacity:0; transform:scale(.78); }} to {{ opacity:1; transform:scale(1); }} }}
                @keyframes scan {{ 0% {{ opacity:0; transform:translateY(0); }} 18%,82% {{ opacity:.9; }} 100% {{ opacity:0; transform:translateY(74px); }} }}
                @keyframes check-in {{ to {{ stroke-dashoffset:0; }} }}
                @media (prefers-reduced-motion: reduce) {{ .success-screen, .success-corner, .success-scan, .success-check path {{ animation-duration:1ms; animation-delay:0ms; }} }}
            </style>
        </head>

        <body>
            <div class="container">

                <h1>Verification Required</h1>

                <p>
                    Cyrene encountered a CAPTCHA during your
                    HoYoLAB authentication.
                </p>

                <p>
                    Complete the CAPTCHA below to continue.
                </p>

                <div id="captcha"></div>

            </div>

            <script>

                function showCaptchaError(message) {{
                    const container = document.querySelector(".container");
                    if (!container) return;
                    container.querySelector("h1").textContent = "Login could not continue";
                    const paragraphs = container.querySelectorAll("p");
                    paragraphs[0].textContent = message;
                    paragraphs[0].setAttribute("role", "alert");
                    paragraphs[1].textContent = "Return to Accounts to review this login attempt.";
                }}

                function showSuccess() {{
                    document.body.innerHTML = `
                        <div class="success-screen" role="status">
                            <div class="success-icon" aria-hidden="true">
                                <span class="success-corner tl"></span>
                                <span class="success-corner tr"></span>
                                <span class="success-corner bl"></span>
                                <span class="success-corner br"></span>
                                <span class="success-scan"></span>
                                <svg class="success-check" viewBox="0 0 64 64">
                                    <path d="M17 33.5 27.5 44 48 22"></path>
                                </svg>
                            </div>
                            <h1>CAPTCHA verified</h1>
                            <p>
                                Cyrene will continue automatically. This page
                                will close in <span id="close-countdown">3</span> seconds.
                            </p>
                        </div>
                    `;

                    let secondsRemaining = 3;
                    const countdown = document.getElementById("close-countdown");

                    const countdownTimer = window.setInterval(() => {{
                        secondsRemaining -= 1;

                        if (secondsRemaining > 0) {{
                            countdown.textContent = secondsRemaining;
                            return;
                        }}

                        window.clearInterval(countdownTimer);
                        window.close();
                    }}, 1000);

                }}

                {captcha_script}

            </script>
        </body>
        </html>
        """,
    )


@router.post(
    "/challenge/{token}/send-data",
)
async def challenge_send_data(
    token: str,
    data: dict[str, typing.Any],
):
    session = get_challenge_session(token)

    if session is None:
        raise HTTPException(
            status_code=410,
            detail="This challenge has expired.",
        )

    if session.completed:
        raise HTTPException(
            status_code=410,
            detail="This challenge has already been completed.",
        )

    if isinstance(session.mmt, EmailChallenge):
        code = data.get("code")
        if not isinstance(code, str) or re.fullmatch(r"[0-9]{6}", code) is None:
            raise HTTPException(status_code=400, detail="Enter the six-digit email code.")
        if session.submitting:
            raise HTTPException(status_code=409, detail="A code is already being checked.")
        if session.mmt.verify is None:
            raise HTTPException(status_code=410, detail="Start login again to request a new code.")
        session.submitting = True
        try:
            await session.mmt.verify(code)
        except genshin_errors.WrongOTP as error:
            raise HTTPException(
                status_code=400, detail="That email code is incorrect. Check it and try again."
            ) from error
        except genshin_errors.TooManyRequests as error:
            raise HTTPException(
                status_code=429,
                detail="HoYoLAB is rate-limiting verification. Please wait before trying again.",
            ) from error
        except Exception as error:
            raise HTTPException(
                status_code=400,
                detail="HoYoLAB could not verify this code. Check it or start login again.",
            ) from error
        finally:
            session.submitting = False
        complete_challenge(token, code)
        return {"success": True}

    try:
        if isinstance(session.mmt, SessionMMTv4):
            result = SessionMMTv4Result(**data)
        else:
            result = SessionMMTResult(**data)

    except Exception as error:
        logger.exception("Captcha result submission failed.")

        raise HTTPException(
            status_code=400,
            detail="Invalid CAPTCHA result.",
        ) from error

    if session.validate is not None:
        if session.submitting:
            raise HTTPException(status_code=409, detail="This CAPTCHA is already being checked.")
        session.submitting = True
        try:
            result = await session.validate(result)
        except Exception as error:
            complete_challenge(token, error)
            detail = (
                error.public_message
                if isinstance(error, HoYoLABVerificationError)
                else "HoYoLAB could not validate this CAPTCHA. Cyrene has stopped this login attempt."
            )
            raise HTTPException(status_code=400, detail=detail) from error
        finally:
            session.submitting = False

    complete_challenge(token, result)

    return {
        "success": True,
    }
