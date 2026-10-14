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

    async function apiRequest(url, options = {}, schema = null) {
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

        if (schema) {
            const result = schema.safeParse(data);

            if (!result.success) {
                console.error(
                    "Custom Events API validation failed:\n",
                    JSON.stringify(result.error.issues, null, 2),
                );

                throw new Error(
                    "The server returned unexpected Custom Events data. Please refresh the page."
                );
            }

            return result.data;
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

        const accountDropdown = $("[data-custom-account-select]", form);

        const defaultAccountId = accountDropdown?.querySelector(
            "[data-account-id]"
        )?.dataset.accountId ?? "";

        updateAccountDropdown(
            event?.account_id != null
                ? String(event.account_id)
                : defaultAccountId
        );

        form.elements.start_at.value =
            toLocalInputValue(event?.start_at);

        form.elements.end_at.value =
            toLocalInputValue(event?.end_at);

        updateFormDropdown(
            "recurrence_type",
            event?.recurrence?.type ?? "none"
        );

        form.elements.recurrence_interval.value =
            event?.recurrence?.interval ?? 1;

        form.elements.colour.value =
            event?.colour ?? "#7c83ff";

        updateFormDropdown(
            "reminder_minutes",
            event?.reminder_minutes == null
                ? ""
                : String(event.reminder_minutes)
        );

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

    // =========================================
    // CUSTOM ACCOUNT DROPDOWN
    // =========================================

    function updateAccountDropdown(selectedId) {
        const dropdown = $("[data-custom-account-select]", form);
        if (!dropdown) return;

        const hiddenInput = dropdown.querySelector(
            'input[name="account_id"]'
        );

        const valueElement = dropdown.querySelector(
            ".custom-select-value"
        );

        const options = Array.from(
            dropdown.querySelectorAll("[data-account-id]")
        );

        const selectedOption = options.find(
            option => option.dataset.accountId === String(selectedId)
        );

        if (hiddenInput) {
            hiddenInput.value = selectedOption
                ? selectedOption.dataset.accountId
                : "";
        }

        if (valueElement) {
            valueElement.textContent = selectedOption
                ? selectedOption.textContent.trim()
                : "Select an account";
        }

        options.forEach(option => {
            const isSelected = option === selectedOption;

            option.classList.toggle("active", isSelected);
            option.setAttribute("aria-selected", String(isSelected));
        });
    }

    function initialiseAccountDropdown() {
        const dropdown = $("[data-custom-account-select]", form);
        if (!dropdown) return;

        const button = dropdown.querySelector(".custom-select-button");
        const menu = dropdown.querySelector(".custom-select-menu");

        if (!button || !menu) return;

        button.addEventListener("click", () => {
            const isOpen = dropdown.classList.toggle("open");
            button.setAttribute("aria-expanded", String(isOpen));
        });

        dropdown.querySelectorAll("[data-account-id]").forEach(option => {
            option.addEventListener("click", () => {
                updateAccountDropdown(option.dataset.accountId);

                dropdown.classList.remove("open");
                button.setAttribute("aria-expanded", "false");
            });
        });

        document.addEventListener("click", event => {
            if (!dropdown.contains(event.target)) {
                dropdown.classList.remove("open");
                button.setAttribute("aria-expanded", "false");
            }
        });

        updateAccountDropdown(
            dropdown.querySelector("[data-account-id]")?.dataset.accountId
        );
    }

    // =========================================
    // SCHEDULE AND REMINDER DROPDOWNS
    // =========================================

    function updateFormDropdown(name, selectedValue) {
        const dropdown = $(
            `[data-custom-dropdown="${name}"]`,
            form
        );

        if (!dropdown) return;

        const hiddenInput = dropdown.querySelector(
            `input[name="${name}"]`
        );

        const valueElement = dropdown.querySelector(
            ".custom-select-value"
        );

        const options = Array.from(
            dropdown.querySelectorAll("[data-value]")
        );

        const selectedOption = options.find(
            option => option.dataset.value === String(selectedValue)
        );

        if (hiddenInput) {
            hiddenInput.value = selectedOption
                ? selectedOption.dataset.value
                : "";
        }

        if (valueElement) {
            valueElement.textContent = selectedOption
                ? selectedOption.textContent.trim()
                : "Select an option";
        }

        options.forEach(option => {
            const selected = option === selectedOption;

            option.classList.toggle("active", selected);
            option.setAttribute("aria-selected", String(selected));
        });
    }

    function initialiseFormDropdowns() {
        $$("[data-custom-dropdown]", form).forEach(dropdown => {
            const button = dropdown.querySelector(
                ".custom-select-button"
            );

            if (!button) return;

            const name = dropdown.dataset.customDropdown;

            button.addEventListener("click", () => {
                const isOpen = dropdown.classList.toggle("open");

                button.setAttribute(
                    "aria-expanded",
                    String(isOpen)
                );
            });

            dropdown.querySelectorAll("[data-value]").forEach(option => {
                option.addEventListener("click", () => {
                    updateFormDropdown(name, option.dataset.value);

                    dropdown.classList.remove("open");
                    button.setAttribute("aria-expanded", "false");

                    const hiddenInput = dropdown.querySelector(
                        `input[name="${name}"]`
                    );

                    if (hiddenInput) {
                        hiddenInput.dispatchEvent(
                            new Event("change", { bubbles: true })
                        );
                    }
                });
            });
        });

        // Close the menus when clicking outside them.
        document.addEventListener("click", event => {
            $$("[data-custom-dropdown]", form).forEach(dropdown => {
                if (dropdown.contains(event.target)) return;

                dropdown.classList.remove("open");

                dropdown.querySelector(
                    ".custom-select-button"
                )?.setAttribute("aria-expanded", "false");
            });
        });
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
        const weekdaysField = $("[data-custom-weekdays-field]", form);
        const intervalField = form.elements.recurrence_interval;
        const intervalContainer = $(
            "[data-custom-interval-field]",
            form
        );

        // Show the Account dropdown only for One account.
        if (accountField) {
            accountField.hidden = scope !== "account";
        }

        // Show weekday options only for a weekly schedule.
        if (weekdaysField) {
            weekdaysField.hidden = recurrenceType !== "weekly";
        }

        // Disable and hide the repeat interval for one-time events.
        if (intervalField) {
            intervalField.disabled = recurrenceType === "none";
        }

        if (intervalContainer) {
            intervalContainer.hidden = recurrenceType === "none";
        }
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

        row.querySelectorAll('input[type="number"]').forEach(
            enhanceNumberInput
        );
    }

    // =========================================
    // CUSTOM NUMBER SPINNERS
    // =========================================

    function enhanceNumberInput(input) {
        if (input.dataset.customSpinner === "true") {
            return;
        }

        input.dataset.customSpinner = "true";

        const wrapper = document.createElement("div");
        wrapper.className = "events-custom-number";
        wrapper.dataset.customSpinnerWrapper = "";

        input.parentNode.insertBefore(wrapper, input);
        wrapper.append(input);

        const spinner = document.createElement("div");
        spinner.className = "number-spinner";

        function changeValue(direction) {
            if (input.disabled || input.readOnly) {
                return;
            }

            const step = Number(input.step) || 1;
            const min = input.min === "" ? -Infinity : Number(input.min);
            const max = input.max === "" ? Infinity : Number(input.max);

            const current = input.value === ""
                ? (Number.isFinite(min) ? min : 0)
                : Number(input.value);

            const next = direction === "up"
                ? Math.min(current + step, max)
                : Math.max(current - step, min);

            if (next === current) {
                return;
            }

            input.value = String(next);

            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }

        function createButton(direction, label) {
            const button = document.createElement("button");

            button.type = "button";
            button.className = "number-spinner-button";
            button.dataset.direction = direction;
            button.setAttribute("aria-label", label);

            const arrow = document.createElement("span");
            arrow.className = "spinner-arrow";
            button.append(arrow);

            let holdTimeout = null;
            let holdInterval = null;

            function stopHolding() {
                if (holdTimeout !== null) {
                    clearTimeout(holdTimeout);
                    holdTimeout = null;
                }

                if (holdInterval !== null) {
                    clearInterval(holdInterval);
                    holdInterval = null;
                }
            }

            function startHolding(event) {
                if (event.type === "mousedown" && event.button !== 0) {
                    return;
                }

                event.preventDefault();
                stopHolding();
                changeValue(direction);

                holdTimeout = setTimeout(() => {
                    holdInterval = setInterval(() => {
                        changeValue(direction);
                    }, 50);

                    holdTimeout = null;
                }, 350);
            }

            button.addEventListener("mousedown", startHolding);
            button.addEventListener("mouseup", stopHolding);
            button.addEventListener("mouseleave", stopHolding);

            button.addEventListener("touchstart", startHolding, {
                passive: false,
            });

            button.addEventListener("touchend", stopHolding);
            button.addEventListener("touchcancel", stopHolding);

            button.addEventListener("click", event => {
                event.preventDefault();
            });

            window.addEventListener("blur", stopHolding);

            return button;
        }

        spinner.append(
            createButton("up", "Increase value"),
            createButton("down", "Decrease value")
        );

        wrapper.append(spinner);
    }

    // Enhance the static number field.
    form.querySelectorAll('input[type="number"]').forEach(
        enhanceNumberInput
    );

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

    async function changeObjectiveProgress(
        event,
        objectiveIndex,
        amount,
        ui
    ) {
        const objective = event.progress?.[objectiveIndex];
        if (!objective) return;

        const target = Math.max(1, Number(objective.target) || 1);
        const previous = Math.max(
            0,
            Math.min(target, Number(objective.current) || 0)
        );
        const next = Math.max(0, Math.min(target, previous + amount));

        if (next === previous) return;

        // Update the data and UI immediately so the bar can animate.
        objective.current = next;

        ui.value.textContent = `${next}/${target}`;
        ui.fill.style.width = `${Math.min(100, (next / target) * 100)}%`;

        ui.track.setAttribute("aria-valuenow", String(next));

        ui.increase.disabled = next >= target;
        ui.decrease.disabled = next <= 0;

        // Prevent overlapping saves for this objective.
        ui.increase.disabled = true;
        ui.decrease.disabled = true;

        const payload = {
            title: event.title,
            description: event.description || null,
            account_scope: event.account_scope,
            account_id: event.account_scope === "account"
                ? event.account_id
                : null,
            start_at: event.start_at,
            end_at: event.end_at || null,
            recurrence: event.recurrence || {
                type: "none",
                interval: 1
            },
            colour: event.colour || "#7c83ff",
            reminder_minutes: event.reminder_minutes ?? null,
            progress: event.progress
        };

        try {
            await apiRequest(
                `/api/custom-events/${encodeURIComponent(event.id)}`,
                {
                    method: "PUT",
                    body: JSON.stringify(payload)
                },
                window.CyreneSchemas.customEventResponseSchema
            );
        } catch (error) {
            // Restore the previous value if saving fails.
            objective.current = previous;

            ui.value.textContent = `${previous}/${target}`;
            ui.fill.style.width =
                `${Math.min(100, (previous / target) * 100)}%`;

            ui.track.setAttribute("aria-valuenow", String(previous));

            window.alert(
                error.message || "Unable to update objective progress."
            );
        } finally {
            // Re-enable only the buttons that are currently valid.
            const current = Number(objective.current) || 0;

            ui.increase.disabled = current >= target;
            ui.decrease.disabled = current <= 0;
        }
    }


    function renderProgress(event, card) {
        if (!Array.isArray(event.progress) || !event.progress.length) {
            return;
        }

        const section = makeElement("div", "events-custom-progress");

        event.progress.forEach((objective, index) => {
            const current = Math.max(0, Number(objective.current) || 0);
            const target = Math.max(1, Number(objective.target) || 1);
            const percent = Math.min(100, (current / target) * 100);

            const item = makeElement(
                "div",
                "events-custom-progress-item"
            );

            const heading = makeElement(
                "div",
                "events-custom-progress-heading"
            );

            const name = makeElement(
                "span",
                "events-custom-progress-name",
                objective.title || "Objective"
            );

            const value = makeElement(
                "span",
                "events-custom-progress-value",
                `${current}/${target}`
            );

            heading.append(name, value);

            const controls = makeElement(
                "div",
                "events-custom-progress-controls"
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

            track.setAttribute(
                "role",
                "progressbar"
            );
            track.setAttribute(
                "aria-label",
                objective.title || "Objective progress"
            );
            track.setAttribute("aria-valuemin", "0");
            track.setAttribute("aria-valuemax", String(target));
            track.setAttribute("aria-valuenow", String(current));

            track.append(fill);

            const decreaseButton = makeElement(
                "button",
                "events-custom-progress-button",
                "−"
            );

            decreaseButton.type = "button";
            decreaseButton.setAttribute(
                "aria-label",
                `Decrease ${objective.title || "objective"} progress`
            );
            decreaseButton.disabled = current <= 0;

            decreaseButton.addEventListener("click", () => {
                changeObjectiveProgress(event, index, -1, {
                    value,
                    fill,
                    increase: increaseButton,
                    decrease: decreaseButton,
                    track
                });
            });

            const increaseButton = makeElement(
                "button",
                "events-custom-progress-button",
                "+"
            );

            increaseButton.type = "button";
            increaseButton.setAttribute(
                "aria-label",
                `Increase ${objective.title || "objective"} progress`
            );
            increaseButton.disabled = current >= target;

            increaseButton.addEventListener("click", () => {
                changeObjectiveProgress(event, index, 1, {
                    value,
                    fill,
                    increase: increaseButton,
                    decrease: decreaseButton,
                    track
                });
            });

            controls.append(track, decreaseButton, increaseButton);
            item.append(heading, controls);
            section.append(item);
        });

        card.append(section);
    }

    
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

        // Keep advancing recurring events until the next future occurrence.
        while (start.getTime() <= now.getTime()) {
            if (recurrence.type === "daily") {
                start.setDate(start.getDate() + interval);
            } else if (recurrence.type === "weekly") {
                start.setDate(start.getDate() + (7 * interval));
            } else if (recurrence.type === "monthly") {
                const day = start.getDate();
                start.setDate(1);
                start.setMonth(start.getMonth() + interval);

                const lastDay = new Date(
                    start.getFullYear(),
                    start.getMonth() + 1,
                    0
                ).getDate();

                start.setDate(Math.min(day, lastDay));
            } else {
                return start.getTime();
            }
        }

        return start.getTime();
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
        const topRow = makeElement("div", "events-custom-card-top-row");

        const title = makeElement(
            "h3",
            "events-custom-card-title",
            event.title
        );

        topRow.append(title);

        const date = new Date(event.start_at);
        const dateLabel = new Intl.DateTimeFormat(undefined, {
            day: "numeric",
            month: "short"
        }).format(date);

        topRow.append(
            makeElement("span", "events-custom-chip", dateLabel),
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

        const countdown = makeElement(
            "span",
            "events-custom-countdown",
            completed ? "Completed" : ""
        );

        const startValue = Number(event.start_at);

        const startTimestamp =
            Number.isFinite(startValue) && startValue > 0
                ? (startValue < 1e12 ? startValue * 1000 : startValue)
                : new Date(event.start_at).getTime();

        countdown.dataset.countdownTarget =
            String(getCustomEventCountdownTarget(event));

        topRow.append(countdown);
        content.append(topRow);

        if (event.description) {
            content.append(
                makeElement(
                    "p",
                    "events-custom-card-description",
                    event.description
                )
            );
        }

        if (event.reminder_minutes != null) {
            let reminderLabel;

            if (event.reminder_minutes === 0) {
                reminderLabel = "Reminder: at start";
            } else if (event.reminder_minutes % 60 === 0) {
                const hours = event.reminder_minutes / 60;
                reminderLabel =
                    `Reminder: ${hours} ${hours === 1 ? "hour" : "hours"} before`;
            } else {
                reminderLabel =
                    `Reminder: ${event.reminder_minutes} minutes before`;
            }

            content.append(
                makeElement(
                    "div",
                    "events-custom-card-reminder",
                    reminderLabel
                )
            );
        }

        renderProgress(event, content);

        const actions = makeElement("div", "events-custom-card-actions");

        actions.append(
            makeButton(
                completed ? "Mark Incomplete" : "Mark Complete",
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


    function updateCustomEventCountdowns() {
        document.querySelectorAll(
            ".events-custom-countdown[data-countdown-target]"
        ).forEach(timer => {
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

        updateCustomEventCountdowns();
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
                `/api/custom-events${suffix}`,
                {},
                window.CyreneSchemas.customEventsListResponseSchema
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
            const rawPayload = buildPayload();

            const validation = window.CyreneSchemas.customEventSchema.safeParse(
                rawPayload
            );

            if (!validation.success) {
                const firstIssue = validation.error.issues[0];

                throw new Error(
                    firstIssue
                        ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
                        : "Please check the event details."
                );
            }

            const payload = validation.data;
            const eventId = form.elements.event_id.value;

            const result = await apiRequest(
                eventId
                    ? `/api/custom-events/${encodeURIComponent(eventId)}`
                    : "/api/custom-events",
                {
                    method: eventId ? "PUT" : "POST",
                    body: JSON.stringify(payload),
                },
                window.CyreneSchemas.customEventResponseSchema
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
                { method: "DELETE" },
                window.CyreneSchemas.deleteCustomEventResponseSchema
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
                },
                window.CyreneSchemas.customEventCompletionResponseSchema
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

    initialiseAccountDropdown();
    initialiseFormDropdowns();

    updateFormDropdown(
        "recurrence_type",
        form.elements.recurrence_type.value || "none"
    );

    updateFormDropdown(
        "reminder_minutes",
        form.elements.reminder_minutes.value || ""
    );

    updateConditionalFields();
    loadEvents();

    updateCustomEventCountdowns();
    setInterval(updateCustomEventCountdowns, 60_000);
    
}

window.initCustomEvents = initCustomEvents;