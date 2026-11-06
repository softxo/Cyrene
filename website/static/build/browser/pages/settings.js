// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
function initSettings() {
    // =========================================
    // THEME
    // =========================================
    updateThemeSelection(document.documentElement.dataset.theme);
    initialiseAccountLinking();
    initialiseAccountManagement();
    const unreleasedToggle = document.getElementById("show-unreleased-toggle");
    const applyUnreleased = (enabled) => {
        document.documentElement.dataset.showUnreleased = String(enabled);
        unreleasedToggle?.setAttribute("aria-pressed", String(enabled));
        unreleasedToggle?.classList.toggle("active", enabled);
        window.dispatchEvent(new Event("cyrene-content-preferences-changed"));
    };
    applyUnreleased(document.documentElement.dataset.showUnreleased === "true");
    if (unreleasedToggle && !unreleasedToggle.dataset.initialised) {
        unreleasedToggle.dataset.initialised = "true";
        unreleasedToggle.addEventListener("click", () => {
            const enabled = document.documentElement.dataset.showUnreleased !== "true";
            try {
                localStorage.setItem("cyrene-show-unreleased", String(enabled));
            }
            catch {
                // Keep the preference usable for this page when storage is unavailable.
            }
            applyUnreleased(enabled);
        });
    }
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
    const openModal = (account) => {
        selectedAccount = account;
        details.textContent = `${account.nickname || "Unnamed account"} | UID ${account.uid}`;
        nicknameInput.value = account.cyrene_nickname || "";
        status.textContent = "";
        status.classList.remove("error", "success");
        deleteButton.disabled = false;
        modal.hidden = false;
        document.body.classList.add("settings-modal-open");
        nicknameInput.focus();
    };
    list.addEventListener("cyrene:account-profiles", (event) => {
        for (const account of list.accountProfiles || []) {
            const fresh = event.detail?.find((item) => item.uid === account.uid);
            if (fresh)
                Object.assign(account, fresh);
        }
        if (selectedAccount && !modal.hidden) {
            details.textContent = `${selectedAccount.nickname || "Unnamed account"} | UID ${selectedAccount.uid}`;
        }
    });
    const renderAccounts = (accounts) => {
        list.accountProfiles = accounts;
        list.innerHTML = "";
        if (!accounts.length) {
            const empty = document.createElement("p");
            empty.className = "linked-account-empty";
            empty.textContent = "No HoYoLAB accounts linked yet.";
            list.appendChild(empty);
            return;
        }
        accounts.forEach((account) => {
            const row = document.createElement("div");
            row.className = "linked-account-row";
            const info = document.createElement("div");
            info.className = "linked-account-info";
            const name = document.createElement("strong");
            name.dataset.accountProfileName = account.uid;
            name.dataset.accountProfileField = "display";
            name.textContent = account.cyrene_nickname || account.nickname || "Unnamed account";
            const heading = document.createElement("div");
            heading.className = "linked-account-heading";
            heading.append(name);
            const access = document.createElement("div");
            access.className = "linked-account-discord-access";
            access.setAttribute("aria-label", "Discord accounts with access");
            for (const profile of account.discord_access || []) {
                const badge = document.createElement("span");
                badge.className = "linked-discord-profile";
                const avatar = document.createElement("img");
                avatar.alt = "";
                avatar.width = 36;
                avatar.height = 36;
                const fallback = "/static/images/ui/ui_icons/Discord.png";
                const avatarUrl = typeof profile.avatar_url === "string" ? profile.avatar_url : "";
                avatar.src =
                    /^https:\/\/cdn\.discordapp\.com\/avatars\/\d+\/(?:a_)?[a-f0-9]{16,64}\.png\?size=128$/.test(avatarUrl)
                        ? avatarUrl
                        : fallback;
                avatar.addEventListener("error", () => {
                    avatar.src = fallback;
                }, { once: true });
                const displayName = document.createElement("span");
                displayName.className = "linked-discord-name";
                displayName.textContent = profile.display_name || "Discord account";
                const copy = document.createElement("span");
                copy.className = "linked-discord-copy";
                const title = document.createElement("span");
                title.className = "linked-discord-title";
                const tier = document.createElement("span");
                const accountType = ["premium", "special"].includes(profile.account_type)
                    ? profile.account_type
                    : "normal";
                tier.className = "discord-account-type";
                const tierLabel = document.createElement(accountType === "normal" ? "span" : "b");
                if (accountType !== "normal")
                    tierLabel.className = `discord-account-${accountType}`;
                tierLabel.textContent = accountType[0].toUpperCase() + accountType.slice(1);
                tier.append(tierLabel);
                title.append(displayName, tier);
                copy.append(title);
                badge.append(avatar, copy);
                if (profile.username) {
                    const username = document.createElement("span");
                    username.className = "linked-discord-username";
                    username.textContent = `@${profile.username}`;
                    copy.append(username);
                }
                access.append(badge);
            }
            const meta = document.createElement("span");
            meta.dataset.accountProfileMeta = account.uid;
            meta.textContent = `UID ${account.uid} | AR ${account.level || "Unknown"}`;
            const manage = document.createElement("button");
            manage.type = "button";
            manage.className = "cyrene-button linked-account-manage";
            manage.textContent = "Manage";
            manage.addEventListener("click", () => openModal(account));
            const identity = document.createElement("div");
            identity.className = "linked-account-identity";
            identity.append(heading, meta);
            info.append(identity, access);
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
            message.textContent =
                error.status === 401
                    ? "Verify your Discord account to view and manage linked accounts."
                    : error.message;
            list.appendChild(message);
        }
    };
    modal.querySelectorAll("[data-close-manage-modal]").forEach((button) => {
        button.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" &&
            !modal.hidden &&
            !document.querySelector(".settings-delete-dialog[open]")) {
            closeModal();
        }
    });
    renameForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!selectedAccount) {
            return;
        }
        status.classList.remove("error", "success");
        status.textContent = "Saving…";
        try {
            const data = await request(`/api/hoyolab/accounts/${encodeURIComponent(selectedAccount.uid)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nickname: nicknameInput.value }),
            });
            selectedAccount.cyrene_nickname = data.nickname;
            document.dispatchEvent(new Event("cyrene:account-renamed"));
            status.classList.add("success");
            status.textContent = "Nickname saved.";
            await loadAccounts();
        }
        catch (error) {
            status.classList.add("error");
            status.textContent = error.message;
        }
    });
    const confirmation = document.querySelector(".settings-delete-dialog");
    const confirmButton = confirmation.querySelector("[data-delete-confirm]");
    const cancelButton = confirmation.querySelector("[data-delete-cancel]");
    const cancelRemoval = () => {
        if (!confirmButton.disabled)
            confirmation.close();
    };
    cancelButton.addEventListener("click", cancelRemoval);
    confirmation.addEventListener("cancel", (event) => {
        if (confirmButton.disabled)
            event.preventDefault();
    });
    confirmation.addEventListener("click", (event) => {
        if (event.target === confirmation) {
            const bounds = confirmation.getBoundingClientRect();
            if (event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom)
                cancelRemoval();
        }
    });
    deleteButton.addEventListener("click", () => {
        if (!selectedAccount)
            return;
        confirmation.querySelector("[data-delete-description]").textContent =
            `Remove ${selectedAccount.cyrene_nickname || selectedAccount.nickname || "this account"} (UID ${selectedAccount.uid}) from Cyrene and Discord? Saved game progress will be kept.`;
        confirmation.showModal();
    });
    confirmButton.addEventListener("click", async () => {
        if (!selectedAccount || confirmButton.disabled)
            return;
        confirmButton.disabled = true;
        cancelButton.disabled = true;
        confirmButton.textContent = "Removing...";
        deleteButton.disabled = true;
        status.classList.remove("error", "success");
        status.textContent = "Removing account…";
        try {
            await request(`/api/hoyolab/accounts/${encodeURIComponent(selectedAccount.uid)}`, {
                method: "DELETE",
            });
            confirmation.close();
            closeModal();
            await loadAccounts();
        }
        catch (error) {
            confirmation.close();
            deleteButton.disabled = false;
            status.classList.add("error");
            status.textContent = error.message;
        }
        finally {
            confirmButton.disabled = false;
            cancelButton.disabled = false;
            confirmButton.textContent = "Remove account";
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
    modal.querySelectorAll("[data-close-account-modal]").forEach((button) => {
        button.addEventListener("click", closeModal);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" &&
            !modal.hidden &&
            !document.querySelector(".settings-delete-dialog[open]")) {
            closeModal();
        }
    });
    const showError = (message) => {
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
            body: JSON.stringify({ token, uid: account.game_uid }),
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
                    <svg class="verified-check" viewBox="0 0 24 24" focusable="false">
                        <use href="/static/images/ui/check.svg#check"></use>
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
        accounts.forEach((account) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "account-choice";
            const name = document.createElement("strong");
            name.textContent = account.nickname || "Unnamed account";
            const details = document.createElement("span");
            details.textContent = `UID ${account.game_uid} | AR ${account.level}`;
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
    const showEmailCode = (token, submissionUrl) => {
        form.hidden = true;
        result.replaceChildren();
        const description = document.createElement("p");
        description.className = "account-link-message";
        description.textContent = "Enter the six-digit code HoYoLAB sent to your email.";
        const codeForm = document.createElement("form");
        codeForm.className = "account-link-form account-link-code-form";
        const label = document.createElement("label");
        const labelText = document.createElement("span");
        labelText.textContent = "Verification code";
        const input = document.createElement("input");
        input.className = "cyrene-input";
        input.name = "code";
        input.type = "text";
        input.inputMode = "numeric";
        input.autocomplete = "one-time-code";
        input.maxLength = 6;
        input.pattern = "[0-9]{6}";
        input.required = true;
        input.setAttribute("aria-describedby", "account-link-code-status");
        label.append(labelText, input);
        const verify = document.createElement("button");
        verify.type = "submit";
        verify.className = "cyrene-button";
        verify.textContent = "Verify code";
        const status = document.createElement("p");
        status.id = "account-link-code-status";
        status.className = "account-link-message account-link-code-status";
        status.setAttribute("role", "status");
        codeForm.append(label, verify);
        result.append(description, codeForm, status);
        let checking = false;
        const check = async () => {
            if (checking || !/^[0-9]{6}$/.test(input.value))
                return;
            checking = true;
            verify.disabled = true;
            input.readOnly = true;
            input.removeAttribute("aria-invalid");
            status.classList.remove("error", "success");
            status.textContent = "Checking verification code…";
            try {
                await request(submissionUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code: input.value }),
                });
                result.replaceChildren();
                await poll(token);
            }
            catch (error) {
                status.textContent = error.message;
                status.classList.add("error");
                input.readOnly = false;
                input.setAttribute("aria-invalid", "true");
                input.focus();
                input.select();
                verify.disabled = false;
            }
            finally {
                checking = false;
            }
        };
        input.addEventListener("input", () => {
            input.value = input.value.replace(/[^0-9]/g, "").slice(0, 6);
            input.removeAttribute("aria-invalid");
            if (input.value.length === 6)
                void check();
        });
        codeForm.addEventListener("submit", (event) => {
            event.preventDefault();
            void check();
        });
        input.focus();
    };
    const poll = async (token) => {
        try {
            const data = await request(`/api/hoyolab/link/status?token=${encodeURIComponent(token)}`);
            if (data.status === "error") {
                showError(data.error);
                return;
            }
            if (data.status === "complete") {
                window.location.reload();
                return;
            }
            if (data.status === "email") {
                showEmailCode(token, data.submission_url);
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
                message.textContent =
                    "Complete the CAPTCHA in the temporary tab. It will close automatically; continue here afterwards.";
                result.appendChild(message);
                const link = document.createElement("a");
                link.className = "cyrene-button account-link-action";
                link.href = data.challenge_url;
                link.target = "_blank";
                link.rel = "noopener";
                link.textContent = "Complete verification";
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
                    password: document.getElementById("hoyolab-password").value,
                }),
            });
            document.getElementById("hoyolab-password").value = "";
            await poll(data.token);
        }
        catch (error) {
            showError(error.message);
        }
    });
    const resumeUrl = new URL(window.location.href);
    const resumeToken = resumeUrl.searchParams.get("link_attempt");
    if (resumeToken) {
        resumeUrl.searchParams.delete("link_attempt");
        window.history.replaceState(null, "", resumeUrl);
        openModal();
        form.hidden = true;
        void poll(resumeToken);
    }
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
