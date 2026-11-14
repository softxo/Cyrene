// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Overview rows and rendering the full custom event list.
window.CyreneCustomEventOverview = (ctx) => {
    const {
        state,
        makeElement,
        recurrenceLabel,
        makeButton,
        initialiseAnimatedDetails,
        page,
        getCustomIconUrl,
        accountLoadErrors,
        eventsByAccount,
        $$,
        apiRequest,
        removeEvent,
        toggleCompletion,
    } = ctx;
    const getCompletionOccurrenceStart = (...args) => ctx.getCompletionOccurrenceStart(...args);
    const getCustomEventCountdownTarget = (...args) => ctx.getCustomEventCountdownTarget(...args);
    const initialiseEventDragAndDrop = (...args) => ctx.initialiseEventDragAndDrop(...args);
    const isEventCompleted = (...args) => ctx.isEventCompleted(...args);
    const openModal = (...args) => ctx.openModal(...args);
    const renderEmpty = (...args) => ctx.renderEmpty(...args);
    const renderEvent = (...args) => ctx.renderEvent(...args);
    const updateCustomEventCountdowns = (...args) => ctx.updateCustomEventCountdowns(...args);

    function renderOverviewEvent(event, list, accountId) {
        const completed = isEventCompleted(event);
        const row = makeElement("details", "events-custom-overview-event");
        row.dataset.customEventId = String(event.id);
        row.dataset.accountId = String(accountId);
        row.style.setProperty("--custom-event-colour", event.colour || "#7c83ff");
        const summary = makeElement("summary", "events-custom-overview-summary");
        const dragHandle = makeElement("button", "events-custom-drag-handle");
        dragHandle.type = "button";
        dragHandle.dataset.customEventDragHandle = "";
        dragHandle.setAttribute("aria-label", `Reorder ${event.title}`);
        dragHandle.addEventListener("click", (clickEvent) => {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
        });
        summary.append(dragHandle);
        const icon = document.createElement("img");
        icon.className = "events-custom-overview-icon";
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
        const title = makeElement("span", "events-custom-overview-name", event.title);
        summary.append(icon, title);

        const date = new Date(event.start_at);
        const dateLabel = new Intl.DateTimeFormat(undefined, {
            day: "numeric",
            month: "short",
        }).format(date);

        summary.append(
            makeElement("span", "events-custom-chip", dateLabel),
            makeElement("span", "events-custom-chip", recurrenceLabel(event.recurrence)),
        );

        if (event.reminder_minutes != null) {
            const reminderMinutes = Number(event.reminder_minutes);
            let reminderLabel = "Reminder: at start";
            if (reminderMinutes > 0 && reminderMinutes % 60 === 0) {
                const hours = reminderMinutes / 60;
                reminderLabel = `Reminder: ${hours} ${hours === 1 ? "hour" : "hours"} before`;
            } else if (reminderMinutes > 0) {
                reminderLabel = `Reminder: ${reminderMinutes} minutes before`;
            }
            summary.append(makeElement("span", "events-custom-card-reminder", reminderLabel));
        }

        const objectives = event.progress || [];
        const summaryStatus = makeElement("span", "events-custom-overview-summary-status");
        let objectiveSummary = null;
        if (objectives.length) {
            const finished = objectives.filter(
                (item) => Number(item.current) >= Number(item.target),
            ).length;
            objectiveSummary = makeElement(
                "span",
                `events-custom-overview-progress${finished === objectives.length ? " event-completion-pill" : ""}`,
                `${finished}/${objectives.length} objectives`,
            );
            summaryStatus.append(objectiveSummary);
        }
        const status = makeElement("span", "events-custom-countdown", "");
        if (completed) {
            row.classList.add("is-completed");
        }
        status.dataset.countdownTarget = String(getCustomEventCountdownTarget(event));
        const toggleIcon = makeElement("span", "events-custom-overview-toggle");
        toggleIcon.setAttribute("aria-hidden", "true");
        const statusPills = makeElement("span", "events-custom-status-pills");
        statusPills.append(
            makeElement(
                "span",
                `events-custom-completion event-list-status ${completed ? "claimed event-completion-pill" : ""}`,
                completed ? "Complete" : "Incomplete",
            ),
            status,
        );
        summaryStatus.append(statusPills, toggleIcon);
        summary.append(summaryStatus);
        const body = makeElement("div", "events-custom-overview-details");
        if (event.description) {
            body.append(makeElement("p", "events-custom-card-description", event.description));
        }

        const actions = makeElement(
            "div",
            "events-custom-card-actions events-custom-overview-actions",
        );
        actions.append(
            makeButton(completed ? "Mark Incomplete" : "Mark Complete", "", () =>
                toggleCompletion(event, !completed, getCompletionOccurrenceStart(event), accountId),
            ),
            makeButton("Edit", "", () => openModal(event, accountId)),
            makeButton("Delete", "events-custom-action-danger cyrene-button--danger", () =>
                removeEvent(event, accountId),
            ),
        );

        const manage = makeElement(
            "a",
            "events-custom-overview-manage events-custom-action",
            "Manage in account",
        );
        manage.href = `/events?account_id=${encodeURIComponent(accountId)}&tab=custom`;
        actions.append(manage);

        objectives.forEach((objective, index) => {
            const target = Math.max(1, Number(objective.target) || 1);
            const current = Math.min(target, Math.max(0, Number(objective.current) || 0));
            const item = makeElement(
                "div",
                "events-custom-overview-objective events-custom-progress-item",
            );
            const label = objective.title || "Objective";
            const value = makeElement(
                "span",
                "events-custom-overview-objective-value events-custom-progress-value",
                `${current}/${target}`,
            );
            item.append(
                makeElement(
                    "span",
                    "events-custom-overview-objective-name events-custom-progress-name",
                    label,
                ),
                value,
            );
            const progress = makeElement(
                "div",
                "events-custom-overview-objective-track events-custom-progress-track",
            );
            const fill = makeElement(
                "div",
                "events-custom-overview-objective-fill events-custom-progress-fill",
            );
            fill.style.width = `${(current / target) * 100}%`;
            progress.append(fill);
            progress.setAttribute("role", "progressbar");
            progress.setAttribute("aria-label", label);
            progress.setAttribute("aria-valuemin", "0");
            progress.setAttribute("aria-valuemax", String(target));
            progress.setAttribute("aria-valuenow", String(current));
            const controls = makeElement("div", "events-custom-overview-objective-controls");
            const decrease = makeElement(
                "button",
                "cyrene-button events-custom-overview-objective-button events-custom-progress-button",
                "−",
            );
            const increase = makeElement(
                "button",
                "cyrene-button events-custom-overview-objective-button events-custom-progress-button",
                "+",
            );
            decrease.type = increase.type = "button";
            decrease.setAttribute("aria-label", `Decrease ${label} progress for this account`);
            increase.setAttribute("aria-label", `Increase ${label} progress for this account`);
            decrease.disabled = current <= 0;
            increase.disabled = current >= target;

            async function changeProgress(amount) {
                const previous = Number(objective.current) || 0;
                const next = Math.max(0, Math.min(target, previous + amount));
                if (next === previous) return;

                function update(currentValue) {
                    objective.current = currentValue;
                    value.textContent = `${currentValue}/${target}`;
                    fill.style.width = `${(currentValue / target) * 100}%`;
                    progress.setAttribute("aria-valuenow", String(currentValue));
                    const finished = objectives.filter(
                        (entry) => Number(entry.current) >= Number(entry.target),
                    ).length;
                    objectiveSummary.textContent = `${finished}/${objectives.length} objectives`;
                    objectiveSummary.classList.toggle(
                        "event-completion-pill",
                        finished === objectives.length,
                    );
                    item.classList.toggle("is-finished", currentValue >= target);
                    decrease.disabled = currentValue <= 0;
                    increase.disabled = currentValue >= target;
                }

                update(next);
                decrease.disabled = increase.disabled = true;
                try {
                    const result = await apiRequest(
                        `/api/custom-events/${encodeURIComponent(event.id)}/progress`,
                        {
                            method: "POST",
                            body: JSON.stringify({
                                account_id: Number(accountId),
                                objective_index: index,
                                amount,
                            }),
                        },
                    );
                    if (!Number.isFinite(Number(result.current))) {
                        throw new Error("The server returned invalid progress. Please try again.");
                    }
                    update(Math.max(0, Math.min(target, Number(result.current))));
                    window.showCyreneToast?.("Objective progress saved.");
                } catch (error) {
                    update(previous);
                    window.showCyreneToast?.(
                        error.message || "Unable to update objective progress.",
                        "error",
                    );
                }
            }

            decrease.addEventListener("click", () => changeProgress(-1));
            increase.addEventListener("click", () => changeProgress(1));
            controls.append(decrease, increase);
            item.append(progress, controls);
            item.classList.toggle("is-finished", current >= target);
            body.append(item);
        });

        body.append(actions);

        row.append(summary, body);
        initialiseAnimatedDetails(row, summary, body);
        initialiseEventDragAndDrop(row, list);
        list.append(row);
    }

    function renderEvents() {
        const lists = $$("[data-custom-event-list]");
        const isOverview = page.dataset.overview === "true";

        lists.forEach((list) => {
            list.replaceChildren();

            const accountId = list.dataset.accountId || page.dataset.accountId;
            const listEvents = isOverview
                ? eventsByAccount.get(String(accountId)) || []
                : state.events;

            if (isOverview) {
                if (accountLoadErrors.has(String(accountId))) {
                    const count = list
                        .closest("[data-custom-account-group]")
                        ?.querySelector("[data-custom-account-count]");
                    if (count) {
                        count.textContent = "Unavailable";
                        count.classList.remove("event-completion-pill");
                    }
                    renderEmpty(
                        list,
                        "Couldn't Load Custom Events",
                        accountLoadErrors.get(String(accountId)),
                    );
                    return;
                }
                const completedCount = listEvents.filter(isEventCompleted).length;
                const count = list
                    .closest("[data-custom-account-group]")
                    ?.querySelector("[data-custom-account-count]");
                if (count) {
                    count.classList.toggle(
                        "event-completion-pill",
                        listEvents.length > 0 && completedCount === listEvents.length,
                    );
                    count.textContent = listEvents.length
                        ? `${completedCount}/${listEvents.length} complete`
                        : "No events";
                }
                listEvents.forEach((event) => renderOverviewEvent(event, list, accountId));
                if (!listEvents.length) {
                    list.append(
                        makeElement(
                            "p",
                            "events-custom-overview-empty",
                            "No custom events for this account yet.",
                        ),
                    );
                }
                updateCustomEventCountdowns();
                return;
            }

            if (!listEvents.length) {
                renderEmpty(list);
                return;
            }

            listEvents.forEach((event) => {
                renderEvent(event, list);
            });
        });

        updateCustomEventCountdowns();
    }

    return {
        renderEvents,
    };
};
