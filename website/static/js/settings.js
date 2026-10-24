function initSettings() {

    // =========================================
    // THEME
    // =========================================

    updateThemeSelection(
        document.documentElement.dataset.theme
    );

    initialiseAccountLinking();


    // =========================================
    // HOVER EFFECTS
    // =========================================

    const toggle =
        document.getElementById("hover-effects-toggle");

    if (!toggle) {
        return;
    }

    const savedHoverEffects =
        localStorage.getItem("hoverEffects");

    // Hover effects are enabled by default.
    const hoverEffectsEnabled =
        savedHoverEffects !== "false";

    applyHoverEffectsSetting(hoverEffectsEnabled);


    toggle.addEventListener("click", () => {

        const currentlyEnabled =
            document.documentElement.dataset.hoverEffects !== "off";

        applyHoverEffectsSetting(!currentlyEnabled);

    });
}


function initialiseAccountLinking() {
    const form = document.getElementById("account-link-form");
    const result = document.getElementById("account-link-result");
    const submit = document.getElementById("account-link-submit");

    if (!form || !result || !submit || form.dataset.initialised === "true") {
        return;
    }

    form.dataset.initialised = "true";
    let pollTimer = null;

    const showError = message => {
        result.innerHTML = "";
        const paragraph = document.createElement("p");
        paragraph.className = "account-link-message error";
        paragraph.textContent = message;
        result.appendChild(paragraph);
        submit.disabled = false;
        submit.textContent = "Add HoYoLAB account";
    };

    const request = async (url, options = {}) => {
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            window.location.href = "/verify?next=/settings";
            throw new Error("Authentication required.");
        }

        if (!response.ok) {
            throw new Error(data.detail || "Something went wrong.");
        }

        return data;
    };

    const showAccountChoices = (token, accounts) => {
        result.innerHTML = "";

        const heading = document.createElement("p");
        heading.className = "account-link-message";
        heading.textContent = "Choose the Genshin account to link:";
        result.appendChild(heading);

        const choices = document.createElement("div");
        choices.className = "account-choices";

        accounts.forEach(account => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "account-choice";

            const name = document.createElement("strong");
            name.textContent = account.nickname || "Unnamed account";

            const details = document.createElement("span");
            details.textContent = `UID ${account.game_uid} · AR ${account.level}`;

            button.append(name, details);
            button.addEventListener("click", async () => {
                button.disabled = true;

                try {
                    const data = await request("/api/hoyolab/link/complete", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ token, uid: account.game_uid })
                    });

                    form.hidden = true;
                    result.innerHTML = `
                        <div class="account-link-success">
                            <div class="verified-icon" aria-hidden="true">
                                <span class="verified-corner top-left"></span>
                                <span class="verified-corner top-right"></span>
                                <span class="verified-corner bottom-left"></span>
                                <span class="verified-corner bottom-right"></span>
                                <span class="verified-scan-line"></span>
                                <svg class="verified-check" viewBox="0 0 64 64" focusable="false">
                                    <path d="M17 33.5 27.5 44 48 22"></path>
                                </svg>
                            </div>
                            <h4></h4>
                            <p></p>
                        </div>
                    `;

                    result.querySelector("h4").textContent = data.reconnected
                        ? "Account reconnected"
                        : "Account linked";
                    result.querySelector("p").textContent =
                        `${account.nickname || account.game_uid} is now available in Cyrene and Discord.`;
                } catch (error) {
                    button.disabled = false;
                    showError(error.message);
                }
            });

            choices.appendChild(button);
        });

        result.appendChild(choices);
    };

    const poll = async token => {
        try {
            const data = await request(
                `/api/hoyolab/link/status?token=${encodeURIComponent(token)}`
            );

            if (data.status === "error") {
                showError(data.error);
                return;
            }

            if (data.status === "select") {
                submit.disabled = false;
                showAccountChoices(token, data.accounts);
                return;
            }

            result.innerHTML = "";
            const message = document.createElement("p");
            message.className = "account-link-message";

            if (data.status === "captcha") {
                message.textContent = "HoYoLAB needs a CAPTCHA before continuing.";
                result.appendChild(message);

                const link = document.createElement("a");
                link.className = "account-link-action";
                link.href = data.challenge_url;
                link.target = "_blank";
                link.rel = "noopener";
                link.textContent = "Complete CAPTCHA";
                result.appendChild(link);
            } else {
                message.textContent = "Authenticating with HoYoLAB…";
                result.appendChild(message);
            }

            pollTimer = window.setTimeout(() => poll(token), 1000);
        } catch (error) {
            showError(error.message);
        }
    };

    form.addEventListener("submit", async event => {
        event.preventDefault();
        window.clearTimeout(pollTimer);
        submit.disabled = true;
        submit.textContent = "Connecting…";
        result.innerHTML = '<p class="account-link-message">Authenticating with HoYoLAB…</p>';

        try {
            const data = await request("/api/hoyolab/link/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    account: document.getElementById("hoyolab-account").value,
                    password: document.getElementById("hoyolab-password").value
                })
            });

            document.getElementById("hoyolab-password").value = "";
            await poll(data.token);
        } catch (error) {
            showError(error.message);
        }
    });
}


/* =========================================================
   HOVER EFFECTS SETTING
   ========================================================= */

function applyHoverEffectsSetting(enabled) {

    const toggle =
        document.getElementById("hover-effects-toggle");

    if (enabled) {

        document.documentElement.dataset.hoverEffects = "on";

        localStorage.setItem(
            "hoverEffects",
            "true"
        );

        if (toggle) {
            toggle.classList.add("active");

            toggle.setAttribute(
                "aria-pressed",
                "true"
            );
        }

    } else {

        document.documentElement.dataset.hoverEffects = "off";

        localStorage.setItem(
            "hoverEffects",
            "false"
        );

        if (toggle) {
            toggle.classList.remove("active");

            toggle.setAttribute(
                "aria-pressed",
                "false"
            );
        }
    }
}
