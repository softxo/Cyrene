// @ts-nocheck -- Shared legacy Events globals.
window.initialiseActivityCheckmarks = function initialiseActivityCheckmarks() {
    function render(button, checked) {
        button.setAttribute("aria-pressed", String(checked));
        button.classList.toggle("event-checkmark-empty", !checked);
        const row = button.closest(".event-list-item, .overview-account-row");
        const completed = checked ||
            (["daily_commissions", "trounce_domains"].includes(button.dataset.activityType) &&
                row?.dataset.automaticComplete === "true");
        row?.classList.toggle("completed", completed);
        if (button.dataset.activityType === "trounce_domains") {
            row?.querySelector(".event-list-status, .overview-status")?.classList.toggle("event-completion-pill", completed);
        }
        const status = row?.querySelector("[data-limited-status]");
        if (status) {
            status.textContent = checked ? "Completed" : status.dataset.baseStatus;
            status.classList.toggle("event-completion-pill", checked);
            status.classList.toggle("event-limited-completed", checked);
        }
        document.querySelectorAll("[data-limited-account-group]").forEach((group) => {
            const cards = group.querySelectorAll(".events-limited-overview-event:not([hidden])");
            const completed = group.querySelectorAll(".events-limited-overview-event.completed:not([hidden])").length;
            const count = group.querySelector("[data-limited-account-count]");
            if (count) {
                count.textContent = `${completed}/${cards.length} complete`;
                count.classList.toggle("event-completion-pill", cards.length > 0 && completed === cards.length);
            }
        });
    }
    document.querySelectorAll(".event-checkmark[data-activity-type]").forEach((checkmark) => {
        if (checkmark.dataset.initialised === "true")
            return;
        checkmark.dataset.initialised = "true";
        checkmark.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (checkmark.dataset.saving === "true")
                return;
            const { accountId, activityType, eventKey, eventToken } = checkmark.dataset;
            if (!accountId || !activityType)
                return;
            const buttons = [
                ...document.querySelectorAll(".event-checkmark[data-activity-type]"),
            ].filter((button) => button.dataset.accountId === accountId &&
                button.dataset.activityType === activityType &&
                button.dataset.eventKey === eventKey);
            const previous = buttons.map((button) => [
                button,
                button.getAttribute("aria-pressed") === "true",
            ]);
            const checked = checkmark.getAttribute("aria-pressed") !== "true";
            window.eventsActivityRevision = (window.eventsActivityRevision || 0) + 1;
            buttons.forEach((button) => {
                button.dataset.saving = "true";
                button.setAttribute("aria-busy", "true");
                render(button, checked);
            });
            try {
                const response = await fetch("/api/events/activity-check", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: AbortSignal.timeout(15000),
                    body: JSON.stringify({
                        account_id: Number(accountId),
                        activity_type: activityType,
                        checked,
                        event_key: eventKey,
                        event_token: eventToken,
                    }),
                });
                const data = await response.json();
                if (!response.ok || !data.success || typeof data.checked !== "boolean") {
                    throw new Error(data.error || "Could not save completion.");
                }
                buttons.forEach((button) => {
                    render(button, data.checked);
                    button.removeAttribute("aria-description");
                });
            }
            catch (error) {
                previous.forEach(([button, value]) => {
                    render(button, value);
                    button.setAttribute("aria-description", "Could not save completion. Please try again.");
                });
                console.error("Failed to update activity checkmark:", error);
            }
            finally {
                window.eventsActivityRevision = (window.eventsActivityRevision || 0) + 1;
                buttons.forEach((button) => {
                    delete button.dataset.saving;
                    button.removeAttribute("aria-busy");
                });
            }
        });
    });
};
