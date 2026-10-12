function initCustomEvents() {
    const page = document.querySelector(".events-page");

    if (!page || page.dataset.customEventsInitialised === "true") {
        return;
    }

    page.dataset.customEventsInitialised = "true";

    const modal = page.querySelector("[data-custom-modal]");
    const form = modal?.querySelector("[data-custom-form]");
    const errorBox = modal?.querySelector("[data-custom-error]");
    const titleElement = modal?.querySelector("#custom-event-form-title");
    const saveButton = modal?.querySelector(".events-custom-save");

    if (!modal || !form) {
        console.warn("Custom Events: form modal not found.");
        return;
    }

    let events = [];
    let loading = false;

    const $ = (selector, parent = page) =>
        parent.querySelector(selector);

    const $$ = (selector, parent = page) =>
        Array.from(parent.querySelectorAll(selector));

    // =========================================
    // API HELPERS
    // =========================================

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                ...(options.body
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(options.headers || {}),
            },
        });

        const text = await response.text();

        let data = {};

        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            throw new Error(
                `The server returned an invalid response (${response.status}).`
            );
        }

        if (!response.ok || data.success === false) {
            throw new Error(
                data.detail ||
                data.error ||
                `Request failed (${response.status}).`
            );
        }

        return data;
    }

    function showError(message) {
        if (!errorBox) return;

        errorBox.textContent = message;
        errorBox.hidden = false;
    }

    function clearError() {
        if (!errorBox) return;

        errorBox.textContent = "";
        errorBox.hidden = true;
    }

    // =========================================
    // DATE HELPERS
    // =========================================

    function toLocalInputValue(value) {
        if (!value) return "";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return "";

        const localDate = new Date(
            date.getTime() - date.getTimezoneOffset() * 60000
        );

        return localDate.toISOString().slice(0, 16);
    }

    function fromLocalInputValue(value) {
        if (!value) return null;

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            throw new Error("Please enter a valid date and time.");
        }

        return date.toISOString();
    }

    function formatDate(value) {
        if (!value) return "";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) return "";

        return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(date);
    }

    function recurrenceLabel(recurrence) {
        if (!recurrence || recurrence.type === "none") {
            return "One-time";
        }

        const interval = Number(recurrence.interval || 1);

        const unit = {
            daily: "day",
            weekly: "week",
            monthly: "month",
        }[recurrence.type];

        if (!unit) return "One-time";

        let label = interval === 1
            ? `Every ${unit}`
            : `Every ${interval} ${unit}s`;

        if (
            recurrence.type === "weekly" &&
            Array.isArray(recurrence.weekdays) &&
            recurrence.weekdays.length
        ) {
            const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

            label += " · " + recurrence.weekdays
                .map(day => names[day])
                .filter(Boolean)
                .join(", ");
        }

        return label;
    }

    // =========================================
    // MODAL
    // =========================================

    function openModal(event = null) {
        form.reset();
        clearError();

        form.elements.event_id.value = event?.id ?? "";
        form.elements.title.value = event?.title ?? "";
        form.elements.description.value = event?.description ?? "";

        form.elements.account_scope.value =
            event?.account_scope ?? "all";

        if (event?.account_id != null) {
            form.elements.account_id.value = String(event.account_id);
        }

        form.elements.start_at.value =
            toLocalInputValue(event?.start_at);

        form.elements.end_at.value =
            toLocalInputValue(event?.end_at);

        form.elements.recurrence_type.value =
            event?.recurrence?.type ?? "none";

        form.elements.recurrence_interval.value =
            event?.recurrence?.interval ?? 1;

        form.elements.colour.value =
            event?.colour ?? "#7c83ff";

        form.elements.reminder_minutes.value =
            event?.reminder_minutes == null
                ? ""
                : String(event.reminder_minutes);

        const weekdays = event?.recurrence?.weekdays ?? [];

        $$('input[name="recurrence_weekdays"]', form).forEach(input => {
            input.checked = weekdays.includes(Number(input.value));
        });

        const objectives = $("[data-custom-objectives]", form);
        objectives.replaceChildren();

        for (const objective of event?.progress ?? []) {
            addObjective(objective);
        }

        updateConditionalFields();

        if (titleElement) {
            titleElement.textContent = event
                ? "Edit Event"
                : "Create Event";
        }

        if (saveButton) {
            saveButton.textContent = event
                ? "Save Changes"
                : "Save Event";
        }

        modal.hidden = false;
        document.body.style.overflow = "hidden";

        form.elements.title.focus();
    }

    function closeModal() {
        modal.hidden = true;
        document.body.style.overflow = "";
        clearError();
    }

    modal.addEventListener("click", event => {
        if (event.target.closest("[data-custom-close]")) {
            closeModal();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) {
            closeModal();
        }
    });

    // =========================================
    // CONDITIONAL FORM FIELDS
    // =========================================

    function updateConditionalFields() {
        const scope = form.elements.account_scope.value;
        const recurrenceType = form.elements.recurrence_type.value;

        const accountField = $("[data-custom-account-field]", form);
        const weekdaysField = $("[data-custom-weekdays]", form);
        const intervalField = form.elements.recurrence_interval;

        if (accountField) {
            accountField.hidden = scope !== "account";
        }

        if (weekdaysField) {
            weekdaysField.hidden = recurrenceType !== "weekly";
        }

        intervalField.disabled = recurrenceType === "none";
    }

    form.addEventListener("change", event => {
        if (
            event.target.name === "account_scope" ||
            event.target.name === "recurrence_type"
        ) {
            updateConditionalFields();
        }
    });

    // =========================================
    // PROGRESS OBJECTIVES
    // =========================================

    function addObjective(objective = {}) {
        const container = $("[data-custom-objectives]", form);
        if (!container) return;

        if (container.children.length >= 20) {
            showError("You can add up to 20 progress objectives.");
            return;
        }

        const row = document.createElement("div");
        row.className = "events-custom-objective";

        const titleInput = document.createElement("input");
        titleInput.type = "text";
        titleInput.placeholder = "Objective";
        titleInput.maxLength = 100;
        titleInput.value = objective.title ?? "";
        titleInput.setAttribute("aria-label", "Objective name");
        titleInput.dataset.objectiveTitle = "";

        const currentInput = document.createElement("input");
        currentInput.type = "number";
        currentInput.min = "0";
        currentInput.value = objective.current ?? 0;
        currentInput.setAttribute("aria-label", "Current progress");
        currentInput.dataset.objectiveCurrent = "";

        const targetInput = document.createElement("input");
        targetInput.type = "number";
        targetInput.min = "1";
        targetInput.value = objective.target ?? 1;
        targetInput.setAttribute("aria-label", "Progress target");
        targetInput.dataset.objectiveTarget = "";

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "events-custom-objective-remove";
        removeButton.textContent = "×";
        removeButton.setAttribute("aria-label", "Remove objective");

        removeButton.addEventListener("click", () => row.remove());

        row.append(
            titleInput,
            currentInput,
            targetInput,
            removeButton
        );

        container.append(row);
    }

    $("[data-custom-add-objective]", modal)?.addEventListener(
        "click",
        () => addObjective()
    );

    function readObjectives() {
        return $$(
            ".events-custom-objective",
            form
        ).map(row => ({
            title: $("[data-objective-title]", row).value.trim(),
            current: Number($("[data-objective-current]", row).value),
            target: Number($("[data-objective-target]", row).value),
        }));
    }

    // =========================================
    // FORM SERIALISATION
    // =========================================

    function buildPayload() {
        const accountScope = form.elements.account_scope.value;
        const recurrenceType = form.elements.recurrence_type.value;

        const recurrence = {
            type: recurrenceType,
            interval: recurrenceType === "none"
                ? 1
                : Number(form.elements.recurrence_interval.value),
        };

        if (recurrenceType === "weekly") {
            recurrence.weekdays = $$(
                'input[name="recurrence_weekdays"]:checked',
                form
            ).map(input => Number(input.value));

            if (!recurrence.weekdays.length) {
                throw new Error(
                    "Choose at least one weekday for a weekly event."
                );
            }
        }

        const startAt = fromLocalInputValue(
            form.elements.start_at.value
        );

        const endAt = fromLocalInputValue(
            form.elements.end_at.value
        );

        if (endAt && new Date(endAt) <= new Date(startAt)) {
            throw new Error("The end must be after the start.");
        }

        const progress = readObjectives();

        for (const objective of progress) {
            if (!objective.title) {
                throw new Error("Every progress objective needs a name.");
            }

            if (
                !Number.isInteger(objective.current) ||
                !Number.isInteger(objective.target) ||
                objective.current < 0 ||
                objective.target < 1
            ) {
                throw new Error(
                    "Progress values must be whole numbers. Current must be at least 0 and target at least 1."
                );
            }
        }

        return {
            title: form.elements.title.value.trim(),
            description: form.elements.description.value.trim() || null,

            account_scope: accountScope,
            account_id: accountScope === "account"
                ? Number(form.elements.account_id.value)
                : null,

            start_at: startAt,
            end_at: endAt,

            recurrence,
            colour: form.elements.colour.value,

            reminder_minutes: form.elements.reminder_minutes.value === ""
                ? null
                : Number(form.elements.reminder_minutes.value),

            progress,
        };
    }

    // =========================================
    // EVENT LIST
    // =========================================

    function makeElement(tag, className, text = "") {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        if (text !== "") {
            element.textContent = text;
        }

        return element;
    }

    function makeButton(label, className, callback) {
        const button = makeElement(
            "button",
            `events-custom-action ${className || ""}`,
            label
        );

        button.type = "button";
        button.addEventListener("click", callback);

        return button;
    }

    function renderProgress(event, card) {
        if (!Array.isArray(event.progress) || !event.progress.length) {
            return;
        }

        const section = makeElement("div", "events-custom-progress");

        for (const objective of event.progress) {
            const current = Math.max(0, Number(objective.current) || 0);
            const target = Math.max(1, Number(objective.target) || 1);
            const percent = Math.min(100, (current / target) * 100);

            const item = makeElement(
                "div",
                "events-custom-progress-item"
            );

            const name = makeElement(
                "span",
                "",
                objective.title || "Objective"
            );

            const value = makeElement(
                "span",
                "",
                `${current}/${target}`
            );

            const track = makeElement(
                "div",
                "events-custom-progress-track"
            );

            const fill = makeElement(
                "div",
                "events-custom-progress-fill"
            );

            fill.style.width = `${percent}%`;
            fill.style.backgroundColor = event.colour || "#7c83ff";

            track.append(fill);
            item.append(name, value, track);
            section.append(item);
        }

        card.append(section);
    }

    function renderEvent(event, list) {
        const completed = (event.completions || []).some(
            completion =>
                completion.completed &&
                new Date(completion.occurrence_start).getTime() ===
                new Date(event.start_at).getTime()
        );

        const card = makeElement(
            "article",
            `events-custom-card${completed ? " is-completed" : ""}`
        );

        card.style.setProperty(
            "--custom-event-colour",
            event.colour || "#7c83ff"
        );

        const accent = makeElement("div", "events-custom-card-accent");
        accent.setAttribute("aria-hidden", "true");

        const content = makeElement("div", "events-custom-card-content");
        const heading = makeElement("div", "events-custom-card-heading");
        const textGroup = makeElement("div");

        const title = makeElement(
            "h3",
            "events-custom-card-title",
            event.title
        );

        textGroup.append(title);

        if (event.description) {
            textGroup.append(
                makeElement(
                    "p",
                    "events-custom-card-description",
                    event.description
                )
            );
        }

        const meta = makeElement("div", "events-custom-card-meta");

        meta.append(
            makeElement(
                "span",
                "events-custom-chip",
                formatDate(event.start_at)
            ),
            makeElement(
                "span",
                "events-custom-chip",
                recurrenceLabel(event.recurrence)
            ),
            makeElement(
                "span",
                "events-custom-chip",
                event.account_scope === "all"
                    ? "All accounts"
                    : "Specific account"
            )
        );

        if (event.end_at) {
            meta.append(
                makeElement(
                    "span",
                    "events-custom-chip",
                    `Ends ${formatDate(event.end_at)}`
                )
            );
        }

        heading.append(textGroup);
        content.append(heading, meta);

        if (event.reminder_minutes != null) {
            const reminderLabel = event.reminder_minutes === 0
                ? "Reminder at start"
                : `Reminder ${event.reminder_minutes} min before`;

            content.append(
                makeElement("div", "events-custom-card-meta", reminderLabel)
            );
        }

        renderProgress(event, content);

        const actions = makeElement("div", "events-custom-card-actions");

        actions.append(
            makeButton(
                completed ? "Mark incomplete" : "Mark complete",
                "",
                () => toggleCompletion(event, !completed)
            ),
            makeButton(
                "Edit",
                "",
                () => openModal(event)
            ),
            makeButton(
                "Delete",
                "events-custom-action-danger",
                () => removeEvent(event)
            )
        );

        content.append(actions);
        card.append(accent, content);
        list.append(card);
    }

    function renderEmpty(list, message, description) {
        const empty = makeElement("div", "events-custom-empty");

        empty.append(
            makeElement("span", "events-custom-empty-title", message),
            makeElement(
                "span",
                "events-custom-empty-description",
                description
            )
        );

        list.append(empty);
    }

    function renderEvents() {
        const lists = $$("[data-custom-event-list]");

        lists.forEach(list => {
            list.replaceChildren();

            if (!events.length) {
                renderEmpty(
                    list,
                    "No Custom Events Yet",
                    "Create an event to start tracking your own activities."
                );
                return;
            }

            events.forEach(event => renderEvent(event, list));
        });
    }

    async function loadEvents() {
        if (loading) return;

        loading = true;

        try {
            const params = new URLSearchParams();

            const isOverview = page.dataset.overview === "true";
            const accountId = page.dataset.accountId;

            if (!isOverview && accountId) {
                params.set("account_id", accountId);
            }

            const suffix = params.toString()
                ? `?${params.toString()}`
                : "";

            const data = await apiRequest(
                `/api/custom-events${suffix}`
            );

            events = data.events || [];
            renderEvents();
        } catch (error) {
            console.error("Failed to load Custom Events:", error);

            $$("[data-custom-event-list]").forEach(list => {
                list.replaceChildren();

                renderEmpty(
                    list,
                    "Couldn't Load Custom Events",
                    error.message || "Please refresh the page and try again."
                );
            });
        } finally {
            loading = false;
        }
    }

    // =========================================
    // CREATE / EDIT
    // =========================================

    $$("[data-custom-create]").forEach(button => {
        button.addEventListener("click", () => openModal());
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();
        clearError();

        if (saveButton) {
            saveButton.disabled = true;
        }

        try {
            const payload = buildPayload();
            const eventId = form.elements.event_id.value;

            const result = await apiRequest(
                eventId
                    ? `/api/custom-events/${encodeURIComponent(eventId)}`
                    : "/api/custom-events",
                {
                    method: eventId ? "PUT" : "POST",
                    body: JSON.stringify(payload),
                }
            );

            closeModal();
            await loadEvents();

            if (window.refreshEvents) {

            }
        } catch (error) {
            showError(error.message || "Unable to save this event.");
        } finally {
            if (saveButton) {
                saveButton.disabled = false;
            }
        }
    });

    // =========================================
    // DELETE
    // =========================================

    async function removeEvent(event) {
        const confirmed = window.confirm(
            `Delete "${event.title}"? This cannot be undone.`
        );

        if (!confirmed) return;

        try {
            await apiRequest(
                `/api/custom-events/${encodeURIComponent(event.id)}`,
                { method: "DELETE" }
            );

            await loadEvents();
        } catch (error) {
            window.alert(error.message || "Unable to delete this event.");
        }
    }

    // =========================================
    // MANUAL COMPLETION
    // =========================================

    async function toggleCompletion(event, completed) {
        try {
            await apiRequest(
                `/api/custom-events/${encodeURIComponent(event.id)}/completion`,
                {
                    method: "POST",
                    body: JSON.stringify({
                        completed,
                        occurrence_start: event.start_at,
                    }),
                }
            );

            await loadEvents();
        } catch (error) {
            window.alert(
                error.message || "Unable to update event completion."
            );
        }
    }

    // =========================================
    // INITIALISE
    // =========================================

    updateConditionalFields();
    loadEvents();
}

window.initCustomEvents = initCustomEvents;