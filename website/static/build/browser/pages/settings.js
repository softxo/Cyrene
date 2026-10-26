// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
function initSettings() {
    // =========================================
    // THEME
    // =========================================
    updateThemeSelection(document.documentElement.dataset.theme);
    initialiseAccountLinking();
    initialiseAccountManagement();
    // =========================================
    // HOVER EFFECTS
    // =========================================
    const toggle = document.getElementById("hover-effects-toggle");
    if (!toggle) {
        return;
    }
    const savedHoverEffects = localStorage.getItem("hoverEffects");
    // Hover effects are enabled by default.
    const hoverEffectsEnabled = savedHoverEffects !== "false";
    applyHoverEffectsSetting(hoverEffectsEnabled);
    toggle.addEventListener("click", () => {
        const currentlyEnabled = document.documentElement.dataset.hoverEffects !== "off";
        applyHoverEffectsSetting(!currentlyEnabled);
    });
}
function initialiseAccountManagement() {
    const list = document.getElementById("linked-account-list");
    const modal = document.getElementById("account-manage-modal");
    const renameForm = document.getElementById("account-rename-form");
    const nicknameInput = document.getElementById("account-manage-nickname");
    const details = document.getElementById("account-manage-details");
    const status = document.getElementById("account-manage-status");
    const deleteButton = document.getElementById("account-delete-button");
    if (!list ||
        !modal ||
        !renameForm ||
        !nicknameInput ||
        !details ||
        !status ||
        !deleteButton ||
        list.dataset.initialised === "true") {
        return;
    }
    list.dataset.initialised = "true";
    let selectedAccount = null;
    const closeModal = () => {
        modal.hidden = true;
        selectedAccount = null;
        document.body.classList.remove("settings-modal-open");
    };
    const request = async (url, options = {}) => {
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.detail || "Something went wrong.");
            error.status = response.status;
            throw error;
        }
        return data;
    };
    const openModal = account => {
        selectedAccount = account;
        details.textContent = `${account.nickname || "Unnamed account"} · UID ${account.uid}`;
        nicknameInput.value = account.cyrene_nickname || "";
        status.textContent = "";
        status.classList.remove("error");
        deleteButton.disabled = false;
        modal.hidden = false;
        document.body.classList.add("settings-modal-open");
        nicknameInput.focus();
    };
    const renderAccounts = accounts => {
        list.innerHTML = "";
        if (!accounts.length) {
            const empty = document.createElement("p");
            empty.className = "linked-account-empty";
            empty.textContent = "No HoYoLAB accounts linked yet.";
            list.appendChild(empty);
            return;
        }
        accounts.forEach(account => {
            const row = document.createElement("div");
            row.className = "linked-account-row";
            const info = document.createElement("div");
            info.className = "linked-account-info";
            const name = document.createElement("strong");
            name.textContent = account.cyrene_nickname || account.nickname || "Unnamed account";
            const meta = document.createElement("span");
            meta.textContent = `UID ${account.uid} · AR ${account.level || "Unknown"}`;
            const manage = document.createElement("button");
            manage.type = "button";
            manage.className = "linked-account-manage";
            manage.textContent = "Manage";
            manage.addEventListener("click", () => openModal(account));
            info.append(name, meta);
            row.append(info, manage);
            list.appendChild(row);
        });
    };
    const loadAccounts = async () => {
        try {
            const data = await request("/api/hoyolab/accounts");
            renderAccounts(data.accounts);
        }
        catch (error) {
            list.innerHTML = "";
            const message = document.createElement("p");
            message.className = "linked-account-empty";
            message.textContent = error.status === 401
                ? "Verify your Discord account to view and manage linked accounts."
                : error.message;
            list.appendChild(message);
        }
    };
    modal.querySelectorAll("[data-close-manage-modal]").forEach(button => {
        button.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) {
            closeModal();
        }
    });
    renameForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!selectedAccount) {
            return;
        }
        status.classList.remove("error");
        status.textContent = "Saving…";
        try {
            const data = await request(`/api/hoyolab/accounts/${encodeURIComponent(selectedAccount.uid)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nickname: nicknameInput.value })
            });
            selectedAccount.cyrene_nickname = data.nickname;
            status.textContent = "Nickname saved.";
            await loadAccounts();
        }
        catch (error) {
            status.classList.add("error");
            status.textContent = error.message;
        }
    });
    deleteButton.addEventListener("click", async () => {
        if (!selectedAccount ||
            !window.confirm("Remove this HoYoLAB account from Cyrene and Discord?")) {
            return;
        }
        deleteButton.disabled = true;
        status.classList.remove("error");
        status.textContent = "Removing account…";
        try {
            await request(`/api/hoyolab/accounts/${encodeURIComponent(selectedAccount.uid)}`, { method: "DELETE" });
            closeModal();
            await loadAccounts();
        }
        catch (error) {
            deleteButton.disabled = false;
            status.classList.add("error");
            status.textContent = error.message;
        }
    });
    void loadAccounts();
}
function initialiseAccountLinking() {
    const modal = document.getElementById("account-link-modal");
    const openButton = document.getElementById("open-account-link");
    const form = document.getElementById("account-link-form");
    const result = document.getElementById("account-link-result");
    const submit = document.getElementById("account-link-submit");
    if (!modal ||
        !openButton ||
        !form ||
        !result ||
        !submit ||
        form.dataset.initialised === "true") {
        return;
    }
    form.dataset.initialised = "true";
    let pollTimer = null;
    const closeModal = () => {
        modal.hidden = true;
        document.body.classList.remove("settings-modal-open");
        window.clearTimeout(pollTimer);
    };
    const openModal = () => {
        modal.hidden = false;
        form.hidden = false;
        result.innerHTML = "";
        submit.disabled = false;
        submit.textContent = "Continue";
        document.body.classList.add("settings-modal-open");
        document.getElementById("hoyolab-account").focus();
    };
    openButton.addEventListener("click", openModal);
    modal.querySelectorAll("[data-close-account-modal]").forEach(button => {
        button.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) {
            closeModal();
        }
    });
    const showError = message => {
        form.hidden = false;
        result.innerHTML = "";
        const paragraph = document.createElement("p");
        paragraph.className = "account-link-message error";
        paragraph.textContent = message;
        result.appendChild(paragraph);
        submit.disabled = false;
        submit.textContent = "Continue";
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
    const completeAccount = async (token, account) => {
        form.hidden = true;
        result.innerHTML = '<p class="account-link-message">Linking account...</p>';
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
        window.setTimeout(() => {
            window.location.reload();
        }, 2000);
    };
    const showAccountChoices = (token, accounts) => {
        form.hidden = true;
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
                    await completeAccount(token, account);
                }
                catch (error) {
                    button.disabled = false;
                    showError(error.message);
                }
            });
            choices.appendChild(button);
        });
        result.appendChild(choices);
    };
    const poll = async (token) => {
        try {
            const data = await request(`/api/hoyolab/link/status?token=${encodeURIComponent(token)}`);
            if (data.status === "error") {
                showError(data.error);
                return;
            }
            if (data.status === "select") {
                submit.disabled = false;
                if (data.accounts.length === 1) {
                    await completeAccount(token, data.accounts[0]);
                }
                else {
                    showAccountChoices(token, data.accounts);
                }
                return;
            }
            result.innerHTML = "";
            const message = document.createElement("p");
            message.className = "account-link-message";
            if (data.status === "captcha") {
                message.classList.add("warning");
                message.textContent = "HoYoLAB needs a CAPTCHA before continuing. Complete it in the new page, then return here.";
                result.appendChild(message);
                const link = document.createElement("a");
                link.className = "account-link-action";
                link.href = data.challenge_url;
                link.target = "_blank";
                link.rel = "noopener";
                link.textContent = "Complete CAPTCHA";
                result.appendChild(link);
            }
            else {
                message.textContent = "Authenticating with HoYoLAB…";
                result.appendChild(message);
            }
            pollTimer = window.setTimeout(() => poll(token), 1000);
        }
        catch (error) {
            showError(error.message);
        }
    };
    form.addEventListener("submit", async (event) => {
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
        }
        catch (error) {
            showError(error.message);
        }
    });
}
/* =========================================================
   HOVER EFFECTS SETTING
   ========================================================= */
function applyHoverEffectsSetting(enabled) {
    const toggle = document.getElementById("hover-effects-toggle");
    if (enabled) {
        document.documentElement.dataset.hoverEffects = "on";
        localStorage.setItem("hoverEffects", "true");
        if (toggle) {
            toggle.classList.add("active");
            toggle.setAttribute("aria-pressed", "true");
        }
    }
    else {
        document.documentElement.dataset.hoverEffects = "off";
        localStorage.setItem("hoverEffects", "false");
        if (toggle) {
            toggle.classList.remove("active");
            toggle.setAttribute("aria-pressed", "false");
        }
    }
}
