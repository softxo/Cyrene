// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Custom event form: opening, objectives, validation and saving.
window.CyreneCustomEventForm = (ctx) => {
    const {
        state,
        toLocalInputValue,
        enhanceNumberInput,
        fromLocalInputValue,
        page,
        modal,
        form,
        titleElement,
        saveButton,
        iconInput,
        clearPreviewObjectUrl,
        renderCustomIconPreview,
        $,
        $$,
        apiRequest,
        showError,
        clearError,
        dateTimePickers,
        loadEvents,
    } = ctx;
    const updateAccountDropdown = (...args) => ctx.updateAccountDropdown(...args);
    const updateFormDropdown = (...args) => ctx.updateFormDropdown(...args);

    function openModal(event = null, accountId = null) {
        state.editingAccountId = accountId || event?.account_id || page.dataset.accountId || null;
        clearPreviewObjectUrl();

        form.reset();
        clearError();

        state.currentIconUrl = event?.icon_url ?? null;
        state.originalSharedFields = event
            ? {
                  title: event.title.trim(),
                  description: event.description?.trim() || null,
                  icon_url: state.currentIconUrl,
              }
            : null;

        if (iconInput) {
            iconInput.value = "";
        }

        renderCustomIconPreview(state.currentIconUrl);

        form.elements.event_id.value = event?.id ?? "";
        form.elements.title.value = event?.title ?? "";
        form.elements.description.value = event?.description ?? "";

        form.elements.account_scope.value = "account";
        const scopeDescription = form.querySelector("[data-custom-scope-description]");
        if (scopeDescription)
            scopeDescription.textContent = event
                ? "applies only the name, picture and description changed in this edit to existing copies. Other settings stay with each account."
                : "creates a separate event for each linked account. Edits, progress and deletion stay with that account.";
        $$('input[name="account_scope"]', form).forEach((input) => {
            input.disabled = false;
        });

        const accountDropdown = $("[data-custom-account-select]", form);
        const accountButton = accountDropdown?.querySelector(".custom-select-button");
        if (accountButton) accountButton.disabled = !!event;

        const defaultAccountId =
            page.dataset.accountId ||
            accountDropdown?.querySelector("[data-account-id]")?.dataset.accountId ||
            "";

        updateAccountDropdown(
            event ? String(state.editingAccountId || defaultAccountId) : defaultAccountId,
        );

        form.elements.start_at.value = toLocalInputValue(event?.start_at);

        form.elements.end_at.value = toLocalInputValue(event?.end_at);

        $$('input[type="datetime-local"]', form).forEach((input) => {
            input.customDateTimePicker?.refresh();
        });

        updateFormDropdown("recurrence_type", event?.recurrence?.type ?? "none");

        form.elements.recurrence_interval.value = event?.recurrence?.interval ?? 1;

        form.elements.colour.value = event?.colour ?? "#7c83ff";

        updateFormDropdown(
            "reminder_minutes",
            event?.reminder_minutes == null ? "" : String(event.reminder_minutes),
        );

        const weekdays = event?.recurrence?.weekdays ?? [];

        $$('input[name="recurrence_weekdays"]', form).forEach((input) => {
            input.checked = weekdays.includes(Number(input.value));
        });

        const objectives = $("[data-custom-objectives]", form);
        objectives.replaceChildren();

        for (const objective of event?.progress ?? []) {
            addObjective(objective);
        }

        updateConditionalFields();

        if (titleElement) {
            titleElement.textContent = event ? "Edit Event" : "Create Event";
        }

        if (saveButton) {
            saveButton.textContent = event ? "Save Changes" : "Save Event";
        }

        modal.hidden = false;
        document.body.style.overflow = "hidden";

        form.elements.title.focus();
    }

    function closeModal() {
        clearPreviewObjectUrl();
        dateTimePickers.active?.close();
        $$(".custom-select.open", form).forEach((dropdown) => {
            dropdown.classList.remove("open");
            dropdown.querySelector("[aria-expanded]")?.setAttribute("aria-expanded", "false");
        });

        modal.hidden = true;
        document.body.style.overflow = "";
        clearError();
    }

    modal.addEventListener("click", (event) => {
        if (event.target.closest("[data-custom-close]")) {
            closeModal();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.hidden) {
            if (dateTimePickers.active) {
                dateTimePickers.active.close();
                return;
            }
            closeModal();
        }
    });

    function updateConditionalFields() {
        const scope = form.elements.account_scope.value;
        const recurrenceType = form.elements.recurrence_type.value;
        const accountField = $("[data-custom-account-field]", form);
        const weekdaysField = $("[data-custom-weekdays-field]", form);
        const intervalField = form.elements.recurrence_interval;
        const intervalContainer = $("[data-custom-interval-field]", form);

        if (accountField) {
            accountField.hidden = scope !== "account";
        }

        if (weekdaysField) {
            weekdaysField.hidden = recurrenceType !== "weekly";
        }

        if (intervalField) {
            intervalField.disabled = recurrenceType === "none";
        }

        if (intervalContainer) {
            intervalContainer.hidden = recurrenceType === "none";
        }
    }

    form.addEventListener("change", (event) => {
        if (event.target.name === "account_scope" || event.target.name === "recurrence_type") {
            updateConditionalFields();
        }
    });

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
        currentInput.setAttribute(
            "aria-description",
            "Progress is tracked separately for each account.",
        );
        currentInput.setAttribute("aria-label", "Current progress");
        currentInput.dataset.objectiveCurrent = "";

        const targetInput = document.createElement("input");
        targetInput.type = "number";
        targetInput.min = "1";
        targetInput.value = objective.target ?? 1;
        targetInput.setAttribute("aria-label", "Progress target");
        targetInput.dataset.objectiveTarget = "";
        function constrainCurrent() {
            currentInput.max = String(Math.max(1, Number(targetInput.value) || 1));
            if (Number(currentInput.value) > Number(currentInput.max))
                currentInput.value = currentInput.max;
        }
        targetInput.addEventListener("input", constrainCurrent);
        constrainCurrent();

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "cyrene-button events-custom-objective-remove";
        const closeIcon = document.createElement("span");
        closeIcon.className = "cyrene-close";
        closeIcon.setAttribute("aria-hidden", "true");
        removeButton.replaceChildren(closeIcon);
        removeButton.setAttribute("aria-label", "Remove objective");

        removeButton.addEventListener("click", () => row.remove());

        row.append(titleInput, currentInput, targetInput, removeButton);

        container.append(row);

        row.querySelectorAll('input[type="number"]').forEach(enhanceNumberInput);
    }

    form.querySelectorAll('input[type="number"]').forEach(enhanceNumberInput);

    $("[data-custom-add-objective]", modal)?.addEventListener("click", () => addObjective());

    function readObjectives() {
        return $$(".events-custom-objective", form).map((row) => ({
            title: $("[data-objective-title]", row).value.trim(),
            current: Number($("[data-objective-current]", row).value),
            target: Number($("[data-objective-target]", row).value),
        }));
    }

    function buildPayload() {
        const accountScope = form.elements.account_scope.value;
        const recurrenceType = form.elements.recurrence_type.value;
        const recurrence = {
            type: recurrenceType,
            interval:
                recurrenceType === "none" ? 1 : Number(form.elements.recurrence_interval.value),
        };

        if (recurrenceType === "weekly") {
            recurrence.weekdays = $$('input[name="recurrence_weekdays"]:checked', form).map(
                (input) => Number(input.value),
            );

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

            if (
                !Number.isInteger(objective.current) ||
                !Number.isInteger(objective.target) ||
                objective.current < 0 ||
                objective.target < 1
            ) {
                throw new Error(
                    "Progress values must be whole numbers. Current must be at least 0 and target at least 1.",
                );
            }
        }

        return {
            title: form.elements.title.value.trim(),
            description: form.elements.description.value.trim() || null,

            account_scope: accountScope,
            account_id: accountScope === "account" ? Number(form.elements.account_id.value) : null,

            start_at: startAt,
            end_at: endAt,

            recurrence,
            colour: form.elements.colour.value,

            reminder_minutes:
                form.elements.reminder_minutes.value === ""
                    ? null
                    : Number(form.elements.reminder_minutes.value),

            progress,
        };
    }

    $$("[data-custom-create]").forEach((button) => {
        button.addEventListener("click", () => openModal());
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearError();

        if (saveButton) {
            saveButton.disabled = true;
        }

        try {
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

                state.currentIconUrl = uploadResult.icon_url;
            }

            const rawPayload = buildPayload();
            rawPayload.icon_url = state.currentIconUrl;

            const validation = window.CyreneSchemas.customEventSchema.safeParse(rawPayload);

            if (!validation.success) {
                const firstIssue = validation.error.issues[0];

                throw new Error(
                    firstIssue
                        ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
                        : "Please check the event details.",
                );
            }

            const payload = validation.data;
            const eventId = form.elements.event_id.value;
            if (eventId && state.originalSharedFields) {
                payload.shared_fields = Object.keys(state.originalSharedFields).filter(
                    (field) =>
                        (payload[field] || null) !== (state.originalSharedFields[field] || null),
                );
            }

            await apiRequest(
                eventId
                    ? `/api/custom-events/${encodeURIComponent(eventId)}`
                    : "/api/custom-events",
                {
                    method: eventId ? "PUT" : "POST",
                    body: JSON.stringify(payload),
                },
                window.CyreneSchemas.customEventResponseSchema,
            );

            closeModal();
            window.showCyreneToast?.(eventId ? "Event updated." : "Event created.");
            await loadEvents();
        } catch (error) {
            showError(error.message || "Unable to save this event.");
            window.showCyreneToast?.(error.message || "Unable to save this event.", "error");
        } finally {
            if (saveButton) {
                saveButton.disabled = false;
            }
        }
    });

    return {
        openModal,
        updateConditionalFields,
    };
};
