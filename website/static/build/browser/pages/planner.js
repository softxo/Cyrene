// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
function escapePlannerHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
        const replacements = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        };
        return replacements[character];
    });
}
async function loadPlanner() {
    const loading = document.getElementById("planner-loading");
    const content = document.getElementById("planner-content");
    const error = document.getElementById("planner-error");
    try {
        const response = await fetch("/api/reminders", {
            credentials: "same-origin",
            signal: plannerAbortController?.signal,
        });
        if (response.status === 401) {
            window.location.href = "/";
            return;
        }
        if (!response.ok) {
            throw new Error("Failed to load reminders.");
        }
        const plannerData = await response.json();
        loading.hidden = true;
        content.hidden = false;
        renderPlanner(plannerData);
    }
    catch (exception) {
        /*
         * Aborting the request is expected when
         * leaving Reminders.
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
    window.plannerAccounts = plannerData.accounts || [];
    window.plannerReminders = plannerData.reminders || [];
    const accounts = document.getElementById("accounts");
    if (accounts) {
        setAccountGridLayout(accounts, window.plannerAccounts.length);
        accounts.innerHTML = "";
        for (const account of window.plannerAccounts) {
            const card = document.createElement("div");
            card.className = "planner-card";
            card.dataset.genshinUid = account.genshin_uid;
            const name = escapePlannerHtml(getPlannerAccountName(account));
            const uid = escapePlannerHtml(account.genshin_uid);
            const level = escapePlannerHtml(account.level ?? "Unknown");
            const currentResin = escapePlannerHtml(account.current_resin);
            const maxResin = escapePlannerHtml(account.max_resin);
            card.innerHTML = `
                <header class="planner-card-heading">
                    <div class="planner-account-name"><h2 data-account-profile-name="${uid}" data-account-profile-field="display">${name}</h2></div>
                    <div class="planner-account-rank" aria-label="Adventure Rank ${level}">
                        <span>AR</span><strong data-account-profile-rank="${uid}">${level}</strong>
                    </div>
                </header>
                <p class="planner-account-uid">UID <strong>${uid}</strong></p>
                <div class="planner-resin-summary">
                    <span class="planner-resin-icon-wrap">
                        <img src="/static/images/misc/Original_Resin.webp" alt="" class="resin-icon">
                    </span>
                    <div class="planner-resin-current">
                        <span class="planner-card-overline">Current Resin</span>
                        <strong data-resin-current="${currentResin}" data-resin-max="${maxResin}"><span class="planner-resin-current-value">${currentResin}</span><span class="planner-resin-maximum">/ ${maxResin}</span></strong>
                    </div>
                </div>
                <div class="planner-resin-timers">
                    <div class="planner-resin-timer">
                        <span class="planner-timer-label">Replenished</span>
                        <strong class="resin-countdown" data-timestamp="${account.replenished_at ?? ""}">${account.replenished_at === null ? "Full" : "Loading..."}</strong>
                    </div>
                    <div class="planner-resin-timer">
                        <span class="planner-timer-label">Fully Replenished</span>
                        <strong class="resin-full-countdown" data-full-timestamp="${account.full_resin_at ?? ""}">${account.full_resin_at === null ? "Full" : "Loading..."}</strong>
                    </div>
                </div>
            `;
            accounts.appendChild(card);
        }
        if (window.plannerAccounts.length === 0) {
            accounts.innerHTML = '<div class="planner-empty">Account data is currently unavailable.</div>';
        }
    }
    renderExpeditionAccounts(window.plannerAccounts);
    renderTeapotAccounts(window.plannerAccounts);
    renderTransformerAccounts(window.plannerAccounts);
    renderPlannerReminders("resin");
    renderPlannerReminders("expedition");
    renderPlannerReminders("teapot");
    renderPlannerReminders("transformer");
    updateTimestamps();
}
function getTransformerReminderState(account) {
    const state = account?.transformer;
    if (!state)
        return { label: "Unavailable", finished: false };
    if (!state.obtained)
        return { label: "Not obtained", finished: false };
    const timestamp = Number(state.ready_at);
    return timestamp > Math.floor(Date.now() / 1000)
        ? { timestamp, finished: false } : { label: "Ready", finished: true };
}
function renderTransformerAccounts(accounts) {
    const grid = document.getElementById("transformer-accounts");
    if (!grid)
        return;
    setAccountGridLayout(grid, accounts.length);
    grid.replaceChildren();
    for (const account of accounts) {
        const state = getTransformerReminderState(account);
        const card = document.createElement("div");
        card.className = "planner-card";
        card.dataset.genshinUid = account.genshin_uid;
        card.innerHTML = `
            <header class="planner-card-heading"><div class="planner-account-name"><h2 data-account-profile-name="${escapePlannerHtml(account.genshin_uid)}" data-account-profile-field="display">${escapePlannerHtml(getPlannerAccountName(account))}</h2></div>
            <div class="planner-account-rank"><span>AR</span><strong data-account-profile-rank="${escapePlannerHtml(account.genshin_uid)}">${escapePlannerHtml(account.level ?? "Unknown")}</strong></div></header>
            <p class="planner-account-uid">UID <strong>${escapePlannerHtml(account.genshin_uid)}</strong></p>
            <div class="planner-resin-summary"><span class="planner-resin-icon-wrap"><img src="/static/images/misc/Parametric_Transformer.webp" alt="" class="resin-icon"></span>
            <div class="planner-resin-current"><span class="planner-card-overline">Parametric Transformer</span>
            <strong${state.timestamp ? ` data-transformer-timestamp="${state.timestamp}"` : ""}>${state.timestamp ? formatExpeditionDuration(state.timestamp - Math.floor(Date.now() / 1000)) : state.label}</strong></div></div>`;
        grid.appendChild(card);
    }
    if (!accounts.length)
        grid.innerHTML = '<div class="planner-empty">Account data is currently unavailable.</div>';
}
function getTeapotReminderState(account) {
    const currency = account?.teapot;
    if (!currency)
        return { label: "Unavailable", finished: false };
    if (Number(currency.current) >= Number(currency.maximum)) {
        return { label: "Full", finished: true };
    }
    return { timestamp: Number(currency.full_at), label: "Unavailable", finished: false };
}
function renderTeapotAccounts(accounts) {
    const grid = document.getElementById("teapot-accounts");
    if (!grid)
        return;
    setAccountGridLayout(grid, accounts.length);
    grid.replaceChildren();
    for (const account of accounts) {
        const card = document.createElement("div");
        card.className = "planner-card";
        card.dataset.genshinUid = account.genshin_uid;
        const state = getTeapotReminderState(account);
        const currency = account.teapot;
        card.innerHTML = `
            <header class="planner-card-heading"><div class="planner-account-name"><h2 data-account-profile-name="${escapePlannerHtml(account.genshin_uid)}" data-account-profile-field="display">${escapePlannerHtml(getPlannerAccountName(account))}</h2></div>
            <div class="planner-account-rank"><span>AR</span><strong data-account-profile-rank="${escapePlannerHtml(account.genshin_uid)}">${escapePlannerHtml(account.level ?? "Unknown")}</strong></div></header>
            <p class="planner-account-uid">UID <strong>${escapePlannerHtml(account.genshin_uid)}</strong></p>
            <div class="planner-resin-summary">
                <span class="planner-resin-icon-wrap"><img src="/static/images/misc/Realm_Currency.png" alt="" class="resin-icon"></span>
                <div class="planner-resin-current">
                    <span class="planner-card-overline">Realm Currency</span>
                    <strong>${currency ? `<span class="planner-resin-current-value">${escapePlannerHtml(currency.current)}</span><span class="planner-resin-maximum">/ ${escapePlannerHtml(currency.maximum)}</span>` : "Unavailable"}</strong>
                </div>
            </div>
            <div class="planner-resin-timer"><span class="planner-timer-label">Storage Full</span><strong${state.timestamp ? ` data-teapot-timestamp="${state.timestamp}"` : ""}>${state.timestamp ? formatExpeditionDuration(state.timestamp - Math.floor(Date.now() / 1000)) : state.label}</strong></div>`;
        grid.appendChild(card);
    }
    if (!accounts.length)
        grid.innerHTML = '<div class="planner-empty">Account data is currently unavailable.</div>';
}
function getPlannerAccountName(account) {
    return account?.cyrene_nickname || account?.nickname || account?.genshin_uid || "Account";
}
function refreshPlannerAccountNames(accounts) {
    const names = new Map(accounts.map((account) => [account.genshin_uid, getPlannerAccountName(account)]));
    document.querySelectorAll("[data-genshin-uid]").forEach((element) => {
        const name = names.get(element.dataset.genshinUid);
        if (!name)
            return;
        const heading = element.querySelector(".planner-account-name h2");
        const reminderName = element.querySelector(".reminder-name");
        if (heading)
            heading.textContent = name;
        if (reminderName)
            reminderName.textContent = name;
    });
}
function setAccountGridLayout(grid, accountCount) {
    grid.dataset.accountCount = String(accountCount);
    grid.dataset.accountLayout = accountCount > 5 ? "three" : "standard";
    grid.dataset.timerLayout =
        accountCount === 4 || accountCount === 5 || accountCount >= 8 ? "stacked" : "inline";
}
function formatExpeditionDuration(seconds) {
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainingSeconds = totalSeconds % 60;
    if (hours > 0)
        return `in ${hours}h ${minutes}m`;
    if (minutes > 0)
        return `in ${minutes}m ${remainingSeconds}s`;
    return `in ${remainingSeconds}s`;
}
function getSafeExpeditionIconUrl(expedition, field = "character_icon") {
    const iconHash = String(expedition.character_icon_hash || "").toLowerCase();
    const source = expedition[field];
    if (!/^[a-f0-9]{32}$/.test(iconHash) || !source)
        return "";
    try {
        const iconUrl = new URL(source, window.location.origin);
        const hostname = iconUrl.hostname.toLowerCase().replace(/\.$/, "");
        const approvedHost = ["mihoyo.com", "hoyoverse.com", "hoyolab.com", "enka.network"]
            .some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        const filename = iconUrl.pathname.split("/").pop()?.toLowerCase();
        const isDailyNoteIcon = filename === `${iconHash}.png`;
        const isEnkaPortrait = hostname === "enka.network" &&
            /^\/ui\/[a-z0-9_]+\.png$/i.test(iconUrl.pathname) &&
            !iconUrl.search && !iconUrl.hash;
        if (iconUrl.protocol !== "https:" ||
            !approvedHost ||
            (iconUrl.port && iconUrl.port !== "443") ||
            iconUrl.username ||
            iconUrl.password ||
            (!isDailyNoteIcon && !isEnkaPortrait)) {
            return "";
        }
        return iconUrl.href;
    }
    catch {
        return "";
    }
}
function getExpeditionReminderState(account) {
    const expeditions = Array.isArray(account?.expeditions) ? account.expeditions : [];
    const hasFinished = expeditions.some((expedition) => expedition.status === "Finished" ||
        (expedition.status === "Ongoing" && Number(expedition.remaining_seconds) <= 0));
    if (hasFinished)
        return { label: "Ready to claim", finished: true };
    const nextExpedition = expeditions
        .filter((expedition) => expedition.status === "Ongoing" && Number(expedition.remaining_seconds) > 0)
        .sort((left, right) => Number(left.finishes_at || 0) - Number(right.finishes_at || 0))[0];
    if (nextExpedition) {
        return {
            timestamp: Number(nextExpedition.finishes_at) ||
                Math.floor(Date.now() / 1000) + Number(nextExpedition.remaining_seconds),
            finished: false,
        };
    }
    return { label: expeditions.length ? "None active" : "Unavailable", finished: false };
}
function renderExpeditionAccounts(accounts) {
    const grid = document.getElementById("expedition-accounts");
    if (!grid)
        return;
    if (grid.dataset.iconFallbackInitialised !== "true") {
        grid.dataset.iconFallbackInitialised = "true";
        grid.addEventListener("error", (event) => {
            if (event.target instanceof HTMLImageElement && event.target.matches(".planner-expedition-icon")) {
                const fallback = event.target.dataset.fallbackSrc;
                if (fallback &&
                    fallback !== event.target.src &&
                    event.target.dataset.fallbackAttempted !== "true") {
                    event.target.dataset.fallbackAttempted = "true";
                    event.target.src = fallback;
                    return;
                }
                event.target.hidden = true;
            }
        }, true);
    }
    setAccountGridLayout(grid, accounts.length);
    grid.innerHTML = "";
    if (accounts.length === 0) {
        grid.innerHTML = '<div class="planner-empty">Expedition data is currently unavailable.</div>';
        return;
    }
    for (const account of accounts) {
        const expeditions = Array.isArray(account.expeditions) ? account.expeditions : [];
        const activeCount = expeditions.filter((expedition) => expedition.status === "Ongoing" && Number(expedition.remaining_seconds) > 0).length;
        const card = document.createElement("div");
        card.className = "planner-card planner-expedition-card";
        card.dataset.genshinUid = account.genshin_uid;
        const rows = expeditions.length
            ? expeditions.map((expedition) => {
                const characterName = String(expedition.character_name || "Unknown").replaceAll("_", " ");
                const name = escapePlannerHtml(characterName);
                const initials = escapePlannerHtml(characterName.split(/\s+/).filter(Boolean).slice(0, 2)
                    .map((part) => part[0]).join("").toUpperCase() || "?");
                const iconUrl = getSafeExpeditionIconUrl(expedition);
                const fallbackIconUrl = getSafeExpeditionIconUrl(expedition, "character_icon_fallback");
                const mark = `<span class="planner-expedition-mark" aria-hidden="true"><span class="planner-expedition-initials">${initials}</span>${iconUrl ? `<img class="planner-expedition-icon" src="${escapePlannerHtml(iconUrl)}" data-fallback-src="${escapePlannerHtml(fallbackIconUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}</span>`;
                const remaining = Math.max(0, Number(expedition.remaining_seconds) || 0);
                const ongoing = expedition.status === "Ongoing" && remaining > 0;
                const finished = expedition.status === "Finished" ||
                    (expedition.status === "Ongoing" && remaining === 0);
                const status = escapePlannerHtml(expedition.status || "Unknown");
                if (ongoing) {
                    const timestamp = Number(expedition.finishes_at) ||
                        Math.floor(Date.now() / 1000) + remaining;
                    return `<div class="planner-expedition-item">${mark}<strong class="planner-expedition-name">${name}</strong><strong class="planner-expedition-time" data-expedition-timestamp="${timestamp}">${formatExpeditionDuration(remaining)}</strong></div>`;
                }
                return `<div class="planner-expedition-item">${mark}<strong class="planner-expedition-name">${name}</strong><strong class="planner-expedition-time${finished ? " is-finished" : ""}">${finished ? "Finished" : status}</strong></div>`;
            }).join("")
            : '<div class="planner-expedition-empty">No Expedition data available.</div>';
        const accountName = escapePlannerHtml(getPlannerAccountName(account));
        const uid = escapePlannerHtml(account.genshin_uid);
        const level = escapePlannerHtml(account.level ?? "Unknown");
        card.innerHTML = `
            <header class="planner-card-heading">
                <div class="planner-account-name"><h2 data-account-profile-name="${uid}" data-account-profile-field="display">${accountName}</h2></div>
                <div class="planner-account-rank" aria-label="Adventure Rank ${level}"><span>AR</span><strong data-account-profile-rank="${uid}">${level}</strong></div>
            </header>
            <p class="planner-account-uid">UID <strong>${uid}</strong></p>
            <div class="planner-expedition-summary"><span>Active Expeditions</span><strong><span>${activeCount}</span><span class="planner-expedition-maximum">/ ${expeditions.length || 5}</span></strong></div>
            <div class="planner-expedition-list">${rows}</div>
        `;
        grid.appendChild(card);
    }
}
function renderPlannerReminders(type) {
    const container = document.getElementById(type === "transformer" ? "transformer-reminders" : type === "teapot" ? "teapot-reminders" : type === "expedition" ? "expedition-reminders" : "reminders");
    if (!container)
        return;
    const reminders = (window.plannerReminders || []).filter((reminder) => reminder.type === type);
    container.innerHTML = "";
    if (reminders.length === 0) {
        container.innerHTML = '<div class="planner-empty">No reminders configured.</div>';
        return;
    }
    for (const reminder of reminders) {
        const account = (window.plannerAccounts || []).find((item) => item.genshin_uid === reminder.genshin_uid);
        const capacity = type === "teapot" ? Number(account?.teapot?.maximum) || 0 : 200;
        const amount = type === "teapot" ? Math.min(Number(reminder.config?.amount ?? capacity), capacity) : reminder.config?.amount;
        const mode = reminder.mode === "manual" ? "manual" : "automatic";
        const resin = type === "resin" || type === "teapot";
        const currencyLabel = type === "teapot" ? "Realm Currency" : "Resin";
        const currencyIcon = type === "teapot" ? "Realm_Currency.png" : "Original_Resin.webp";
        const custom = type === "custom";
        const displayType = type === "transformer" ? "Parametric Transformer" : type === "teapot" ? "Serenitea Pot" : type.charAt(0).toUpperCase() + type.slice(1);
        const accountName = escapePlannerHtml(account ? getPlannerAccountName(account) : reminder.account_nickname || "Account");
        const safeReminderId = escapePlannerHtml(reminder.id);
        const state = type === "transformer" ? getTransformerReminderState(account) : type === "teapot" ? getTeapotReminderState(account) : getExpeditionReminderState(account);
        const card = document.createElement("div");
        card.className = "reminder-card";
        card.dataset.reminderId = String(reminder.id);
        card.dataset.reminderType = type;
        card.dataset.genshinUid = reminder.genshin_uid || "";
        card.dataset.reminderMode = mode;
        card.dataset.reminderAmount = amount === undefined || amount === null ? "" : String(amount);
        const value = resin
            ? `<div class="custom-input-wrapper reminder-amount-control"><img src="/static/images/misc/${currencyIcon}" alt="" class="reminder-resin-icon"><input type="number" class="reminder-amount-input" data-reminder-amount min="1" max="${capacity}" ${capacity ? "" : "disabled"} step="1" value="${escapePlannerHtml(amount ?? "")}" aria-label="${currencyLabel} amount" required><div class="number-spinner"><button type="button" class="number-spinner-button" data-direction="up" aria-label="Increase ${currencyLabel}"><span class="spinner-arrow" aria-hidden="true"></span></button><button type="button" class="number-spinner-button" data-direction="down" aria-label="Decrease ${currencyLabel}"><span class="spinner-arrow" aria-hidden="true"></span></button></div></div>`
            : `<strong class="reminder-time-value${state.finished ? " is-finished" : ""}"${state.timestamp ? ` data-${type === "transformer" ? "transformer" : type === "teapot" ? "teapot" : "expedition"}-timestamp="${state.timestamp}"` : ""}>${state.timestamp ? formatExpeditionDuration(state.timestamp - Math.floor(Date.now() / 1000)) : escapePlannerHtml(state.label)}</strong>`;
        const valueLabel = resin ? "Amount" : "Time";
        const modeLabel = mode === "manual" ? "Manual" : "Automatic";
        card.innerHTML = `
            <div class="reminder-main"><span class="reminder-label">Account</span><h3 class="reminder-name" data-account-profile-name="${escapePlannerHtml(reminder.genshin_uid)}" data-account-profile-field="display">${accountName}</h3></div>
            <div class="reminder-detail reminder-type-detail"><span class="reminder-label">Type</span><span class="reminder-value">${escapePlannerHtml(displayType)}</span></div>
            <div class="reminder-detail reminder-mode-detail">
                <span class="reminder-label">Mode</span>
                <div class="custom-select reminder-mode-select">
                    <button type="button" class="custom-select-button" aria-haspopup="listbox" aria-expanded="false" aria-label="Reminder mode"><span class="custom-select-value">${modeLabel}</span><span class="custom-select-arrow" aria-hidden="true"></span></button>
                    <div class="custom-select-menu" role="listbox" aria-label="Reminder mode">
                        <button type="button" class="custom-select-option ${mode === "automatic" ? "selected" : ""}" data-reminder-mode-option data-value="automatic" role="option" aria-selected="${mode === "automatic"}" ${custom ? "disabled" : ""}>Automatic</button>
                        <button type="button" class="custom-select-option ${mode === "manual" ? "selected" : ""}" data-reminder-mode-option data-value="manual" role="option" aria-selected="${mode === "manual"}">Manual</button>
                    </div>
                    <input type="hidden" data-reminder-mode value="${mode}">
                </div>
            </div>
            <div class="reminder-detail reminder-amount-detail"><span class="reminder-label">${valueLabel}</span><div class="reminder-value reminder-amount-value">${value}</div></div>
            <button type="button" class="cyrene-button cyrene-button--icon cyrene-button--danger reminder-delete-button" data-reminder-id="${safeReminderId}" aria-label="Delete reminder" title="Delete reminder"><img src="/static/images/ui/ui_buttons/Delete.png" alt=""></button>
            <p class="reminder-lifetime" ${mode === "automatic" ? "hidden" : ""}>${escapePlannerHtml(describeReminderLifetime(type, mode, account, amount))}</p>
        `;
        container.appendChild(card);
        initialiseNumberSpinners(card);
    }
}
function updateExpeditionReminderTimes() {
    document.querySelectorAll(".reminder-card[data-reminder-type='expedition']").forEach((card) => {
        const account = (window.plannerAccounts || []).find((item) => item.genshin_uid === card.dataset.genshinUid);
        const state = getExpeditionReminderState(account);
        const value = card.querySelector(".reminder-time-value");
        if (!value)
            return;
        value.classList.toggle("is-finished", Boolean(state.finished));
        if (state.timestamp) {
            value.dataset.expeditionTimestamp = String(state.timestamp);
            value.textContent = formatExpeditionDuration(state.timestamp - Math.floor(Date.now() / 1000));
        }
        else {
            value.removeAttribute("data-expedition-timestamp");
            value.textContent = state.label;
        }
    });
}
function updateTimestamps() {
    document.querySelectorAll(".planner-card").forEach((card) => {
        const resinValue = card.querySelector("[data-resin-current]");
        const replenished = card.querySelector("[data-timestamp]");
        const fullyReplenished = card.querySelector("[data-full-timestamp]");
        if (!resinValue || !replenished) {
            return;
        }
        let currentResin = Number(resinValue.dataset.resinCurrent);
        const maxResin = Number(resinValue.dataset.resinMax);
        /*
         * Update the Resin regeneration timer.
         */
        const timestamp = Number(replenished.dataset.timestamp);
        if (timestamp) {
            const seconds = timestamp - Math.floor(Date.now() / 1000);
            if (seconds <= 0) {
                currentResin = Math.min(currentResin + 1, maxResin);
                resinValue.dataset.resinCurrent = currentResin;
                const currentValue = resinValue.querySelector(".planner-resin-current-value");
                if (currentValue) {
                    currentValue.textContent = String(currentResin);
                }
                else {
                    resinValue.textContent = `${currentResin} / ${maxResin}`;
                }
                /*
                 * Resin is now completely full.
                 */
                if (currentResin >= maxResin) {
                    replenished.textContent = "Full";
                    replenished.removeAttribute("data-timestamp");
                    if (fullyReplenished) {
                        fullyReplenished.textContent = "Full";
                        fullyReplenished.removeAttribute("data-full-timestamp");
                    }
                    return;
                }
                /*
                 * Start the next Resin timer.
                 */
                const nextTimestamp = Math.floor(Date.now() / 1000) + 480;
                replenished.dataset.timestamp = nextTimestamp;
            }
            updateCountdown(replenished, Number(replenished.dataset.timestamp));
        }
        /*
         * Update Fully Replenished timer.
         */
        if (fullyReplenished && fullyReplenished.dataset.fullTimestamp) {
            updateCountdown(fullyReplenished, Number(fullyReplenished.dataset.fullTimestamp));
        }
    });
    document.querySelectorAll("[data-transformer-timestamp]").forEach((element) => {
        const seconds = Number(element.dataset.transformerTimestamp) - Math.floor(Date.now() / 1000);
        element.textContent = seconds > 0 ? formatExpeditionDuration(seconds) : "Ready";
    });
    document.querySelectorAll("[data-teapot-timestamp]").forEach((element) => {
        const seconds = Number(element.dataset.teapotTimestamp) - Math.floor(Date.now() / 1000);
        element.textContent = seconds > 0 ? formatExpeditionDuration(seconds) : "Full";
    });
    document.querySelectorAll("[data-expedition-timestamp]").forEach((element) => {
        const timestamp = Number(element.dataset.expeditionTimestamp);
        const seconds = timestamp - Math.floor(Date.now() / 1000);
        if (!timestamp || seconds <= 0) {
            element.textContent = element.classList.contains("reminder-time-value")
                ? "Ready to claim"
                : "Finished";
            element.classList.add("is-finished");
            element.removeAttribute("data-expedition-timestamp");
            return;
        }
        element.textContent = formatExpeditionDuration(seconds);
    });
}
async function refreshResin() {
    try {
        const response = await fetch("/api/reminders", {
            credentials: "same-origin",
            signal: plannerAbortController?.signal,
            headers: { "X-Cyrene-Background": "1" },
        });
        if (response.status === 401) {
            window.location.href = "/";
            return;
        }
        if (!response.ok) {
            throw new Error("Failed to refresh Resin data.");
        }
        const plannerData = await response.json();
        window.plannerAccounts = plannerData.accounts || [];
        renderExpeditionAccounts(window.plannerAccounts);
        renderTeapotAccounts(window.plannerAccounts);
        renderTransformerAccounts(window.plannerAccounts);
        window.plannerReminders = plannerData.reminders || [];
        for (const type of ["resin", "expedition", "teapot", "transformer"]) {
            const list = document.getElementById(type === "resin" ? "reminders" : `${type}-reminders`);
            if (list?.contains(document.activeElement) || list?.querySelector('[data-saving="true"]'))
                continue;
            renderPlannerReminders(type);
        }
        refreshPlannerAccountNames(window.plannerAccounts);
        updateExpeditionReminderTimes();
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
                resinValue.dataset.resinCurrent = account.current_resin;
                resinValue.dataset.resinMax = account.max_resin;
                const currentValue = resinValue.querySelector(".planner-resin-current-value");
                const maximumValue = resinValue.querySelector(".planner-resin-maximum");
                if (currentValue && maximumValue) {
                    currentValue.textContent = String(account.current_resin);
                    maximumValue.textContent = `/ ${account.max_resin}`;
                }
                else {
                    resinValue.textContent = `${account.current_resin} / ${account.max_resin}`;
                }
            }
            /*
             * -------------------------------
             * Replenished timer
             * -------------------------------
             */
            const replenished = card.querySelector("[data-timestamp]");
            if (replenished) {
                if (account.replenished_at === null) {
                    replenished.textContent = "Full";
                    replenished.dataset.timestamp = "";
                }
                else {
                    replenished.dataset.timestamp = account.replenished_at;
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
                    fullyReplenished.textContent = "Full";
                    fullyReplenished.dataset.fullTimestamp = "";
                }
                else {
                    fullyReplenished.dataset.fullTimestamp = account.full_resin_at;
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
         * leaving Reminders.
         */
        if (exception.name === "AbortError") {
            return;
        }
        console.error("Failed to refresh Resin:", exception);
    }
}
function updateCountdown(element, timestamp) {
    const seconds = Math.max(0, timestamp - Math.floor(Date.now() / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (hours > 0) {
        element.textContent = `in ${hours}h ${minutes}m ${remainingSeconds}s`;
        return;
    }
    if (minutes > 0) {
        element.textContent = `in ${minutes}m ${remainingSeconds}s`;
        return;
    }
    element.textContent = `in ${remainingSeconds}s`;
}
function describeReminderLifetime(type, mode, account, amount) {
    const conditions = {
        resin: `Resin reaches ${amount || "your chosen amount"}`,
        teapot: `Realm Currency reaches ${amount || "your chosen amount"}`,
        expedition: "an Expedition finishes",
        transformer: "your Parametric Transformer is ready",
    };
    const condition = conditions[type] || "its condition is met";
    if (mode !== "manual")
        return "Automatic: repeats each cycle until you delete it.";
    let timestamp = null;
    if (type === "resin" && account?.current_resin < amount && account?.replenished_at) {
        timestamp = Number(account.replenished_at) + (amount - account.current_resin - 1) * 480;
    }
    else if (type === "transformer" && account?.transformer?.obtained) {
        timestamp = Number(account.transformer.ready_at);
    }
    else if (type === "expedition") {
        timestamp = getExpeditionReminderState(account).timestamp;
    }
    else if (type === "teapot" && Number(amount) === account?.teapot?.maximum) {
        timestamp = Number(account.teapot.full_at);
    }
    const expected = timestamp > Date.now() / 1000
        ? ` Expected ${new Date(timestamp * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : "";
    return `Manual: stays active until ${condition}, then sends once and is removed from your active reminders after successful delivery. No fixed expiry.${expected}`;
}
function updateReminderModeHelp() {
    const help = document.getElementById("reminder-mode-help");
    if (!help)
        return;
    const uid = document.getElementById("reminder-account")?.value;
    const account = (window.plannerAccounts || []).find(item => item.genshin_uid === uid);
    help.textContent = describeReminderLifetime(document.getElementById("reminder-type")?.value, document.getElementById("reminder-create-mode")?.value, account, Number(document.getElementById("reminder-amount")?.value));
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
    const expeditionTab = window.plannerActiveTab === "expeditions";
    const teapotTab = window.plannerActiveTab === "teapot";
    const transformerTab = window.plannerActiveTab === "transformer";
    const targetSection = document.getElementById(transformerTab ? "transformer-reminder-section" : teapotTab ? "teapot-reminder-section" : expeditionTab ? "expedition-reminder-section" : "resin-reminder-section");
    const targetList = targetSection?.querySelector(".reminders-list");
    if (targetSection && targetList) {
        targetSection.insertBefore(panel, targetList);
    }
    const typeSelect = document.getElementById("reminder-type-select");
    const typeInput = document.getElementById("reminder-type");
    const typeValue = typeSelect?.querySelector(".custom-select-button span");
    const selectedType = transformerTab ? "transformer" : teapotTab ? "teapot" : expeditionTab ? "expedition" : "resin";
    if (typeInput && typeSelect && typeValue) {
        typeInput.value = selectedType;
        typeValue.textContent = transformerTab ? "Parametric Transformer" : teapotTab ? "Serenitea Pot" : expeditionTab ? "Expedition" : "Resin";
        typeSelect.querySelectorAll(".custom-select-option").forEach((option) => {
            option.classList.toggle("selected", option.dataset.value === selectedType);
        });
        updateReminderTypeConfiguration(selectedType);
    }
    /*
     * Reset the account selector.
     */
    accountInput.value = "";
    updateReminderTypeConfiguration(selectedType);
    delete accountValue.dataset.accountProfileOption;
    accountValue.textContent = "Select Account";
    accountMenu.innerHTML = "";
    /*
     * Populate the custom account selector.
     */
    for (const account of window.plannerAccounts || []) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "custom-select-option";
        option.dataset.value = account.genshin_uid;
        option.dataset.accountProfileOption = account.genshin_uid;
        const accountName = getPlannerAccountName(account);
        option.textContent = accountName !== account.genshin_uid
            ? `${accountName} (${account.genshin_uid})`
            : account.genshin_uid;
        option.addEventListener("click", () => {
            accountInput.value = account.genshin_uid;
            updateReminderTypeConfiguration(document.getElementById("reminder-type")?.value);
            accountValue.dataset.accountProfileOption = account.genshin_uid;
            accountValue.textContent = option.textContent;
            /*
             * Update selected state.
             */
            accountMenu.querySelectorAll(".custom-select-option").forEach((item) => {
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
    const mode = document.getElementById("reminder-create-mode");
    if (mode)
        mode.value = "automatic";
    const modeSelect = document.getElementById("reminder-create-mode-select");
    if (modeSelect) {
        modeSelect.querySelector(".custom-select-button span").textContent = "Automatic";
        modeSelect.querySelectorAll(".custom-select-option").forEach(option => option.classList.toggle("selected", option.dataset.value === "automatic"));
    }
    updateReminderModeHelp();
    panel.hidden = false;
}
function updateReminderTypeConfiguration(type) {
    const resinConfiguration = document.getElementById("reminder-resin-configuration");
    const expeditionNote = document.getElementById("reminder-expedition-note");
    const hasAmount = type === "resin" || type === "teapot";
    const teapot = type === "teapot";
    const label = teapot ? "Realm Currency" : "Resin";
    if (resinConfiguration) {
        resinConfiguration.hidden = !hasAmount;
        const input = resinConfiguration.querySelector("input");
        if (input) {
            const account = (window.plannerAccounts || []).find(item => item.genshin_uid === document.getElementById("reminder-account")?.value);
            const maximum = teapot ? Number(account?.teapot?.maximum) || 0 : 200;
            input.max = String(maximum);
            input.disabled = !maximum;
            if (input.dataset.currency !== type || Number(input.value) > maximum || Number(input.value) < 1) {
                input.value = String(teapot ? maximum : 160);
            }
            input.dataset.currency = type;
            resinConfiguration.querySelectorAll(".number-spinner-button").forEach(button => button.disabled = !maximum);
        }
        const image = resinConfiguration.querySelector("img");
        if (image) {
            image.src = teapot ? "/static/images/misc/Realm_Currency.png" : "/static/images/misc/Original_Resin.webp";
            image.alt = label;
        }
        const currencyLabel = document.getElementById("reminder-currency-label");
        if (currencyLabel)
            currencyLabel.textContent = label;
        resinConfiguration.querySelectorAll(".number-spinner-button").forEach(button => {
            button.setAttribute("aria-label", `${button.dataset.direction === "up" ? "Increase" : "Decrease"} ${label}`);
        });
    }
    if (expeditionNote) {
        expeditionNote.hidden = !["expedition", "transformer"].includes(type);
        expeditionNote.textContent = type === "transformer" ? "Notify when your Parametric Transformer is ready. Automatic reminders repeat after use; manual reminders notify once." : "Notify when an Expedition finishes. Automatic reminders track future Expeditions; manual reminders notify once.";
    }
    updateReminderModeHelp();
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
    if (panel.dataset.initialised === "true") {
        return;
    }
    panel.dataset.initialised = "true";
    const addButton = document.getElementById("add-reminder-button");
    const expeditionAddButton = document.getElementById("add-expedition-reminder-button");
    const closeButton = document.getElementById("reminder-close-button");
    const cancelButton = document.getElementById("reminder-cancel-button");
    const saveButton = document.getElementById("reminder-save-button");
    /*
     * Open / close the Reminder panel.
     */
    if (addButton) {
        addButton.addEventListener("click", openReminderPanel);
    }
    document.getElementById("add-transformer-reminder-button")?.addEventListener("click", openReminderPanel);
    document.getElementById("add-teapot-reminder-button")?.addEventListener("click", openReminderPanel);
    if (expeditionAddButton) {
        expeditionAddButton.addEventListener("click", openReminderPanel);
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
    document.querySelectorAll(".custom-select").forEach((select) => {
        const button = select.querySelector(".custom-select-button");
        const hiddenInput = select.parentElement.querySelector('input[type="hidden"]');
        const valueDisplay = select.querySelector(".custom-select-button span");
        const options = select.querySelectorAll(".custom-select-option:not(:disabled)");
        if (!button || !hiddenInput || !valueDisplay) {
            return;
        }
        /*
         * Open / close dropdown.
         */
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            /*
             * Close every other dropdown.
             */
            document.querySelectorAll(".custom-select.open").forEach((otherSelect) => {
                if (otherSelect !== select) {
                    otherSelect.classList.remove("open");
                    otherSelect.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "false");
                }
            });
            select.classList.toggle("open");
            button.setAttribute("aria-expanded", String(select.classList.contains("open")));
        });
        /*
         * Select an option.
         */
        options.forEach((option) => {
            option.addEventListener("click", (event) => {
                event.stopPropagation();
                hiddenInput.value = option.dataset.value;
                valueDisplay.textContent = option.textContent.trim();
                /*
                 * Update selected state.
                 */
                options.forEach((item) => {
                    item.classList.remove("selected");
                });
                option.classList.add("selected");
                updateReminderModeHelp();
                if (select.id === "reminder-type-select") {
                    updateReminderTypeConfiguration(hiddenInput.value);
                }
                /*
                 * Close dropdown.
                 */
                select.classList.remove("open");
                button.setAttribute("aria-expanded", "false");
            });
        });
    });
    document.getElementById("reminder-amount")?.addEventListener("input", updateReminderModeHelp);
    initialiseNumberSpinners(document);
    /*
     * Close all custom selects when clicking
     * elsewhere on the page.
     */
    document.addEventListener("click", () => {
        document.querySelectorAll(".custom-select.open").forEach((select) => {
            select.classList.remove("open");
            select.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "false");
        });
    });
    /*
     * Delete reminder buttons.
     */
    document.querySelectorAll(".reminders-list").forEach((reminders) => {
        reminders.addEventListener("click", (event) => {
            if (!(event.target instanceof Element)) {
                return;
            }
            const modeButton = event.target.closest(".reminder-mode-select .custom-select-button");
            if (modeButton) {
                event.preventDefault();
                event.stopPropagation();
                const select = modeButton.closest(".reminder-mode-select");
                document.querySelectorAll(".reminder-mode-select.open").forEach((otherSelect) => {
                    if (otherSelect !== select) {
                        otherSelect.classList.remove("open");
                        otherSelect.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "false");
                    }
                });
                select?.classList.toggle("open");
                modeButton.setAttribute("aria-expanded", String(select?.classList.contains("open") ?? false));
                return;
            }
            const modeOption = event.target.closest("[data-reminder-mode-option]");
            if (modeOption && !modeOption.disabled) {
                const card = modeOption.closest(".reminder-card");
                const select = modeOption.closest(".reminder-mode-select");
                const modeInput = card?.querySelector("[data-reminder-mode]");
                const nextMode = modeOption.dataset.value;
                select?.classList.remove("open");
                select?.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "false");
                if (!card || !modeInput || !["automatic", "manual"].includes(nextMode)) {
                    return;
                }
                if (modeInput.value === nextMode) {
                    return;
                }
                clearReminderAmountSave(card);
                modeInput.value = nextMode;
                syncReminderModeControl(card);
                void updateReminderCard(card);
                return;
            }
            const button = event.target.closest(".reminder-delete-button");
            if (!button) {
                return;
            }
            deleteReminder(button.dataset.reminderId);
        });
        reminders.addEventListener("input", (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement) || !input.matches("[data-reminder-amount]")) {
                return;
            }
            const card = input.closest(".reminder-card");
            if (card) {
                scheduleReminderAmountSave(card);
            }
        });
    });
}
const reminderAmountSaveTimers = new WeakMap();
const REMINDER_AMOUNT_SAVE_DELAY = 700;
function scheduleReminderAmountSave(card) {
    clearReminderAmountSave(card);
    reminderAmountSaveTimers.set(card, window.setTimeout(() => {
        reminderAmountSaveTimers.delete(card);
        void updateReminderCard(card);
    }, REMINDER_AMOUNT_SAVE_DELAY));
}
function clearReminderAmountSave(card) {
    const timeout = reminderAmountSaveTimers.get(card);
    if (timeout !== undefined) {
        window.clearTimeout(timeout);
        reminderAmountSaveTimers.delete(card);
    }
}
function syncReminderModeControl(card) {
    const mode = card.querySelector("[data-reminder-mode]")?.value;
    const select = card.querySelector(".reminder-mode-select");
    const value = select?.querySelector(".custom-select-value");
    if (!mode || !select || !value) {
        return;
    }
    value.textContent = mode === "manual" ? "Manual" : "Automatic";
    select.querySelectorAll("[data-reminder-mode-option]").forEach((option) => {
        const selected = option.dataset.value === mode;
        option.classList.toggle("selected", selected);
        option.setAttribute("aria-selected", String(selected));
    });
}
function initialiseNumberSpinners(root) {
    root.querySelectorAll(".number-spinner-button").forEach((button) => {
        if (button.dataset.spinnerInitialised === "true") {
            return;
        }
        button.dataset.spinnerInitialised = "true";
        let holdInterval = null;
        let holdTimeout = null;
        function changeValue() {
            const input = button
                .closest(".custom-input-wrapper")
                ?.querySelector('input[type="number"]');
            if (!input || input.disabled || input.readOnly) {
                return;
            }
            const min = input.min === "" ? -Infinity : Number(input.min);
            const max = input.max === "" ? Infinity : Number(input.max);
            const step = Number(input.step) || 1;
            const current = input.value === ""
                ? (Number.isFinite(min) ? min : 0)
                : Number(input.value);
            const next = button.dataset.direction === "up"
                ? Math.min(current + step, max)
                : Math.max(current - step, min);
            if (next === current) {
                return;
            }
            input.value = String(next);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }
        function startHolding(event) {
            if (event.type === "mousedown" && event.button !== 0) {
                return;
            }
            event.preventDefault();
            changeValue();
            holdTimeout = window.setTimeout(() => {
                holdInterval = window.setInterval(changeValue, 50);
            }, 350);
        }
        function stopHolding() {
            if (holdTimeout !== null) {
                window.clearTimeout(holdTimeout);
                holdTimeout = null;
            }
            if (holdInterval !== null) {
                window.clearInterval(holdInterval);
                holdInterval = null;
            }
        }
        button.addEventListener("mousedown", startHolding);
        button.addEventListener("mouseup", stopHolding);
        button.addEventListener("mouseleave", stopHolding);
        button.addEventListener("click", (event) => {
            event.preventDefault();
            if (event.detail === 0)
                changeValue();
        });
        button.addEventListener("touchstart", startHolding, { passive: false });
        button.addEventListener("touchend", stopHolding);
        button.addEventListener("touchcancel", stopHolding);
    });
}
async function updateReminderCard(card) {
    if (!card?.isConnected || !card.dataset.reminderId || card.dataset.saving === "true") {
        return;
    }
    const modeInput = card.querySelector("[data-reminder-mode]");
    const amountInput = card.querySelector("[data-reminder-amount]");
    const mode = modeInput?.value;
    const amount = amountInput ? Number(amountInput.value) : null;
    if (modeInput && !["automatic", "manual"].includes(mode)) {
        window.showCyreneToast?.("Choose a valid reminder mode.", "warning");
        modeInput.value = card.dataset.reminderMode;
        syncReminderModeControl(card);
        return;
    }
    if (amountInput &&
        (!Number.isInteger(amount) || amount < Number(amountInput.min) || amount > Number(amountInput.max))) {
        window.showCyreneToast?.(`Enter a whole number between ${amountInput.min} and ${amountInput.max}.`, "warning");
        amountInput.value = card.dataset.reminderAmount;
        if (modeInput) {
            modeInput.value = card.dataset.reminderMode;
            syncReminderModeControl(card);
        }
        return;
    }
    const payload = {};
    if (modeInput)
        payload.mode = mode;
    if (amountInput)
        payload.config = { amount };
    const controls = [
        card.querySelector(".reminder-mode-select .custom-select-button"),
        amountInput,
        ...card.querySelectorAll(".reminder-amount-control .number-spinner-button"),
    ].filter(Boolean);
    const previousDisabledStates = controls.map((control) => control.disabled);
    controls.forEach((control) => (control.disabled = true));
    card.dataset.saving = "true";
    card.setAttribute("aria-busy", "true");
    try {
        const response = await fetch(`/api/reminders/${encodeURIComponent(card.dataset.reminderId)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (response.status === 401) {
            window.location.href = "/";
            return;
        }
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || "Could not update this reminder.");
        }
        card.dataset.reminderMode = modeInput?.value || card.dataset.reminderMode;
        if (amountInput)
            card.dataset.reminderAmount = amountInput.value;
        const lifetime = card.querySelector(".reminder-lifetime");
        if (lifetime)
            lifetime.hidden = card.dataset.reminderMode === "automatic";
        if (lifetime)
            lifetime.textContent = describeReminderLifetime(card.dataset.reminderType, card.dataset.reminderMode, (window.plannerAccounts || []).find(account => account.genshin_uid === card.dataset.genshinUid), Number(card.dataset.reminderAmount));
        window.showCyreneToast?.("Reminder updated.");
    }
    catch (error) {
        console.error("Could not update reminder.", error);
        if (modeInput)
            modeInput.value = card.dataset.reminderMode;
        if (amountInput)
            amountInput.value = card.dataset.reminderAmount;
        syncReminderModeControl(card);
        window.showCyreneToast?.(error.message || "Could not update this reminder.", "warning");
    }
    finally {
        card.dataset.saving = "false";
        card.removeAttribute("aria-busy");
        if (card.isConnected) {
            controls.forEach((control, index) => {
                control.disabled = previousDisabledStates[index];
            });
        }
    }
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
    if (type === "resin" || type === "teapot") {
        const account = (window.plannerAccounts || []).find(item => item.genshin_uid === genshinUid);
        const maximum = type === "teapot" ? Number(account?.teapot?.maximum) || 0 : 200;
        const amount = Number(amountInput?.value);
        if (!Number.isInteger(amount) || amount < 1 || amount > maximum) {
            window.showCyreneToast?.(`${type === "teapot" ? "Realm Currency" : "Resin"} must be a whole number between 1 and ${maximum}.`, "warning");
            return;
        }
        config.amount = amount;
    }
    if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = "Saving...";
    }
    try {
        const response = await fetch("/api/reminders", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: type,
                mode: document.getElementById("reminder-create-mode")?.value || "automatic",
                genshin_uid: genshinUid,
                config: config,
                delivery_type: "dm",
            }),
        });
        if (response.status === 401) {
            window.location.href = "/";
            return;
        }
        const result = await response.json();
        if (!response.ok) {
            throw new Error(result.detail || "Failed to save reminder.");
        }
        closeReminderPanel();
        window.showCyreneToast?.("Reminder added successfully.");
        await loadPlanner();
    }
    catch (exception) {
        console.error(exception);
        alert(exception.message || "Failed to save reminder.");
    }
    finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = "Add Reminder";
        }
    }
}
async function deleteReminder(reminderId) {
    if (!reminderId) {
        return;
    }
    const button = document.querySelector(`.reminder-delete-button[data-reminder-id="${reminderId}"]`);
    const card = button?.closest(".reminder-card");
    if (card) {
        clearReminderAmountSave(card);
    }
    /*
     * Start the delete request immediately.
     */
    const deleteRequest = fetch(`/api/reminders/${reminderId}`, {
        method: "DELETE",
        credentials: "same-origin",
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
            throw new Error(result.detail || "Failed to delete reminder.");
        }
        /*
         * Wait for the removal animation to finish.
         */
        if (card) {
            await new Promise((resolve) => {
                setTimeout(resolve, 180);
            });
            card.remove();
        }
        /*
         * Show success notification.
         */
        window.showCyreneToast?.("Reminder deleted successfully.");
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
        alert(exception.message || "Failed to delete reminder.");
    }
}
function initialisePlannerTabs() {
    const tabs = Array.from(document.querySelectorAll("[data-planner-tab]"));
    const panels = Array.from(document.querySelectorAll("[data-planner-panel]"));
    if (!tabs.length || !panels.length) {
        return;
    }
    function activateTab(category) {
        window.plannerActiveTab = category;
        tabs.forEach((tab) => {
            const active = tab.dataset.plannerTab === category;
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-selected", String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        panels.forEach((panel) => {
            panel.hidden = panel.dataset.plannerPanel !== category;
        });
        const url = new URL(window.location.href);
        url.searchParams.set("tab", category);
        window.history.replaceState(window.history.state, "", url);
    }
    tabs.forEach((tab, index) => {
        if (tab.dataset.initialised === "true") {
            return;
        }
        tab.dataset.initialised = "true";
        tab.addEventListener("click", () => activateTab(tab.dataset.plannerTab));
        tab.addEventListener("keydown", (event) => {
            let nextIndex;
            if (event.key === "ArrowRight") {
                nextIndex = (index + 1) % tabs.length;
            }
            else if (event.key === "ArrowLeft") {
                nextIndex = (index - 1 + tabs.length) % tabs.length;
            }
            else if (event.key === "Home") {
                nextIndex = 0;
            }
            else if (event.key === "End") {
                nextIndex = tabs.length - 1;
            }
            else {
                return;
            }
            event.preventDefault();
            tabs[nextIndex].focus();
            activateTab(tabs[nextIndex].dataset.plannerTab);
        });
    });
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    const category = tabs.some((tab) => tab.dataset.plannerTab === requestedTab)
        ? requestedTab
        : tabs[0].dataset.plannerTab;
    activateTab(category);
}
let plannerAbortController = null;
window.plannerRefreshInterval = null;
window.initPlanner = function () {
    initialisePlannerTabs();
    initialiseReminderPanel();
    /*
     * Stop any previous Reminders timer.
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
    plannerAbortController = new AbortController();
    loadPlanner();
    /*
     * Start the Resin countdown.
     */
    window.plannerInterval = setInterval(updateTimestamps, 1_000);
    /*
     * Refresh Resin from HoYoLAB every 30 seconds.
     */
    window.plannerRefreshInterval = setInterval(refreshResin, 30_000);
};
