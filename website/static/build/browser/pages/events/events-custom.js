// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
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
    // =========================================
    // CUSTOM EVENT ICON
    // =========================================
    let currentIconUrl = null;
    let previewObjectUrl = null;
    const iconInput = form.querySelector("[data-custom-icon-file]");
    const iconImage = form.querySelector("[data-custom-icon-image]");
    const iconFilename = form.querySelector("[data-custom-icon-filename]");
    const removeIconButton = form.querySelector("[data-custom-icon-remove]");
    function clearPreviewObjectUrl() {
        if (previewObjectUrl) {
            URL.revokeObjectURL(previewObjectUrl);
            previewObjectUrl = null;
        }
    }
    function renderCustomIconPreview(src = null, filename = "") {
        if (!iconImage)
            return;
        if (src) {
            iconImage.src = src;
            iconImage.hidden = false;
        }
        else {
            iconImage.removeAttribute("src");
            iconImage.hidden = true;
        }
        if (iconFilename) {
            iconFilename.textContent = filename || (src ? "Current event icon" : "No image selected");
        }
        if (removeIconButton) {
            removeIconButton.hidden = !src;
        }
    }
    iconInput?.addEventListener("change", () => {
        const file = iconInput.files?.[0];
        if (!file) {
            return;
        }
        const allowedTypes = [
            "image/png",
            "image/jpeg",
            "image/webp",
        ];
        if (!allowedTypes.includes(file.type)) {
            iconInput.value = "";
            clearPreviewObjectUrl();
            renderCustomIconPreview(currentIconUrl);
            showError("Choose a PNG, JPEG or WebP image.");
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            iconInput.value = "";
            clearPreviewObjectUrl();
            renderCustomIconPreview(currentIconUrl);
            showError("Event icons cannot exceed 2 MB.");
            return;
        }
        clearError();
        clearPreviewObjectUrl();
        previewObjectUrl = URL.createObjectURL(file);
        // Do not revoke this URL inside renderCustomIconPreview().
        renderCustomIconPreview(previewObjectUrl, file.name);
    });
    removeIconButton?.addEventListener("click", () => {
        clearPreviewObjectUrl();
        currentIconUrl = null;
        if (iconInput) {
            iconInput.value = "";
        }
        renderCustomIconPreview();
    });
    let events = [];
    let eventsByAccount = new Map();
    let loading = false;
    let draggingEventId = null;
    let savingOrder = false;
    const $ = (selector, parent = page) => parent.querySelector(selector);
    const $$ = (selector, parent = page) => Array.from(parent.querySelectorAll(selector));
    // =========================================
    // API HELPERS
    // =========================================
    async function apiRequest(url, options = {}, schema = null) {
        const isFormData = options.body instanceof FormData;
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                ...(options.body && !isFormData
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(options.headers || {}),
            },
        });
        const text = await response.text();
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        }
        catch {
            throw new Error(`The server returned an invalid response (${response.status}).`);
        }
        if (!response.ok || data.success === false) {
            throw new Error(data.detail ||
                data.error ||
                `Request failed (${response.status}).`);
        }
        if (schema) {
            const result = schema.safeParse(data);
            if (!result.success) {
                console.error("Custom Events API validation failed:\n", JSON.stringify(result.error.issues, null, 2));
                throw new Error("The server returned unexpected Custom Events data. Please refresh the page.");
            }
            return result.data;
        }
        return data;
    }
    function showError(message) {
        if (!errorBox)
            return;
        errorBox.textContent = message;
        errorBox.hidden = false;
    }
    function clearError() {
        if (!errorBox)
            return;
        errorBox.textContent = "";
        errorBox.hidden = true;
    }
    // =========================================
    // DATE HELPERS
    // =========================================
    function toLocalInputValue(value) {
        if (!value)
            return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime()))
            return "";
        const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return localDate.toISOString().slice(0, 16);
    }
    function fromLocalInputValue(value) {
        if (!value)
            return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            throw new Error("Please enter a valid date and time.");
        }
        return date.toISOString();
    }
    function formatDate(value) {
        if (!value)
            return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime()))
            return "";
        return new Intl.DateTimeFormat(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(date);
    }
    let activeDateTimePicker = null;
    function initialiseDateTimePickers() {
        $$('input[type="datetime-local"]', form).forEach(input => {
            if (input.dataset.customDateTimeInitialised === "true")
                return;
            input.dataset.customDateTimeInitialised = "true";
            const isRequired = input.required;
            input.required = false;
            const wrapper = document.createElement("div");
            wrapper.className = "events-custom-datetime";
            const trigger = document.createElement("button");
            trigger.type = "button";
            trigger.className = "events-custom-datetime-trigger";
            trigger.setAttribute("aria-haspopup", "dialog");
            trigger.setAttribute("aria-expanded", "false");
            trigger.setAttribute("aria-required", String(isRequired));
            const triggerValue = document.createElement("span");
            triggerValue.className = "events-custom-datetime-value";
            const triggerIcon = document.createElement("span");
            triggerIcon.className = "events-custom-datetime-icon";
            triggerIcon.setAttribute("aria-hidden", "true");
            trigger.append(triggerValue, triggerIcon);
            const popover = document.createElement("div");
            popover.className = "events-custom-calendar";
            popover.setAttribute("role", "dialog");
            popover.setAttribute("aria-label", "Choose date and time");
            popover.hidden = true;
            const header = document.createElement("div");
            header.className = "events-custom-calendar-header";
            const previous = document.createElement("button");
            previous.type = "button";
            previous.className = "events-custom-calendar-nav";
            previous.textContent = "‹";
            previous.setAttribute("aria-label", "Previous month");
            const monthLabel = document.createElement("strong");
            monthLabel.className = "events-custom-calendar-month";
            const next = document.createElement("button");
            next.type = "button";
            next.className = "events-custom-calendar-nav";
            next.textContent = "›";
            next.setAttribute("aria-label", "Next month");
            header.append(previous, monthLabel, next);
            const weekdays = document.createElement("div");
            weekdays.className = "events-custom-calendar-weekdays";
            ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
                .forEach(day => {
                const label = document.createElement("span");
                label.textContent = day;
                weekdays.append(label);
            });
            const grid = document.createElement("div");
            grid.className = "events-custom-calendar-grid";
            grid.setAttribute("role", "grid");
            const timeRow = document.createElement("div");
            timeRow.className = "events-custom-calendar-time";
            const timeLabel = document.createElement("span");
            timeLabel.textContent = "Time";
            const hour = document.createElement("input");
            const minute = document.createElement("input");
            hour.type = minute.type = "text";
            hour.inputMode = minute.inputMode = "numeric";
            hour.maxLength = minute.maxLength = 2;
            hour.autocomplete = minute.autocomplete = "off";
            hour.setAttribute("aria-label", "Hour");
            minute.setAttribute("aria-label", "Minute");
            const separator = document.createElement("span");
            separator.textContent = ":";
            timeRow.append(timeLabel, hour, separator, minute);
            const footer = document.createElement("div");
            footer.className = "events-custom-calendar-footer";
            const today = document.createElement("button");
            today.type = "button";
            today.className = "events-custom-calendar-secondary";
            today.textContent = "Today";
            const footerEnd = document.createElement("div");
            footerEnd.className = "events-custom-calendar-footer-end";
            let clear = null;
            if (!isRequired) {
                clear = document.createElement("button");
                clear.type = "button";
                clear.className = "events-custom-calendar-secondary";
                clear.textContent = "Clear";
                footerEnd.append(clear);
            }
            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "events-custom-calendar-secondary";
            cancel.textContent = "Cancel";
            const apply = document.createElement("button");
            apply.type = "button";
            apply.className = "events-custom-calendar-apply";
            apply.textContent = "Apply";
            footerEnd.append(cancel, apply);
            footer.append(today, footerEnd);
            popover.append(header, weekdays, grid, timeRow, footer);
            input.after(wrapper);
            wrapper.append(trigger, popover);
            input.hidden = true;
            let selectedDate = new Date();
            let displayedMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
            function valuesMatch(first, second) {
                return first.getFullYear() === second.getFullYear() &&
                    first.getMonth() === second.getMonth() &&
                    first.getDate() === second.getDate();
            }
            function refreshTrigger() {
                if (!input.value) {
                    triggerValue.textContent = isRequired
                        ? "Select date and time"
                        : "No end date";
                    trigger.classList.add("is-placeholder");
                    return;
                }
                const value = new Date(input.value);
                triggerValue.textContent = new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short"
                }).format(value);
                trigger.classList.remove("is-placeholder");
            }
            function renderCalendar() {
                monthLabel.textContent = new Intl.DateTimeFormat(undefined, {
                    month: "long",
                    year: "numeric"
                }).format(displayedMonth);
                grid.replaceChildren();
                const firstDay = new Date(displayedMonth.getFullYear(), displayedMonth.getMonth(), 1);
                const mondayOffset = (firstDay.getDay() + 6) % 7;
                const gridStart = new Date(firstDay);
                gridStart.setDate(firstDay.getDate() - mondayOffset);
                const currentDate = new Date();
                for (let index = 0; index < 42; index += 1) {
                    const date = new Date(gridStart);
                    date.setDate(gridStart.getDate() + index);
                    const day = document.createElement("button");
                    day.type = "button";
                    day.className = "events-custom-calendar-day";
                    day.textContent = String(date.getDate());
                    day.setAttribute("role", "gridcell");
                    day.setAttribute("aria-label", new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(date));
                    day.classList.toggle("is-outside", date.getMonth() !== displayedMonth.getMonth());
                    day.classList.toggle("is-today", valuesMatch(date, currentDate));
                    day.classList.toggle("is-selected", valuesMatch(date, selectedDate));
                    day.addEventListener("click", () => {
                        selectedDate.setFullYear(date.getFullYear(), date.getMonth(), date.getDate());
                        displayedMonth = new Date(date.getFullYear(), date.getMonth(), 1);
                        renderCalendar();
                    });
                    grid.append(day);
                }
            }
            function closePicker() {
                popover.hidden = true;
                trigger.setAttribute("aria-expanded", "false");
                if (activeDateTimePicker === picker) {
                    activeDateTimePicker = null;
                }
            }
            function openPicker() {
                activeDateTimePicker?.close();
                $$(".custom-select.open", form).forEach(dropdown => {
                    dropdown.classList.remove("open");
                    dropdown.querySelector("[aria-expanded]")
                        ?.setAttribute("aria-expanded", "false");
                });
                const parsed = input.value ? new Date(input.value) : new Date();
                selectedDate = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
                displayedMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
                hour.value = String(selectedDate.getHours()).padStart(2, "0");
                const roundedMinute = Math.round(selectedDate.getMinutes() / 5) * 5;
                minute.value = String(roundedMinute === 60 ? 55 : roundedMinute)
                    .padStart(2, "0");
                renderCalendar();
                popover.hidden = false;
                trigger.setAttribute("aria-expanded", "true");
                activeDateTimePicker = picker;
            }
            function commitValue() {
                const hours = Math.max(0, Math.min(23, Number(hour.value) || 0));
                const minutes = Math.max(0, Math.min(59, Number(minute.value) || 0));
                selectedDate.setHours(hours, minutes, 0, 0);
                const pad = value => String(value).padStart(2, "0");
                input.value = `${selectedDate.getFullYear()}-${pad(selectedDate.getMonth() + 1)}-${pad(selectedDate.getDate())}T${pad(selectedDate.getHours())}:${pad(selectedDate.getMinutes())}`;
                input.dispatchEvent(new Event("change", { bubbles: true }));
                refreshTrigger();
                closePicker();
                trigger.focus();
            }
            const picker = { close: closePicker, refresh: refreshTrigger };
            input.customDateTimePicker = picker;
            trigger.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                if (popover.hidden) {
                    openPicker();
                }
                else {
                    closePicker();
                }
            });
            popover.addEventListener("click", event => event.stopPropagation());
            previous.addEventListener("click", () => {
                displayedMonth.setMonth(displayedMonth.getMonth() - 1);
                renderCalendar();
            });
            next.addEventListener("click", () => {
                displayedMonth.setMonth(displayedMonth.getMonth() + 1);
                renderCalendar();
            });
            today.addEventListener("click", () => {
                selectedDate = new Date();
                displayedMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
                hour.value = String(selectedDate.getHours()).padStart(2, "0");
                minute.value = String(Math.floor(selectedDate.getMinutes() / 5) * 5).padStart(2, "0");
                renderCalendar();
            });
            [[hour, 23], [minute, 59]].forEach(([field, maximum]) => {
                field.addEventListener("input", () => {
                    field.value = field.value.replace(/\D/g, "").slice(0, 2);
                });
                field.addEventListener("blur", () => {
                    const value = Math.max(0, Math.min(maximum, Number(field.value) || 0));
                    field.value = String(value).padStart(2, "0");
                });
            });
            clear?.addEventListener("click", () => {
                input.value = "";
                input.dispatchEvent(new Event("change", { bubbles: true }));
                refreshTrigger();
                closePicker();
                trigger.focus();
            });
            cancel.addEventListener("click", () => {
                closePicker();
                trigger.focus();
            });
            apply.addEventListener("click", commitValue);
            document.addEventListener("click", event => {
                if (!wrapper.contains(event.target))
                    closePicker();
            });
            refreshTrigger();
        });
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
        if (!unit)
            return "One-time";
        let label = interval === 1
            ? `Every ${unit}`
            : `Every ${interval} ${unit}s`;
        if (recurrence.type === "weekly" &&
            Array.isArray(recurrence.weekdays) &&
            recurrence.weekdays.length) {
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
        clearPreviewObjectUrl();
        form.reset();
        clearError();
        // Event icon
        currentIconUrl = event?.icon_url ?? null;
        if (iconInput) {
            iconInput.value = "";
        }
        renderCustomIconPreview(currentIconUrl);
        form.elements.event_id.value = event?.id ?? "";
        form.elements.title.value = event?.title ?? "";
        form.elements.description.value = event?.description ?? "";
        form.elements.account_scope.value =
            event?.account_scope ?? "all";
        const accountDropdown = $("[data-custom-account-select]", form);
        const defaultAccountId = accountDropdown?.querySelector("[data-account-id]")?.dataset.accountId ?? "";
        updateAccountDropdown(event?.account_id != null
            ? String(event.account_id)
            : defaultAccountId);
        form.elements.start_at.value =
            toLocalInputValue(event?.start_at);
        form.elements.end_at.value =
            toLocalInputValue(event?.end_at);
        $$('input[type="datetime-local"]', form).forEach(input => {
            input.customDateTimePicker?.refresh();
        });
        updateFormDropdown("recurrence_type", event?.recurrence?.type ?? "none");
        form.elements.recurrence_interval.value =
            event?.recurrence?.interval ?? 1;
        form.elements.colour.value =
            event?.colour ?? "#7c83ff";
        updateFormDropdown("reminder_minutes", event?.reminder_minutes == null
            ? ""
            : String(event.reminder_minutes));
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
        if (!dropdown)
            return;
        const hiddenInput = dropdown.querySelector('input[name="account_id"]');
        const valueElement = dropdown.querySelector(".custom-select-value");
        const options = Array.from(dropdown.querySelectorAll("[data-account-id]"));
        const selectedOption = options.find(option => option.dataset.accountId === String(selectedId));
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
        if (!dropdown)
            return;
        const button = dropdown.querySelector(".custom-select-button");
        const menu = dropdown.querySelector(".custom-select-menu");
        if (!button || !menu)
            return;
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
        updateAccountDropdown(dropdown.querySelector("[data-account-id]")?.dataset.accountId);
    }
    // =========================================
    // SCHEDULE AND REMINDER DROPDOWNS
    // =========================================
    function updateFormDropdown(name, selectedValue) {
        const dropdown = $(`[data-custom-dropdown="${name}"]`, form);
        if (!dropdown)
            return;
        const hiddenInput = dropdown.querySelector(`input[name="${name}"]`);
        const valueElement = dropdown.querySelector(".custom-select-value");
        const options = Array.from(dropdown.querySelectorAll("[data-value]"));
        const selectedOption = options.find(option => option.dataset.value === String(selectedValue));
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
            const button = dropdown.querySelector(".custom-select-button");
            if (!button)
                return;
            const name = dropdown.dataset.customDropdown;
            button.addEventListener("click", () => {
                const isOpen = dropdown.classList.toggle("open");
                button.setAttribute("aria-expanded", String(isOpen));
            });
            dropdown.querySelectorAll("[data-value]").forEach(option => {
                option.addEventListener("click", () => {
                    updateFormDropdown(name, option.dataset.value);
                    dropdown.classList.remove("open");
                    button.setAttribute("aria-expanded", "false");
                    const hiddenInput = dropdown.querySelector(`input[name="${name}"]`);
                    if (hiddenInput) {
                        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
                    }
                });
            });
        });
        // Close the menus when clicking outside them.
        document.addEventListener("click", event => {
            $$("[data-custom-dropdown]", form).forEach(dropdown => {
                if (dropdown.contains(event.target))
                    return;
                dropdown.classList.remove("open");
                dropdown.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "false");
            });
        });
    }
    function closeModal() {
        clearPreviewObjectUrl();
        activeDateTimePicker?.close();
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
            if (activeDateTimePicker) {
                activeDateTimePicker.close();
                return;
            }
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
        const intervalContainer = $("[data-custom-interval-field]", form);
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
        if (event.target.name === "account_scope" ||
            event.target.name === "recurrence_type") {
            updateConditionalFields();
        }
    });
    // =========================================
    // PROGRESS OBJECTIVES
    // =========================================
    function addObjective(objective = {}) {
        const container = $("[data-custom-objectives]", form);
        if (!container)
            return;
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
        currentInput.value = "0";
        currentInput.disabled = true;
        currentInput.setAttribute("aria-description", "Progress is tracked separately for each account.");
        currentInput.setAttribute("aria-label", "Progress is tracked separately for each account");
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
        row.append(titleInput, currentInput, targetInput, removeButton);
        container.append(row);
        row.querySelectorAll('input[type="number"]').forEach(enhanceNumberInput);
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
        spinner.append(createButton("up", "Increase value"), createButton("down", "Decrease value"));
        wrapper.append(spinner);
    }
    // Enhance the static number field.
    form.querySelectorAll('input[type="number"]').forEach(enhanceNumberInput);
    $("[data-custom-add-objective]", modal)?.addEventListener("click", () => addObjective());
    function readObjectives() {
        return $$(".events-custom-objective", form).map(row => ({
            title: $("[data-objective-title]", row).value.trim(),
            current: 0,
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
            recurrence.weekdays = $$('input[name="recurrence_weekdays"]:checked', form).map(input => Number(input.value));
            if (!recurrence.weekdays.length) {
                throw new Error("Choose at least one weekday for a weekly event.");
            }
        }
        const startAt = fromLocalInputValue(form.elements.start_at.value);
        const endAt = fromLocalInputValue(form.elements.end_at.value);
        if (endAt && new Date(endAt) <= new Date(startAt)) {
            throw new Error("The end must be after the start.");
        }
        const progress = readObjectives();
        for (const objective of progress) {
            if (!objective.title) {
                throw new Error("Every progress objective needs a name.");
            }
            if (!Number.isInteger(objective.current) ||
                !Number.isInteger(objective.target) ||
                objective.current < 0 ||
                objective.target < 1) {
                throw new Error("Progress values must be whole numbers. Current must be at least 0 and target at least 1.");
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
    // CUSTOM EVENTS — DRAG AND DROP ORDER
    // =========================================
    function getOrderedEventIds(list) {
        return Array.from(list.querySelectorAll(":scope > .events-custom-card")).map(card => card.dataset.customEventId);
    }
    function handleEventDragStart(event, card) {
        if (savingOrder) {
            event.preventDefault();
            return;
        }
        draggingEventId = card.dataset.customEventId;
        const bounds = card.getBoundingClientRect();
        event.dataTransfer.setDragImage(card, event.clientX - bounds.left, event.clientY - bounds.top);
        card.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggingEventId);
    }
    function handleEventDragOver(event, list, card) {
        if (!draggingEventId || savingOrder) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const draggingCard = list.querySelector(`[data-custom-event-id="${CSS.escape(draggingEventId)}"]`);
        if (!draggingCard || draggingCard === card) {
            return;
        }
        const bounds = card.getBoundingClientRect();
        const insertAfter = event.clientY > bounds.top + bounds.height / 2;
        if (insertAfter) {
            card.after(draggingCard);
        }
        else {
            card.before(draggingCard);
        }
    }
    function handleEventDragEnd() {
        $$("[data-custom-event-id]").forEach(card => {
            card.classList.remove("is-dragging");
        });
        draggingEventId = null;
    }
    async function saveEventOrder(list, previousEvents) {
        const accountId = list.dataset.accountId || page.dataset.accountId;
        if (!accountId) {
            renderEvents();
            return;
        }
        const orderedIds = getOrderedEventIds(list);
        const previousIds = previousEvents.map(event => String(event.id));
        if (orderedIds.length !== previousIds.length ||
            orderedIds.every((id, index) => id === previousIds[index])) {
            renderEvents();
            return;
        }
        const eventsById = new Map(previousEvents.map(event => [String(event.id), event]));
        const reorderedEvents = orderedIds.map(id => eventsById.get(id));
        if (reorderedEvents.some(event => !event) ||
            reorderedEvents.length !== previousEvents.length) {
            renderEvents();
            return;
        }
        const isOverview = page.dataset.overview === "true";
        if (isOverview) {
            eventsByAccount.set(String(accountId), reorderedEvents);
        }
        else {
            events = reorderedEvents;
        }
        renderEvents();
        savingOrder = true;
        $$("[data-custom-event-drag-handle]").forEach(handle => {
            handle.disabled = true;
        });
        try {
            await apiRequest("/api/custom-events/reorder", {
                method: "POST",
                body: JSON.stringify({
                    account_id: Number(accountId),
                    ordered_event_ids: orderedIds.map(Number),
                }),
            });
        }
        catch (error) {
            if (isOverview) {
                eventsByAccount.set(String(accountId), previousEvents);
            }
            else {
                events = previousEvents;
            }
            renderEvents();
            alert(error.message ||
                "Could not save the event order. Please try again.");
        }
        finally {
            savingOrder = false;
            $$("[data-custom-event-drag-handle]").forEach(handle => {
                handle.disabled = false;
            });
        }
    }
    function initialiseEventDragAndDrop(card, list) {
        // Only the drag handle should initiate dragging.
        card.draggable = false;
        const dragHandle = card.querySelector("[data-custom-event-drag-handle]");
        if (dragHandle) {
            dragHandle.draggable = true;
            dragHandle.addEventListener("dragstart", event => {
                event.stopPropagation();
                handleEventDragStart(event, card);
            });
            dragHandle.addEventListener("dragend", event => {
                event.stopPropagation();
                handleEventDragEnd();
            });
        }
        card.addEventListener("dragover", event => {
            handleEventDragOver(event, list, card);
        });
        card.addEventListener("drop", async (event) => {
            if (!draggingEventId || savingOrder) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const accountId = list.dataset.accountId || page.dataset.accountId;
            const previousEvents = page.dataset.overview === "true"
                ? [
                    ...(eventsByAccount.get(String(accountId)) || [])
                ]
                : [...events];
            handleEventDragEnd();
            await saveEventOrder(list, previousEvents);
        });
    }
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
        const button = makeElement("button", `events-custom-action ${className || ""}`, label);
        button.type = "button";
        button.addEventListener("click", callback);
        return button;
    }
    async function changeObjectiveProgress(event, objectiveIndex, amount, ui) {
        const objective = event.progress?.[objectiveIndex];
        if (!objective)
            return;
        const isOverview = page.dataset.overview === "true";
        const accountId = page.dataset.accountId;
        // Never write shared progress from a normal page without an account ID.
        if (!isOverview && !accountId) {
            window.alert("The selected account could not be identified. Please refresh the page.");
            return;
        }
        const target = Math.max(1, Number(objective.target) || 1);
        const previous = Math.max(0, Math.min(target, Number(objective.current) || 0));
        const next = Math.max(0, Math.min(target, previous + amount));
        if (next === previous)
            return;
        // Update the interface optimistically.
        objective.current = next;
        function updateProgressUI(current) {
            ui.value.textContent = `${current}/${target}`;
            ui.fill.style.width =
                `${Math.min(100, (current / target) * 100)}%`;
            ui.track.setAttribute("aria-valuenow", String(current));
            ui.increase.disabled = current >= target;
            ui.decrease.disabled = current <= 0;
        }
        updateProgressUI(next);
        // Prevent multiple simultaneous requests for this objective.
        ui.increase.disabled = true;
        ui.decrease.disabled = true;
        try {
            if (!isOverview) {
                // NORMAL ACCOUNT PAGE:
                // Save progress for this account and objective only.
                const result = await apiRequest(`/api/custom-events/${encodeURIComponent(event.id)}/progress`, {
                    method: "POST",
                    body: JSON.stringify({
                        account_id: Number(accountId),
                        objective_index: objectiveIndex,
                        amount,
                    }),
                });
                // Use the authoritative value returned by the server.
                objective.current = result.current;
                updateProgressUI(result.current);
            }
            else {
                // OVERVIEW:
                // Preserve the existing behaviour for now.
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
                        interval: 1,
                    },
                    colour: event.colour || "#7c83ff",
                    reminder_minutes: event.reminder_minutes ?? null,
                    progress: event.progress,
                };
                await apiRequest(`/api/custom-events/${encodeURIComponent(event.id)}`, {
                    method: "PUT",
                    body: JSON.stringify(payload),
                }, window.CyreneSchemas.customEventResponseSchema);
            }
        }
        catch (error) {
            // Restore the previous value if the save fails.
            objective.current = previous;
            updateProgressUI(previous);
            window.alert(error.message || "Unable to update objective progress.");
        }
        finally {
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
            const item = makeElement("div", "events-custom-progress-item");
            const heading = makeElement("div", "events-custom-progress-heading");
            const name = makeElement("span", "events-custom-progress-name", objective.title || "Objective");
            const value = makeElement("span", "events-custom-progress-value", `${current}/${target}`);
            heading.append(name, value);
            const controls = makeElement("div", "events-custom-progress-controls");
            const track = makeElement("div", "events-custom-progress-track");
            const fill = makeElement("div", "events-custom-progress-fill");
            fill.style.width = `${percent}%`;
            fill.style.backgroundColor = event.colour || "#7c83ff";
            track.setAttribute("role", "progressbar");
            track.setAttribute("aria-label", objective.title || "Objective progress");
            track.setAttribute("aria-valuemin", "0");
            track.setAttribute("aria-valuemax", String(target));
            track.setAttribute("aria-valuenow", String(current));
            track.append(fill);
            const decreaseButton = makeElement("button", "events-custom-progress-button", "−");
            decreaseButton.type = "button";
            decreaseButton.setAttribute("aria-label", `Decrease ${objective.title || "objective"} progress`);
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
            const increaseButton = makeElement("button", "events-custom-progress-button", "+");
            increaseButton.type = "button";
            increaseButton.setAttribute("aria-label", `Increase ${objective.title || "objective"} progress`);
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
            }
            else if (recurrence.type === "weekly") {
                start.setDate(start.getDate() + (7 * interval));
            }
            else if (recurrence.type === "monthly") {
                const day = start.getDate();
                start.setDate(1);
                start.setMonth(start.getMonth() + interval);
                const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
                start.setDate(Math.min(day, lastDay));
            }
            else {
                return start.getTime();
            }
        }
        return start.getTime();
    }
    function getCompletionOccurrenceStart(event) {
        const recurrence = event.recurrence;
        if (!recurrence ||
            recurrence.type === "none") {
            return new Date(event.start_at).toISOString();
        }
        // On the normal account page, use the occurrence
        // currently shown by the countdown.
        const timestamp = getCustomEventCountdownTarget(event);
        if (!Number.isFinite(timestamp)) {
            return new Date(event.start_at).toISOString();
        }
        return new Date(timestamp).toISOString();
    }
    function renderEvent(event, list) {
        const occurrenceStart = getCompletionOccurrenceStart(event);
        const completed = (event.completions || []).some(completion => completion.completed &&
            new Date(completion.occurrence_start).getTime() ===
                new Date(occurrenceStart).getTime());
        const card = makeElement("article", `events-custom-card${completed ? " is-completed" : ""}`);
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
        icon.src = event.icon_url || "/static/images/ui/ui_icons/Events.webp";
        icon.alt = "";
        icon.loading = "lazy";
        icon.draggable = false;
        icon.addEventListener("error", () => {
            icon.src = "/static/images/ui/ui_icons/Events.webp";
        }, { once: true });
        titleGroup.append(icon);
        const title = makeElement("h3", "events-custom-card-title", event.title);
        titleGroup.append(title);
        topRow.append(titleGroup);
        const date = new Date(event.start_at);
        const dateLabel = new Intl.DateTimeFormat(undefined, {
            day: "numeric",
            month: "short"
        }).format(date);
        topRow.append(makeElement("span", "events-custom-chip", dateLabel), makeElement("span", "events-custom-chip", recurrenceLabel(event.recurrence)), makeElement("span", "events-custom-chip", event.account_scope === "all"
            ? "All accounts"
            : "Specific account"));
        const countdown = makeElement("span", `events-custom-countdown${completed ? " event-completion-pill" : ""}`, completed ? "Completed" : "");
        const startValue = Number(event.start_at);
        const startTimestamp = Number.isFinite(startValue) && startValue > 0
            ? (startValue < 1e12 ? startValue * 1000 : startValue)
            : new Date(event.start_at).getTime();
        if (!completed)
            countdown.dataset.countdownTarget =
                String(getCustomEventCountdownTarget(event));
        topRow.append(countdown);
        content.append(topRow);
        if (event.description) {
            content.append(makeElement("p", "events-custom-card-description", event.description));
        }
        if (event.reminder_minutes != null) {
            let reminderLabel;
            if (event.reminder_minutes === 0) {
                reminderLabel = "Reminder: at start";
            }
            else if (event.reminder_minutes % 60 === 0) {
                const hours = event.reminder_minutes / 60;
                reminderLabel =
                    `Reminder: ${hours} ${hours === 1 ? "hour" : "hours"} before`;
            }
            else {
                reminderLabel =
                    `Reminder: ${event.reminder_minutes} minutes before`;
            }
            topRow.insertBefore(makeElement("span", "events-custom-card-reminder", reminderLabel), countdown);
        }
        renderProgress(event, content);
        const actions = makeElement("div", "events-custom-card-actions");
        actions.append(makeButton(completed ? "Mark Incomplete" : "Mark Complete", "", () => toggleCompletion(event, !completed, occurrenceStart)), makeButton("Edit", "", () => openModal(event)), makeButton("Delete", "events-custom-action-danger", () => removeEvent(event)));
        content.append(actions);
        card.append(accent, content);
        initialiseEventDragAndDrop(card, list);
        list.append(card);
    }
    function renderEmpty(list, message = "No Custom Events Yet", description = "Create an event to keep track of what matters.") {
        const empty = makeElement("div", "events-custom-empty");
        empty.append(makeElement("span", "events-custom-empty-title", message), makeElement("span", "events-custom-empty-description", description));
        list.append(empty);
    }
    function updateCustomEventCountdowns() {
        document.querySelectorAll(".events-custom-countdown[data-countdown-target]").forEach(timer => {
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
            }
            else if (hours > 0) {
                timer.textContent = `${hours}h ${minutes}m left`;
            }
            else {
                timer.textContent = `${minutes}m left`;
            }
            if (remaining < 86400) {
                timer.classList.add("danger");
            }
            else if (remaining < 259200) {
                timer.classList.add("warning");
            }
        });
    }
    function isEventCompleted(event) {
        const occurrence = new Date(getCompletionOccurrenceStart(event)).getTime();
        return (event.completions || []).some(completion => completion.completed &&
            new Date(completion.occurrence_start).getTime() === occurrence);
    }
    function initialiseAnimatedDetails(details, summary, content) {
        if (!details || !summary || !content || details.dataset.animated === "true") {
            return;
        }
        details.dataset.animated = "true";
        summary.addEventListener("click", async (clickEvent) => {
            clickEvent.preventDefault();
            if (details.dataset.animating === "true") {
                return;
            }
            if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                details.open = !details.open;
                return;
            }
            details.dataset.animating = "true";
            const borderHeight = (Number.parseFloat(getComputedStyle(details).borderTopWidth) || 0) +
                (Number.parseFloat(getComputedStyle(details).borderBottomWidth) || 0);
            const collapsedHeight = summary.getBoundingClientRect().height + borderHeight;
            const startingHeight = details.getBoundingClientRect().height;
            const opening = !details.open;
            if (opening) {
                details.open = true;
            }
            const expandedHeight = details.getBoundingClientRect().height;
            const endingHeight = opening ? expandedHeight : collapsedHeight;
            const boxAnimation = details.animate([
                { height: `${startingHeight}px` },
                { height: `${endingHeight}px` }
            ], {
                duration: opening ? 220 : 200,
                easing: opening
                    ? "cubic-bezier(0.22, 1, 0.36, 1)"
                    : "cubic-bezier(0.4, 0, 0.2, 1)",
                fill: "forwards"
            });
            const contentAnimation = content.animate(opening
                ? [
                    { opacity: 0, transform: "translateY(-4px)" },
                    { opacity: 1, transform: "translateY(0)" }
                ]
                : [
                    { opacity: 1, transform: "translateY(0)" },
                    { opacity: 0, transform: "translateY(-4px)" }
                ], {
                duration: opening ? 180 : 150,
                easing: "ease-out",
                fill: "forwards"
            });
            try {
                await Promise.all([
                    boxAnimation.finished,
                    contentAnimation.finished
                ]);
            }
            catch {
                // Cancelled animations safely settle into their target state.
            }
            if (!opening) {
                details.open = false;
            }
            boxAnimation.cancel();
            contentAnimation.cancel();
            delete details.dataset.animating;
        });
    }
    function renderOverviewEvent(event, list, accountId) {
        const completed = isEventCompleted(event);
        const row = makeElement("details", "events-custom-overview-event");
        row.dataset.customEventId = String(event.id);
        row.dataset.accountId = String(accountId);
        row.style.setProperty("--custom-event-colour", event.colour || "#7c83ff");
        const summary = makeElement("summary", "events-custom-overview-summary");
        const icon = document.createElement("img");
        icon.className = "events-custom-overview-icon";
        icon.src = event.icon_url || "/static/images/ui/ui_icons/Events.webp";
        icon.alt = "";
        icon.loading = "lazy";
        icon.draggable = false;
        icon.addEventListener("error", () => {
            icon.src = "/static/images/ui/ui_icons/Events.webp";
        }, { once: true });
        const title = makeElement("span", "events-custom-overview-name", event.title);
        summary.append(icon, title);
        const date = new Date(event.start_at);
        const dateLabel = new Intl.DateTimeFormat(undefined, {
            day: "numeric",
            month: "short"
        }).format(date);
        summary.append(makeElement("span", "events-custom-chip", dateLabel), makeElement("span", "events-custom-chip", recurrenceLabel(event.recurrence)), makeElement("span", "events-custom-chip", event.account_scope === "all" ? "All accounts" : "Specific account"));
        if (event.reminder_minutes != null) {
            const reminderMinutes = Number(event.reminder_minutes);
            let reminderLabel = "Reminder: at start";
            if (reminderMinutes > 0 && reminderMinutes % 60 === 0) {
                const hours = reminderMinutes / 60;
                reminderLabel = `Reminder: ${hours} ${hours === 1 ? "hour" : "hours"} before`;
            }
            else if (reminderMinutes > 0) {
                reminderLabel = `Reminder: ${reminderMinutes} minutes before`;
            }
            summary.append(makeElement("span", "events-custom-card-reminder", reminderLabel));
        }
        const objectives = event.progress || [];
        const summaryStatus = makeElement("span", "events-custom-overview-summary-status");
        let objectiveSummary = null;
        if (objectives.length) {
            const finished = objectives.filter(item => Number(item.current) >= Number(item.target)).length;
            objectiveSummary = makeElement("span", `events-custom-overview-progress${finished === objectives.length ? " event-completion-pill" : ""}`, `${finished}/${objectives.length} objectives`);
            summaryStatus.append(objectiveSummary);
        }
        const status = makeElement("span", `events-custom-countdown${completed ? " event-completion-pill" : ""}`, completed ? "Completed" : "");
        if (completed) {
            row.classList.add("is-completed");
        }
        else {
            status.dataset.countdownTarget = String(getCustomEventCountdownTarget(event));
        }
        const toggleIcon = makeElement("span", "events-custom-overview-toggle");
        toggleIcon.setAttribute("aria-hidden", "true");
        summaryStatus.append(status, toggleIcon);
        summary.append(summaryStatus);
        const body = makeElement("div", "events-custom-overview-details");
        if (event.description) {
            body.append(makeElement("p", "events-custom-card-description", event.description));
        }
        const actions = makeElement("div", "events-custom-card-actions events-custom-overview-actions");
        actions.append(makeButton(completed ? "Mark Incomplete" : "Mark Complete", "", () => toggleCompletion(event, !completed, getCompletionOccurrenceStart(event), accountId)), makeButton("Edit", "", () => openModal(event)), makeButton("Delete", "events-custom-action-danger", () => removeEvent(event)));
        const manage = makeElement("a", "events-custom-overview-manage events-custom-action", "Manage in account");
        manage.href = `/events?account_id=${encodeURIComponent(accountId)}&tab=custom`;
        actions.append(manage);
        objectives.forEach((objective, index) => {
            const target = Math.max(1, Number(objective.target) || 1);
            const current = Math.min(target, Math.max(0, Number(objective.current) || 0));
            const item = makeElement("div", "events-custom-overview-objective events-custom-progress-item");
            const label = objective.title || "Objective";
            const value = makeElement("span", "events-custom-overview-objective-value events-custom-progress-value", `${current}/${target}`);
            item.append(makeElement("span", "events-custom-overview-objective-name events-custom-progress-name", label), value);
            const progress = makeElement("div", "events-custom-overview-objective-track events-custom-progress-track");
            const fill = makeElement("div", "events-custom-overview-objective-fill events-custom-progress-fill");
            fill.style.width = `${(current / target) * 100}%`;
            progress.append(fill);
            progress.setAttribute("role", "progressbar");
            progress.setAttribute("aria-label", label);
            progress.setAttribute("aria-valuemin", "0");
            progress.setAttribute("aria-valuemax", String(target));
            progress.setAttribute("aria-valuenow", String(current));
            const controls = makeElement("div", "events-custom-overview-objective-controls");
            const decrease = makeElement("button", "events-custom-overview-objective-button events-custom-progress-button", "−");
            const increase = makeElement("button", "events-custom-overview-objective-button events-custom-progress-button", "+");
            decrease.type = increase.type = "button";
            decrease.setAttribute("aria-label", `Decrease ${label} progress for this account`);
            increase.setAttribute("aria-label", `Increase ${label} progress for this account`);
            decrease.disabled = current <= 0;
            increase.disabled = current >= target;
            async function changeProgress(amount) {
                const previous = Number(objective.current) || 0;
                const next = Math.max(0, Math.min(target, previous + amount));
                if (next === previous)
                    return;
                function update(currentValue) {
                    objective.current = currentValue;
                    value.textContent = `${currentValue}/${target}`;
                    fill.style.width = `${(currentValue / target) * 100}%`;
                    progress.setAttribute("aria-valuenow", String(currentValue));
                    const finished = objectives.filter(entry => Number(entry.current) >= Number(entry.target)).length;
                    objectiveSummary.textContent = `${finished}/${objectives.length} objectives`;
                    objectiveSummary.classList.toggle("event-completion-pill", finished === objectives.length);
                    item.classList.toggle("is-finished", currentValue >= target);
                    decrease.disabled = currentValue <= 0;
                    increase.disabled = currentValue >= target;
                }
                update(next);
                decrease.disabled = increase.disabled = true;
                try {
                    const result = await apiRequest(`/api/custom-events/${encodeURIComponent(event.id)}/progress`, {
                        method: "POST",
                        body: JSON.stringify({
                            account_id: Number(accountId),
                            objective_index: index,
                            amount,
                        }),
                    });
                    if (!Number.isFinite(Number(result.current))) {
                        throw new Error("The server returned invalid progress. Please try again.");
                    }
                    update(Math.max(0, Math.min(target, Number(result.current))));
                }
                catch (error) {
                    update(previous);
                    window.alert(error.message || "Unable to update objective progress.");
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
        list.append(row);
    }
    function renderEvents() {
        const lists = $$("[data-custom-event-list]");
        const isOverview = page.dataset.overview === "true";
        lists.forEach(list => {
            list.replaceChildren();
            const accountId = list.dataset.accountId || page.dataset.accountId;
            const listEvents = isOverview
                ? eventsByAccount.get(String(accountId)) || []
                : events;
            if (isOverview) {
                const completedCount = listEvents.filter(isEventCompleted).length;
                const count = list.closest("[data-custom-account-group]")
                    ?.querySelector("[data-custom-account-count]");
                if (count) {
                    count.textContent = listEvents.length
                        ? `${completedCount}/${listEvents.length} complete`
                        : "No events";
                }
                listEvents.slice().sort((a, b) => Number(isEventCompleted(a)) - Number(isEventCompleted(b))).forEach(event => renderOverviewEvent(event, list, accountId));
                if (!listEvents.length) {
                    list.append(makeElement("p", "events-custom-overview-empty", "No custom events for this account yet."));
                }
                updateCustomEventCountdowns();
                return;
            }
            if (!listEvents.length) {
                renderEmpty(list);
                return;
            }
            listEvents.forEach(event => {
                renderEvent(event, list);
            });
        });
        updateCustomEventCountdowns();
    }
    async function loadEvents() {
        if (loading)
            return;
        loading = true;
        try {
            const isOverview = page.dataset.overview === "true";
            if (isOverview) {
                const lists = $$("[data-custom-event-list]")
                    .filter(list => list.dataset.accountId);
                const accountResults = await Promise.all(lists.map(async (list) => {
                    const accountId = list.dataset.accountId;
                    const params = new URLSearchParams({
                        account_id: accountId,
                    });
                    const data = await apiRequest(`/api/custom-events?${params.toString()}`, {}, window.CyreneSchemas
                        .customEventsListResponseSchema);
                    return [
                        String(accountId),
                        data.events || [],
                    ];
                }));
                eventsByAccount = new Map(accountResults);
            }
            else {
                const params = new URLSearchParams();
                const accountId = page.dataset.accountId;
                if (accountId) {
                    params.set("account_id", accountId);
                }
                const suffix = params.toString()
                    ? `?${params.toString()}`
                    : "";
                const data = await apiRequest(`/api/custom-events${suffix}`, {}, window.CyreneSchemas.customEventsListResponseSchema);
                events = data.events || [];
            }
            renderEvents();
        }
        catch (error) {
            console.error("Failed to load Custom Events:", error);
            $$("[data-custom-account-count]").forEach(count => {
                count.textContent = "Unavailable";
            });
            $$("[data-custom-event-list]").forEach(list => {
                list.replaceChildren();
                renderEmpty(list, "Couldn't Load Custom Events", error.message ||
                    "Please refresh the page and try again.");
            });
        }
        finally {
            loading = false;
        }
    }
    // =========================================
    // CREATE / EDIT
    // =========================================
    $$("[data-custom-create]").forEach(button => {
        button.addEventListener("click", () => openModal());
    });
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearError();
        if (saveButton) {
            saveButton.disabled = true;
        }
        try {
            // 1. Upload a newly selected image first.
            const selectedFile = iconInput?.files?.[0];
            if (selectedFile) {
                const formData = new FormData();
                formData.append("file", selectedFile);
                const uploadResult = await apiRequest("/api/custom-events/icon", {
                    method: "POST",
                    body: formData,
                });
                if (!uploadResult?.icon_url) {
                    throw new Error("The image was uploaded, but no image URL was returned.");
                }
                currentIconUrl = uploadResult.icon_url;
            }
            // 2. Build the event data, including its image URL.
            const rawPayload = buildPayload();
            rawPayload.icon_url = currentIconUrl;
            // 3. Validate the complete payload.
            const validation = window.CyreneSchemas.customEventSchema.safeParse(rawPayload);
            if (!validation.success) {
                const firstIssue = validation.error.issues[0];
                throw new Error(firstIssue
                    ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
                    : "Please check the event details.");
            }
            // 4. Create or update the event using the existing JSON API.
            const payload = validation.data;
            const eventId = form.elements.event_id.value;
            await apiRequest(eventId
                ? `/api/custom-events/${encodeURIComponent(eventId)}`
                : "/api/custom-events", {
                method: eventId ? "PUT" : "POST",
                body: JSON.stringify(payload),
            }, window.CyreneSchemas.customEventResponseSchema);
            closeModal();
            await loadEvents();
            if (window.refreshEvents) {
                // Keep any existing refresh logic here, if you have it.
            }
        }
        catch (error) {
            showError(error.message || "Unable to save this event.");
        }
        finally {
            if (saveButton) {
                saveButton.disabled = false;
            }
        }
    });
    // =========================================
    // DELETE
    // =========================================
    async function removeEvent(event) {
        const confirmed = window.confirm(`Delete "${event.title}"? This cannot be undone.`);
        if (!confirmed)
            return;
        try {
            await apiRequest(`/api/custom-events/${encodeURIComponent(event.id)}`, { method: "DELETE" }, window.CyreneSchemas.deleteCustomEventResponseSchema);
            await loadEvents();
        }
        catch (error) {
            window.alert(error.message || "Unable to delete this event.");
        }
    }
    // =========================================
    // MANUAL COMPLETION
    // =========================================
    async function toggleCompletion(event, completed, occurrenceStart, accountId = null) {
        if (event.completionSaving)
            return;
        event.completionSaving = true;
        const previousCompletions = event.completions;
        const openCards = new Set($$(".events-custom-overview-event[open]").map(row => `${row.dataset.accountId}:${row.dataset.customEventId}`));
        const renderCompletion = () => {
            renderEvents();
            $$(".events-custom-overview-event").forEach(row => {
                row.open = openCards.has(`${row.dataset.accountId}:${row.dataset.customEventId}`);
            });
        };
        const occurrence = new Date(occurrenceStart).getTime();
        event.completions = (previousCompletions || []).filter(entry => new Date(entry.occurrence_start).getTime() !== occurrence);
        event.completions.push({ completed, occurrence_start: occurrenceStart });
        renderCompletion();
        const payload = {
            completed,
            occurrence_start: occurrenceStart,
        };
        const completionAccountId = accountId || page.dataset.accountId;
        if (completionAccountId) {
            payload.account_id = Number(completionAccountId);
        }
        try {
            await apiRequest(`/api/custom-events/${encodeURIComponent(event.id)}/completion`, {
                method: "POST",
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15000),
            }, window.CyreneSchemas.customEventCompletionResponseSchema);
        }
        catch (error) {
            event.completions = previousCompletions;
            renderCompletion();
            window.alert(error.message || "Unable to update event completion.");
        }
        finally {
            event.completionSaving = false;
        }
    }
    // =========================================
    // INITIALISE
    // =========================================
    initialiseAccountDropdown();
    initialiseFormDropdowns();
    initialiseDateTimePickers();
    updateFormDropdown("recurrence_type", form.elements.recurrence_type.value || "none");
    updateFormDropdown("reminder_minutes", form.elements.reminder_minutes.value || "");
    updateConditionalFields();
    $$("[data-custom-account-group]").forEach(group => {
        initialiseAnimatedDetails(group, group.querySelector(".events-custom-account-heading"), group.querySelector("[data-custom-event-list]"));
    });
    loadEvents();
    updateCustomEventCountdowns();
    setInterval(updateCustomEventCountdowns, 60_000);
}
window.initCustomEvents = initCustomEvents;
