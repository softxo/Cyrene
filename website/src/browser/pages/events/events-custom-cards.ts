// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Custom event cards, countdowns and completion state.
window.CyreneCustomEventCards = (ctx) => {
    const {
        makeElement,
        recurrenceLabel,
        makeButton,
        getCustomIconUrl,
        removeEvent,
        toggleCompletion,
    } = ctx;
    const initialiseEventDragAndDrop = (...args) => ctx.initialiseEventDragAndDrop(...args);
    const openModal = (...args) => ctx.openModal(...args);
    const renderProgress = (...args) => ctx.renderProgress(...args);

    function getCustomEventCountdownTarget(event) {
        const start = new Date(event.start_at);

        if (Number.isNaN(start.getTime())) {
            return NaN;
        }

        const recurrence = event.recurrence;

        if (!recurrence || recurrence.type === "none") {
            return start.getTime();
        }

        const interval = Math.max(1, Number(recurrence.interval) || 1);
        const now = new Date();

        while (start.getTime() <= now.getTime()) {
            if (recurrence.type === "daily") {
                start.setDate(start.getDate() + interval);
            } else if (recurrence.type === "weekly") {
                start.setDate(start.getDate() + 7 * interval);
            } else if (recurrence.type === "monthly") {
                const day = start.getDate();
                start.setDate(1);
                start.setMonth(start.getMonth() + interval);

                const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();

                start.setDate(Math.min(day, lastDay));
            } else {
                return start.getTime();
            }
        }

        return start.getTime();
    }

    function getCompletionOccurrenceStart(event) {
        const recurrence = event.recurrence;

        if (!recurrence || recurrence.type === "none") {
            return new Date(event.start_at).toISOString();
        }

        const timestamp = getCustomEventCountdownTarget(event);

        if (!Number.isFinite(timestamp)) {
            return new Date(event.start_at).toISOString();
        }

        return new Date(timestamp).toISOString();
    }

    function renderEvent(event, list) {
        const occurrenceStart = getCompletionOccurrenceStart(event);
        const completed = (event.completions || []).some(
            (completion) =>
                completion.completed &&
                new Date(completion.occurrence_start).getTime() ===
                    new Date(occurrenceStart).getTime(),
        );
        const card = makeElement(
            "article",
            `events-custom-card${completed ? " is-completed" : ""}`,
        );

        card.dataset.customEventId = String(event.id);

        card.style.setProperty("--custom-event-colour", event.colour || "#7c83ff");

        const accent = makeElement("div", "events-custom-card-accent");
        const dragHandle = makeElement("button", "events-custom-drag-handle");

        dragHandle.type = "button";
        dragHandle.draggable = true;
        dragHandle.dataset.customEventDragHandle = "";
        dragHandle.setAttribute("aria-label", `Reorder ${event.title}`);

        accent.append(dragHandle);

        const content = makeElement("div", "events-custom-card-content");
        const topRow = makeElement("div", "events-custom-card-top-row");
        const titleGroup = makeElement("div", "events-custom-card-title-group");
        const icon = document.createElement("img");

        icon.className = "events-custom-card-icon";
        icon.src = getCustomIconUrl(event.icon_url) || "/static/images/ui/ui_icons/Events.png";
        icon.alt = "";
        icon.loading = "lazy";
        icon.draggable = false;

        icon.addEventListener(
            "error",
            () => {
                icon.src = "/static/images/ui/ui_icons/Events.png";
            },
            { once: true },
        );

        titleGroup.append(icon);

        const title = makeElement("h3", "events-custom-card-title", event.title);

        titleGroup.append(title);
        topRow.append(titleGroup);

        const date = new Date(event.start_at);
        const dateLabel = new Intl.DateTimeFormat(undefined, {
            day: "numeric",
            month: "short",
        }).format(date);

        topRow.append(
            makeElement("span", "events-custom-chip", dateLabel),
            makeElement("span", "events-custom-chip", recurrenceLabel(event.recurrence)),
        );

        const countdown = makeElement("span", "events-custom-countdown", "");
        const startValue = Number(event.start_at);
        const startTimestamp =
            Number.isFinite(startValue) && startValue > 0
                ? startValue < 1e12
                    ? startValue * 1000
                    : startValue
                : new Date(event.start_at).getTime();

        countdown.dataset.countdownTarget = String(getCustomEventCountdownTarget(event));

        const statusPills = makeElement(
            "div",
            "events-custom-status-pills events-custom-card-status",
        );
        statusPills.append(
            makeElement(
                "span",
                `events-custom-completion event-list-status ${completed ? "claimed event-completion-pill" : ""}`,
                completed ? "Complete" : "Incomplete",
            ),
            countdown,
        );
        topRow.append(statusPills);
        content.append(topRow);

        if (event.description) {
            content.append(makeElement("p", "events-custom-card-description", event.description));
        }

        if (event.reminder_minutes != null) {
            let reminderLabel;

            if (event.reminder_minutes === 0) {
                reminderLabel = "Reminder: at start";
            } else if (event.reminder_minutes % 60 === 0) {
                const hours = event.reminder_minutes / 60;

                reminderLabel = `Reminder: ${hours} ${hours === 1 ? "hour" : "hours"} before`;
            } else {
                reminderLabel = `Reminder: ${event.reminder_minutes} minutes before`;
            }

            topRow.insertBefore(
                makeElement("span", "events-custom-card-reminder", reminderLabel),
                statusPills,
            );
        }

        renderProgress(event, content);

        const actions = makeElement("div", "events-custom-card-actions");

        actions.append(
            makeButton(completed ? "Mark Incomplete" : "Mark Complete", "", () =>
                toggleCompletion(event, !completed, occurrenceStart),
            ),
            makeButton("Edit", "", () => openModal(event)),
            makeButton("Delete", "events-custom-action-danger cyrene-button--danger", () =>
                removeEvent(event),
            ),
        );

        content.append(actions);
        card.append(accent, content);

        initialiseEventDragAndDrop(card, list);

        list.append(card);
    }

    function renderEmpty(
        list,
        message = "No Custom Events Yet",
        description = "Create an event to keep track of what matters.",
    ) {
        const empty = makeElement("div", "events-custom-empty");

        empty.append(
            makeElement("span", "events-custom-empty-title", message),
            makeElement("span", "events-custom-empty-description", description),
        );

        list.append(empty);
    }

    function updateCustomEventCountdowns() {
        document
            .querySelectorAll(".events-custom-countdown[data-countdown-target]")
            .forEach((timer) => {
                const target = Number(timer.dataset.countdownTarget);

                if (!Number.isFinite(target)) {
                    timer.textContent = "—";
                    return;
                }

                const remaining = Math.floor((target - Date.now()) / 1000);

                timer.classList.remove("warning", "danger");

                if (remaining <= 0) {
                    timer.textContent = "0m left";
                    return;
                }

                const days = Math.floor(remaining / 86400);
                const hours = Math.floor((remaining % 86400) / 3600);
                const minutes = Math.floor((remaining % 3600) / 60);

                if (days > 0) {
                    timer.textContent = `${days}d ${hours}h left`;
                } else if (hours > 0) {
                    timer.textContent = `${hours}h ${minutes}m left`;
                } else {
                    timer.textContent = `${minutes}m left`;
                }

                if (remaining < 86400) {
                    timer.classList.add("danger");
                } else if (remaining < 259200) {
                    timer.classList.add("warning");
                }
            });
    }

    function isEventCompleted(event) {
        const occurrence = new Date(getCompletionOccurrenceStart(event)).getTime();
        return (event.completions || []).some(
            (completion) =>
                completion.completed &&
                new Date(completion.occurrence_start).getTime() === occurrence,
        );
    }

    return {
        getCompletionOccurrenceStart,
        getCustomEventCountdownTarget,
        isEventCompleted,
        renderEmpty,
        renderEvent,
        updateCustomEventCountdowns,
    };
};
