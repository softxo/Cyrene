
/* =========================================================
   CODES PAGE
   ========================================================= */

(() => {
    const page = document.querySelector(".codes-page");

    if (!page) {
        return;
    }

    const list = document.getElementById("codes-list");
    const count = document.getElementById("codes-count");
    const accountSelect = document.getElementById("codes-account");
    const refreshButton = document.getElementById("codes-refresh-button");
    const statusBox = document.getElementById("codes-status");

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

    function createElement(tag, className, text) {
        const element = document.createElement(tag);
        element.className = className;
        element.textContent = text;
        return element;
    }

    async function fetchCodes() {
        refreshButton.disabled = true;
        refreshButton.textContent = "Refreshing…";
        list.replaceChildren(
            createElement("div", "codes-loading", "Loading available codes…")
        );

        clearStatus();

        try {
            const response = await fetch("/api/codes", {
                method: "GET",
                credentials: "same-origin",
                headers: {
                    Accept: "application/json",
                },
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.detail || "Unable to load gift codes."
                );
            }

            availableCodes = Array.isArray(data.codes) ? data.codes : [];
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

            const claimButton = createElement(
                "button",
                "codes-claim-button",
                "Claim"
            );

            claimButton.type = "button";
            claimButton.disabled = !accountSelect || accountSelect.disabled;

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
        } catch (error) {
            showStatus(
                `${code}: ${error.message || "Redemption failed."}`,
                "error"
            );

            button.textContent = "Retry";
            button.disabled = false;
        }
    }

    refreshButton.addEventListener("click", fetchCodes);

    fetchCodes();
})();