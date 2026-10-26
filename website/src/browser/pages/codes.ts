// @ts-nocheck -- Legacy global script; types will be tightened incrementally.

/* =========================================================
   CODES PAGE
   ========================================================= */

function initCodes() {
    const page = document.querySelector(".codes-page");

    if (!page || page.dataset.initialised === "true") {
        return;
    }

    page.dataset.initialised = "true";

    const list = document.getElementById("codes-list");
    const count = document.getElementById("codes-count");
    const accountSelect = document.getElementById("codes-account");
    const refreshButton = document.getElementById("codes-refresh-button");
    const statusBox = document.getElementById("codes-status");

    const accountDropdown = document.getElementById("codes-account-select");
    const accountButton = document.getElementById("codes-account-button");
    const accountLabel = document.getElementById("codes-account-label");
    const accountMenu = document.getElementById("codes-account-menu");

    const autoClaimToggle = document.getElementById("codes-auto-claim-toggle");
    const autoClaimStatus = document.getElementById("codes-automatic-status");

    const autoCheckinToggle = document.getElementById(
        "codes-auto-checkin-toggle"
    );
    const autoCheckinStatus = document.getElementById(
        "codes-auto-checkin-status"
    );

    let autoClaimEnabled = false;
    let autoCheckinEnabled = false;

    let availableCodes = [];

    function showStatus(message, state = "info") {
        statusBox.textContent = message;
        statusBox.dataset.state = state;
        statusBox.hidden = false;
    }

    function clearStatus() {
        statusBox.textContent = "";
        statusBox.hidden = true;
        delete statusBox.dataset.state;
    }

    function initialiseAccountDropdown() {
        if (!accountDropdown || !accountButton || !accountMenu) {
            return;
        }

        accountButton.addEventListener("click", () => {
            if (accountButton.disabled) {
                return;
            }

            const isOpen = accountDropdown.classList.toggle("open");

            accountButton.setAttribute("aria-expanded", String(isOpen));
        });

        accountMenu.querySelectorAll(".custom-select-option").forEach(option => {
            option.addEventListener("click", () => {
                accountSelect.value = option.dataset.value;
                accountLabel.textContent = option.dataset.label;

                accountMenu.querySelectorAll(".custom-select-option").forEach(item => {
                    const selected = item === option;

                    item.classList.toggle("selected", selected);
                    item.setAttribute("aria-selected", String(selected));
                });

                accountDropdown.classList.remove("open");
                accountButton.setAttribute("aria-expanded", "false");

                clearStatus();
                fetchCodes();
            });
        });

        document.addEventListener("click", event => {
            if (!accountDropdown.contains(event.target)) {
                accountDropdown.classList.remove("open");
                accountButton.setAttribute("aria-expanded", "false");
            }
        });

        document.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                accountDropdown.classList.remove("open");
                accountButton.setAttribute("aria-expanded", "false");
            }
        });
    }

    function createElement(tag, className, text) {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        return element;
    }

    async function fetchCodes() {
        const accountId = accountSelect?.value;

        if (!accountId) {
            availableCodes = [];
            renderCodes();

            if (autoClaimToggle) {
                autoClaimToggle.checked = false;
                autoClaimToggle.disabled = true;
            }

            if (autoCheckinToggle) {
                autoCheckinToggle.checked = false;
                autoCheckinToggle.disabled = true;
            }

            if (autoCheckinStatus) {
                autoCheckinStatus.textContent =
                    "Connect a Genshin account to configure automatic daily check-in.";
                autoCheckinStatus.dataset.state = "disabled";
            }

            if (autoClaimStatus) {
                autoClaimStatus.textContent =
                    "Connect a Genshin account to configure automatic claiming.";
            }

            return;
        }

        refreshButton.disabled = true;
        refreshButton.textContent = "Refreshing…";

        list.replaceChildren(
            createElement("div", "codes-loading", "Loading available codes…")
        );

        clearStatus();

        try {
            const response = await fetch(
                `/api/codes?account_id=${encodeURIComponent(accountId)}`,
                {
                    method: "GET",
                    credentials: "same-origin",
                    headers: {
                        Accept: "application/json",
                    },
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.detail || "Unable to load gift codes."
                );
            }

            availableCodes = Array.isArray(data.codes)
                ? data.codes
                : [];

            autoClaimEnabled = data.auto_claim_enabled === true;

            autoCheckinEnabled = data.auto_checkin_enabled === true;

            if (autoCheckinToggle) {
                autoCheckinToggle.checked = autoCheckinEnabled;
                autoCheckinToggle.disabled = false;
            }

            updateAutoCheckinStatus(data);

            if (autoClaimToggle) {
                autoClaimToggle.checked = autoClaimEnabled;
                autoClaimToggle.disabled = false;
            }

            updateAutoClaimStatus();
            renderCodes();
        } catch (error) {
            list.replaceChildren(
                createElement(
                    "div",
                    "codes-error",
                    error.message || "Unable to load gift codes."
                )
            );

            count.textContent = "Unavailable";
        } finally {
            refreshButton.disabled = false;
            refreshButton.textContent = "Refresh Codes";
        }
    }

    function updateAutoClaimStatus() {
        if (!autoClaimStatus) {
            return;
        }

        if (autoClaimEnabled) {
            autoClaimStatus.textContent =
                "Automatic claiming is enabled for this account.";
            autoClaimStatus.dataset.state = "enabled";
        } else {
            autoClaimStatus.textContent =
                "Automatic claiming is disabled for this account.";
            autoClaimStatus.dataset.state = "disabled";
        }
    }

    function updateAutoCheckinStatus(data = {}) {
        if (!autoCheckinStatus) {
            return;
        }

        if (autoCheckinEnabled) {
            if (
                data.checkin_last_status === "claimed"
                || data.checkin_last_status === "already_claimed"
            ) {
                autoCheckinStatus.textContent =
                    data.checkin_last_message
                    || "Today's daily check-in has been completed.";
            } else {
                autoCheckinStatus.textContent =
                    "Automatic daily check-in is enabled for this account.";
            }

            autoCheckinStatus.dataset.state = "enabled";
        } else {
            autoCheckinStatus.textContent =
                "Automatic daily check-in is disabled for this account.";
            autoCheckinStatus.dataset.state = "disabled";
        }
    }

    async function saveAutoClaimSetting(enabled) {
        const accountId = accountSelect?.value;

        if (!accountId || !autoClaimToggle) {
            return;
        }

        autoClaimToggle.disabled = true;

        if (autoClaimStatus) {
            autoClaimStatus.textContent = "Saving automatic claiming setting…";
            autoClaimStatus.dataset.state = "saving";
        }

        try {
            const response = await fetch("/api/codes/automatic", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    account_id: Number(accountId),
                    enabled,
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(
                    data.detail || "Unable to save automatic claiming."
                );
            }

            // Only update the visible setting if the same account is selected.
            if (accountSelect?.value === accountId) {
                autoClaimEnabled = data.auto_claim_enabled === true;
                autoClaimToggle.checked = autoClaimEnabled;
                updateAutoClaimStatus();
            }
        } catch (error) {
            if (accountSelect?.value === accountId) {
                autoClaimToggle.checked = autoClaimEnabled;

                if (autoClaimStatus) {
                    autoClaimStatus.textContent =
                        error.message || "Unable to save automatic claiming.";
                    autoClaimStatus.dataset.state = "error";
                }

                showStatus(
                    error.message || "Unable to save automatic claiming.",
                    "error"
                );
            }
        } finally {
            if (accountSelect?.value === accountId) {
                autoClaimToggle.disabled = false;
            }
        }
    }

    async function saveAutoCheckinSetting(enabled) {
        const accountId = accountSelect?.value;

        if (!accountId || !autoCheckinToggle) {
            return;
        }

        autoCheckinToggle.disabled = true;

        if (autoCheckinStatus) {
            autoCheckinStatus.textContent =
                "Saving daily check-in setting…";
            autoCheckinStatus.dataset.state = "saving";
        }

        try {
            const response = await fetch("/api/codes/daily-checkin", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    account_id: Number(accountId),
                    enabled,
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(
                    data.detail || "Unable to save daily check-in setting."
                );
            }

            if (accountSelect?.value === accountId) {
                autoCheckinEnabled = data.auto_checkin_enabled === true;
                autoCheckinToggle.checked = autoCheckinEnabled;
                updateAutoCheckinStatus();
            }
        } catch (error) {
            if (accountSelect?.value === accountId) {
                autoCheckinToggle.checked = autoCheckinEnabled;

                if (autoCheckinStatus) {
                    autoCheckinStatus.textContent =
                        error.message
                        || "Unable to save daily check-in setting.";
                    autoCheckinStatus.dataset.state = "error";
                }

                showStatus(
                    error.message
                    || "Unable to save daily check-in setting.",
                    "error"
                );
            }
        } finally {
            if (accountSelect?.value === accountId) {
                autoCheckinToggle.disabled = false;
            }
        }
    }


    function renderCodes() {
        list.replaceChildren();
        count.textContent = `${availableCodes.length} ${
            availableCodes.length === 1 ? "code" : "codes"
        }`;

        if (availableCodes.length === 0) {
            list.append(
                createElement(
                    "div",
                    "codes-empty",
                    "No currently available codes were found."
                )
            );
            return;
        }

        for (const item of availableCodes) {
            const card = createElement("article", "codes-item", "");
            const details = createElement("div", "codes-item-details", "");
            const code = createElement(
                "h3",
                "codes-item-code",
                item.code
            );
            const rewards = createElement(
                "p",
                "codes-item-rewards",
                item.rewards || "Rewards not listed"
            );

            const savedStatus = item.redemption_status;

            const buttonLabel = {
                submitted: "Submitted",
                processing: "Claiming…",
                failed: "Retry",
            };

            const claimButton = createElement(
                "button",
                "codes-claim-button",
                buttonLabel[savedStatus] || "Claim"
            );

            claimButton.type = "button";
            claimButton.disabled =
                !accountSelect?.value || accountSelect.disabled;

            if (
                savedStatus === "submitted"
                || savedStatus === "processing"
            ) {
                claimButton.disabled = true;
            }

            claimButton.addEventListener("click", () => {
                redeemCode(item.code, claimButton);
            });

            details.append(code, rewards);
            card.append(details, claimButton);
            list.append(card);
        }
    }

    async function redeemCode(code, button) {
        const accountId = accountSelect?.value;

        if (!accountId) {
            showStatus("Select a Genshin account first.", "error");
            return;
        }

        button.disabled = true;
        button.textContent = "Claiming…";
        clearStatus();

        try {
            const response = await fetch("/api/codes/redeem", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                body: JSON.stringify({
                    code,
                    account_id: Number(accountId),
                }),
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(
                    data.message || data.detail || "Redemption failed."
                );
            }

            showStatus(
                `${code}: ${data.message || "Redemption request completed."}`,
                "success"
            );

            button.textContent = "Submitted";
            button.disabled = true;

            const item = availableCodes.find(
                entry => entry.code === code
            );

            if (item) {
                item.redemption_status = "submitted";
                item.redemption_message = data.message;
            }
        } catch (error) {
            showStatus(
                `${code}: ${error.message || "Redemption failed."}`,
                "error"
            );

            button.textContent = "Retry";
            button.disabled = false;
        }
    }

    initialiseAccountDropdown();

    autoClaimToggle?.addEventListener("change", () => {
        saveAutoClaimSetting(autoClaimToggle.checked);
    });

    autoCheckinToggle?.addEventListener("change", () => {
        saveAutoCheckinSetting(autoCheckinToggle.checked);
    });

    refreshButton.addEventListener("click", fetchCodes);

    fetchCodes();
}

window.initCodes = initCodes;
