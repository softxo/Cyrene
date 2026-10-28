// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
async function loadPlanner() {
    const loading = document.getElementById("planner-loading");
    const content = document.getElementById("planner-content");
    const error = document.getElementById("planner-error");
    try {
        const response = await fetch("/api/planner", {
            credentials: "same-origin",
            signal: plannerAbortController?.signal
        });
        if (response.status === 401) {
            window.location.href = "/";
            return;
        }
        if (!response.ok) {
            throw new Error("Failed to load planner data.");
        }
        const plannerData = await response.json();
        loading.hidden = true;
        content.hidden = false;
        renderPlanner(plannerData);
    }
    catch (exception) {
        /*
         * Aborting the request is expected when
         * leaving the Planner.
         */
        if (exception.name === "AbortError") {
            return;
        }
        console.error(exception);
        loading.hidden = true;
        error.hidden = false;
    }
}
function renderPlanner(plannerData) {
    window.plannerAccounts =
        plannerData.accounts || [];
    const accounts = document.getElementById("accounts");
    const reminders = document.getElementById("reminders");
    accounts.innerHTML = "";
    reminders.innerHTML = "";
    /* ================================
       Accounts
       ================================ */
    for (const account of plannerData.accounts) {
        const card = document.createElement("div");
        card.className = "planner-card";
        card.dataset.genshinUid =
            account.genshin_uid;
        const name = account.nickname
            || account.genshin_uid;
        card.innerHTML = `
            <h2>${name}</h2>

            <p>
                UID: ${account.genshin_uid}
            </p>

            <p>
                AR: ${account.level ?? "Unknown"}
            </p>

            <hr>

            <p class="resin-value">

                <img
                    src="/static/images/misc/Original_Resin.webp"
                    alt="Resin"
                    class="resin-icon"
                >

                <strong
                    data-resin-current="${account.current_resin}"
                    data-resin-max="${account.max_resin}"
                >
                    ${account.current_resin}
                    /
                    ${account.max_resin}
                </strong>

                Resin

            </p>

            <hr>

            <p class="planner-resin-timing">
                Replenished

                <span
                    class="resin-countdown"
                    data-timestamp="${account.replenished_at ?? ""}"
                >
                    ${account.replenished_at === null
            ? "Full"
            : "Loading..."}
                </span>
            </p>

            <p class="planner-resin-timing">
                Fully Replenished

                <span
                    class="resin-full-countdown"
                    data-full-timestamp="${account.full_resin_at ?? ""}"
                >
                    ${account.full_resin_at === null
            ? "Full"
            : "Loading..."}
                </span>
            </p>
        `;
        accounts.appendChild(card);
    }
    if (plannerData.accounts.length === 0) {
        accounts.innerHTML = `
            <div class="planner-empty">
                No Genshin accounts are linked.
            </div>
        `;
    }
    /* ================================
       Reminders
       ================================ */
    for (const reminder of plannerData.reminders) {
        const card = document.createElement("div");
        card.className =
            "reminder-card";
        const amount = reminder.config?.amount;
        const type = reminder.type
            || "Unknown";
        const mode = reminder.mode
            || "Unknown";
        /*
         * Capitalise the reminder type.
         */
        const displayType = type.charAt(0).toUpperCase()
            + type.slice(1);
        /*
         * Capitalise the reminder mode.
         */
        const displayMode = mode.charAt(0).toUpperCase()
            + mode.slice(1);
        /*
         * Resin amount.
         */
        let amountHTML = "—";
        if (amount !== undefined
            && amount !== null) {
            if (type.toLowerCase() === "resin") {
                amountHTML = `
                    <img
                        src="/static/images/misc/Original_Resin.webp"
                        alt="Resin"
                        class="reminder-resin-icon"
                    >

                    ${amount}
                `;
            }
            else {
                amountHTML =
                    `${amount}`;
            }
        }
        card.innerHTML = `

            <div class="reminder-main">

                <h3 class="reminder-name">
                    ${reminder.account_nickname || "Account"}
                </h3>

            </div>


            <div class="reminder-detail">

                <span class="reminder-label">
                    Type
                </span>

                <span class="reminder-value">
                    ${displayType}
                </span>

            </div>


            <div class="reminder-detail">

                <span class="reminder-label">
                    Mode
                </span>

                <span class="reminder-value">
                    ${displayMode}
                </span>

            </div>


            <div class="reminder-detail">

                <span class="reminder-label">
                    Amount
                </span>

                <span class="reminder-value">
                    ${amountHTML}
                </span>

            </div>

            <button
                type="button"
                class="reminder-delete-button"
                data-reminder-id="${reminder.id}"
                aria-label="Delete reminder"
                title="Delete reminder"
            >
                <img
                    src="/static/images/ui/ui_buttons/Delete.png"
                    alt=""
                >
            </button>

        `;
        reminders.appendChild(card);
    }
    if (plannerData.reminders.length === 0) {
        reminders.innerHTML = `
            <div class="planner-empty">
                No reminders configured.
            </div>
        `;
    }
    updateTimestamps();
}
function updateTimestamps() {
    document
        .querySelectorAll(".planner-card")
        .forEach(card => {
        const resinValue = card.querySelector("[data-resin-current]");
        const replenished = card.querySelector("[data-timestamp]");
        const fullyReplenished = card.querySelector("[data-full-timestamp]");
        if (!resinValue ||
            !replenished) {
            return;
        }
        let currentResin = Number(resinValue.dataset.resinCurrent);
        const maxResin = Number(resinValue.dataset.resinMax);
        /*
         * Update the Resin regeneration timer.
         */
        const timestamp = Number(replenished.dataset.timestamp);
        if (timestamp) {
            const seconds = timestamp -
                Math.floor(Date.now() / 1000);
            if (seconds <= 0) {
                currentResin =
                    Math.min(currentResin + 1, maxResin);
                resinValue.dataset.resinCurrent =
                    currentResin;
                resinValue.textContent =
                    `${currentResin} / ${maxResin}`;
                /*
                 * Resin is now completely full.
                 */
                if (currentResin >= maxResin) {
                    replenished.textContent =
                        "Full";
                    replenished.removeAttribute("data-timestamp");
                    if (fullyReplenished) {
                        fullyReplenished.textContent =
                            "Full";
                        fullyReplenished.removeAttribute("data-full-timestamp");
                    }
                    return;
                }
                /*
                 * Start the next Resin timer.
                 */
                const nextTimestamp = Math.floor(Date.now() / 1000) + 480;
                replenished.dataset.timestamp =
                    nextTimestamp;
            }
            updateCountdown(replenished, Number(replenished.dataset.timestamp));
        }
        /*
         * Update Fully Replenished timer.
         */
        if (fullyReplenished &&
            fullyReplenished.dataset.fullTimestamp) {
            updateCountdown(fullyReplenished, Number(fullyReplenished.dataset.fullTimestamp));
        }
    });
}
async function refreshResin() {
    try {
        const response = await fetch("/api/planner", {
            credentials: "same-origin",
            signal: plannerAbortController?.signal
        });
        if (response.status === 401) {
            window.location.href = "/";
            return;
        }
        if (!response.ok) {
            throw new Error("Failed to refresh Resin data.");
        }
        const plannerData = await response.json();
        for (const account of plannerData.accounts || []) {
            const card = document.querySelector(`.planner-card[data-genshin-uid="${account.genshin_uid}"]`);
            if (!card) {
                continue;
            }
            /*
             * -------------------------------
             * Resin value
             * -------------------------------
             */
            const resinValue = card.querySelector("[data-resin-current]");
            if (resinValue) {
                resinValue.dataset.resinCurrent =
                    account.current_resin;
                resinValue.dataset.resinMax =
                    account.max_resin;
                resinValue.textContent =
                    `${account.current_resin} / ${account.max_resin}`;
            }
            /*
             * -------------------------------
             * Replenished timer
             * -------------------------------
             */
            const replenished = card.querySelector("[data-timestamp]");
            if (replenished) {
                if (account.replenished_at === null) {
                    replenished.textContent =
                        "Full";
                    replenished.dataset.timestamp =
                        "";
                }
                else {
                    replenished.dataset.timestamp =
                        account.replenished_at;
                    replenished.textContent =
                        "Loading...";
                }
            }
            /*
             * -------------------------------
             * Fully replenished timer
             * -------------------------------
             */
            const fullyReplenished = card.querySelector("[data-full-timestamp]");
            if (fullyReplenished) {
                if (account.full_resin_at === null) {
                    fullyReplenished.textContent =
                        "Full";
                    fullyReplenished.dataset.fullTimestamp =
                        "";
                }
                else {
                    fullyReplenished.dataset.fullTimestamp =
                        account.full_resin_at;
                    fullyReplenished.textContent =
                        "Loading...";
                }
            }
        }
        /*
         * Immediately recalculate the
         * countdown using the new server data.
         */
        updateTimestamps();
    }
    catch (exception) {
        /*
         * Aborting the request is expected when
         * leaving the Planner.
         */
        if (exception.name === "AbortError") {
            return;
        }
        console.error("Failed to refresh Resin:", exception);
    }
}
function updateCountdown(element, timestamp) {
    const seconds = Math.max(0, timestamp -
        Math.floor(Date.now() / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (hours > 0) {
        element.textContent =
            `in ${hours}h ${minutes}m ${remainingSeconds}s`;
        return;
    }
    if (minutes > 0) {
        element.textContent =
            `in ${minutes}m ${remainingSeconds}s`;
        return;
    }
    element.textContent =
        `in ${remainingSeconds}s`;
}
function openReminderPanel() {
    const panel = document.getElementById("reminder-panel");
    const accountInput = document.getElementById("reminder-account");
    const accountButton = document.getElementById("reminder-account-button");
    const accountValue = document.getElementById("reminder-account-value");
    const accountMenu = document.getElementById("reminder-account-menu");
    const accountSelect = document.getElementById("reminder-account-select");
    if (!panel ||
        !accountInput ||
        !accountButton ||
        !accountValue ||
        !accountMenu ||
        !accountSelect) {
        return;
    }
    /*
     * Reset the account selector.
     */
    accountInput.value = "";
    accountValue.textContent =
        "Select Account";
    accountMenu.innerHTML = "";
    /*
     * Populate the custom account selector.
     */
    for (const account of window.plannerAccounts || []) {
        const option = document.createElement("button");
        option.type = "button";
        option.className =
            "custom-select-option";
        option.dataset.value =
            account.genshin_uid;
        option.textContent =
            account.nickname
                ? `${account.nickname} (${account.genshin_uid})`
                : account.genshin_uid;
        option.addEventListener("click", () => {
            accountInput.value =
                account.genshin_uid;
            accountValue.textContent =
                option.textContent;
            /*
             * Update selected state.
             */
            accountMenu
                .querySelectorAll(".custom-select-option")
                .forEach(item => {
                item.classList.remove("selected");
            });
            option.classList.add("selected");
            /*
             * Close the dropdown.
             */
            accountSelect.classList.remove("open");
        });
        accountMenu.appendChild(option);
    }
    /*
     * Open the reminder panel.
     */
    panel.hidden = false;
}
function closeReminderPanel() {
    const panel = document.getElementById("reminder-panel");
    if (!panel) {
        return;
    }
    panel.classList.add("closing");
    setTimeout(() => {
        panel.hidden = true;
        panel.classList.remove("closing");
    }, 180);
}
function initialiseReminderPanel() {
    const panel = document.getElementById("reminder-panel");
    if (!panel) {
        return;
    }
    if (panel.dataset.initialized === "true") {
        return;
    }
    panel.dataset.initialized = "true";
    const addButton = document.getElementById("add-reminder-button");
    const closeButton = document.getElementById("reminder-close-button");
    const cancelButton = document.getElementById("reminder-cancel-button");
    const saveButton = document.getElementById("reminder-save-button");
    /*
     * Open / close the Reminder panel.
     */
    if (addButton) {
        addButton.addEventListener("click", openReminderPanel);
    }
    if (closeButton) {
        closeButton.addEventListener("click", closeReminderPanel);
    }
    if (cancelButton) {
        cancelButton.addEventListener("click", closeReminderPanel);
    }
    if (saveButton) {
        saveButton.addEventListener("click", saveReminder);
    }
    /*
     * Initialise all custom selects.
     */
    document
        .querySelectorAll(".custom-select")
        .forEach(select => {
        const button = select.querySelector(".custom-select-button");
        const hiddenInput = select.parentElement.querySelector('input[type="hidden"]');
        const valueDisplay = select.querySelector(".custom-select-button span");
        const options = select.querySelectorAll(".custom-select-option:not(:disabled)");
        if (!button ||
            !hiddenInput ||
            !valueDisplay) {
            return;
        }
        /*
         * Open / close dropdown.
         */
        button.addEventListener("click", event => {
            event.stopPropagation();
            /*
             * Close every other dropdown.
             */
            document
                .querySelectorAll(".custom-select.open")
                .forEach(otherSelect => {
                if (otherSelect !== select) {
                    otherSelect.classList.remove("open");
                }
            });
            select.classList.toggle("open");
        });
        /*
         * Select an option.
         */
        options.forEach(option => {
            option.addEventListener("click", event => {
                event.stopPropagation();
                hiddenInput.value =
                    option.dataset.value;
                valueDisplay.textContent =
                    option.textContent.trim();
                /*
                 * Update selected state.
                 */
                options.forEach(item => {
                    item.classList.remove("selected");
                });
                option.classList.add("selected");
                /*
                 * Close dropdown.
                 */
                select.classList.remove("open");
            });
        });
    });
    /*
     * Custom number spinner buttons.
     *
     * Supports:
     * - Single click
     * - Press and hold
     * - Rapid repeated changes while held
     */
    document
        .querySelectorAll(".number-spinner-button")
        .forEach(button => {
        let holdInterval = null;
        let holdTimeout = null;
        function changeValue() {
            const input = button
                .closest(".custom-input-wrapper")
                ?.querySelector('input[type="number"]');
            if (!input) {
                return;
            }
            const min = Number(input.min) || 1;
            const max = Number(input.max) || 200;
            const current = Number(input.value) || min;
            const direction = button.dataset.direction;
            let value = current;
            if (direction === "up") {
                value = Math.min(current + 1, max);
            }
            if (direction === "down") {
                value = Math.max(current - 1, min);
            }
            /*
             * Don't continue doing anything once
             * the limit has been reached.
             */
            if (value === current) {
                return;
            }
            input.value = value;
            input.dispatchEvent(new Event("input", {
                bubbles: true
            }));
            input.dispatchEvent(new Event("change", {
                bubbles: true
            }));
        }
        function startHolding(event) {
            /*
             * Only react to the primary mouse button.
             */
            if (event.type === "mousedown"
                && event.button !== 0) {
                return;
            }
            /*
             * Prevent the browser from selecting
             * text while holding the button.
             */
            event.preventDefault();
            /*
             * First increment happens immediately.
             */
            changeValue();
            /*
             * Wait briefly before starting the
             * rapid-repeat behaviour.
             */
            holdTimeout =
                setTimeout(() => {
                    holdInterval =
                        setInterval(changeValue, 50);
                }, 350);
        }
        function stopHolding() {
            if (holdTimeout) {
                clearTimeout(holdTimeout);
                holdTimeout = null;
            }
            if (holdInterval) {
                clearInterval(holdInterval);
                holdInterval = null;
            }
        }
        button.addEventListener("mousedown", startHolding);
        button.addEventListener("mouseup", stopHolding);
        button.addEventListener("mouseleave", stopHolding);
        /*
         * Prevent the normal click event from
         * causing a second increment after
         * mouseup.
         */
        button.addEventListener("click", event => {
            event.preventDefault();
        });
        /*
         * Also support touch devices.
         */
        button.addEventListener("touchstart", startHolding, {
            passive: false
        });
        button.addEventListener("touchend", stopHolding);
        button.addEventListener("touchcancel", stopHolding);
    });
    /*
     * Close all custom selects when clicking
     * elsewhere on the page.
     */
    document.addEventListener("click", () => {
        document
            .querySelectorAll(".custom-select.open")
            .forEach(select => {
            select.classList.remove("open");
        });
    });
    /*
     * Delete reminder buttons.
     */
    const reminders = document.getElementById("reminders");
    if (reminders) {
        reminders.addEventListener("click", event => {
            const button = event.target.closest(".reminder-delete-button");
            if (!button) {
                return;
            }
            deleteReminder(button.dataset.reminderId);
        });
    }
}
let plannerToastTimeout = null;
function showPlannerToast(message) {
    const toast = document.getElementById("planner-toast");
    const toastMessage = document.getElementById("planner-toast-message");
    if (!toast ||
        !toastMessage) {
        return;
    }
    /*
     * Cancel any previous timeout.
     */
    if (plannerToastTimeout) {
        clearTimeout(plannerToastTimeout);
        plannerToastTimeout = null;
    }
    /*
     * Update the message.
     */
    toastMessage.textContent =
        message;
    /*
     * Show the toast.
     */
    toast.classList.add("show");
    /*
     * Hide it after 3 seconds.
     */
    plannerToastTimeout =
        setTimeout(() => {
            toast.classList.remove("show");
            plannerToastTimeout = null;
        }, 3000);
}
async function saveReminder() {
    const typeInput = document.getElementById("reminder-type");
    const accountInput = document.getElementById("reminder-account");
    const amountInput = document.getElementById("reminder-amount");
    const saveButton = document.getElementById("reminder-save-button");
    const type = typeInput?.value;
    const genshinUid = accountInput?.value;
    if (!type) {
        alert("Please select a reminder type.");
        return;
    }
    if (!genshinUid) {
        alert("Please select a Genshin account.");
        return;
    }
    const config = {};
    /*
     * Resin-specific configuration.
     */
    if (type === "resin") {
        const amount = Number(amountInput?.value);
        if (!Number.isInteger(amount)
            || amount < 1
            || amount > 200) {
            alert("Resin must be between 1 and 200.");
            return;
        }
        config.amount = amount;
    }
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent =
            "Saving...";
    }
    try {
        const response = await fetch("/api/planner/reminders", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                type: type,
                mode: "automatic",
                genshin_uid: genshinUid,
                config: config,
                delivery_type: "dm"
            })
        });
        if (response.status === 401) {
            window.location.href = "/";
            return;
        }
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail
                || "Failed to save reminder.");
        }
        closeReminderPanel();
        showPlannerToast("Reminder added successfully.");
        await loadPlanner();
    }
    catch (exception) {
        console.error(exception);
        alert(exception.message
            || "Failed to save reminder.");
    }
    finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent =
                "Add Reminder";
        }
    }
}
async function deleteReminder(reminderId) {
    if (!reminderId) {
        return;
    }
    const button = document.querySelector(`.reminder-delete-button[data-reminder-id="${reminderId}"]`);
    const card = button?.closest(".reminder-card");
    /*
     * Start the delete request immediately.
     */
    const deleteRequest = fetch(`/api/planner/reminders/${reminderId}`, {
        method: "DELETE",
        credentials: "same-origin"
    });
    /*
     * Start the visual removal animation.
     */
    if (card) {
        card.classList.add("removing");
    }
    try {
        const response = await deleteRequest;
        if (response.status === 401) {
            window.location.href = "/";
            return;
        }
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail
                || "Failed to delete reminder.");
        }
        /*
         * Wait for the removal animation to finish.
         */
        if (card) {
            await new Promise(resolve => {
                setTimeout(resolve, 180);
            });
            card.remove();
        }
        /*
         * Show success notification.
         */
        showPlannerToast("Reminder deleted successfully.");
        /*
         * Refresh planner data so the local
         * state remains accurate.
         */
        await loadPlanner();
    }
    catch (exception) {
        console.error(exception);
        /*
         * Restore the planner if deletion failed.
         */
        await loadPlanner();
        alert(exception.message
            || "Failed to delete reminder.");
    }
}
let plannerAbortController = null;
window.plannerRefreshInterval = null;
window.initPlanner = function () {
    initialiseReminderPanel();
    /*
     * Stop any previous Planner timer.
     */
    if (window.plannerInterval) {
        clearInterval(window.plannerInterval);
        window.plannerInterval = null;
    }
    if (window.plannerRefreshInterval) {
        clearInterval(window.plannerRefreshInterval);
        window.plannerRefreshInterval = null;
    }
    /*
     * Cancel any previous API request.
     */
    if (plannerAbortController) {
        plannerAbortController.abort();
    }
    /*
     * Start a new API request.
     */
    plannerAbortController =
        new AbortController();
    loadPlanner();
    /*
     * Start the Resin countdown.
     */
    window.plannerInterval =
        setInterval(updateTimestamps, 1_000);
    /*
     * Refresh Resin from HoYoLAB every 30 seconds.
     */
    window.plannerRefreshInterval =
        setInterval(refreshResin, 30_000);
};
