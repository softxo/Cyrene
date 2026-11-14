// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
function initCustomEvents() {
    const {
        toLocalInputValue,
        fromLocalInputValue,
        recurrenceLabel,
        makeElement,
        makeButton,
        enhanceNumberInput,
        initialiseAnimatedDetails,
        createDateTimePickers,
    } = window.CyreneCustomEventControls;
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

    const state = {
        currentIconUrl: null,
        originalSharedFields: null,
        previewObjectUrl: null,
        editingAccountId: null,
        events: [],
        loading: false,
        draggingEventId: null,
        savingOrder: false,
    };
    const iconInput = form.querySelector("[data-custom-icon-file]");
    const iconImage = form.querySelector("[data-custom-icon-image]");
    const iconFilename = form.querySelector("[data-custom-icon-filename]");
    const removeIconButton = form.querySelector("[data-custom-icon-remove]");

    function clearPreviewObjectUrl() {
        if (state.previewObjectUrl) {
            URL.revokeObjectURL(state.previewObjectUrl);
            state.previewObjectUrl = null;
        }
    }

    form.querySelector("[data-custom-icon-choose]")?.addEventListener("click", () =>
        iconInput?.click(),
    );

    function getCustomIconUrl(value) {
        return typeof value === "string" &&
            /^\/static\/uploads\/custom-events\/[a-f0-9-]{36}\.(?:png|jpg|webp)$/.test(value)
            ? value
            : null;
    }

    function renderCustomIconPreview(value = null, filename = "") {
        if (!iconImage) return;

        const src =
            state.previewObjectUrl && value === state.previewObjectUrl
                ? state.previewObjectUrl
                : getCustomIconUrl(value);

        if (src) {
            iconImage.src = src;
            iconImage.hidden = false;
        } else {
            iconImage.removeAttribute("src");
            iconImage.hidden = true;
        }

        if (iconFilename) {
            iconFilename.textContent = filename || (src ? "Saved event icon" : "No image selected");
            iconFilename.title = filename;
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

        const allowedTypes = ["image/png", "image/jpeg", "image/webp"];

        if (!allowedTypes.includes(file.type)) {
            iconInput.value = "";
            clearPreviewObjectUrl();
            renderCustomIconPreview(state.currentIconUrl);
            showError("Choose a PNG, JPEG or WebP image.");
            return;
        }

        if (file.size > 2 * 1024 * 1024) {
            iconInput.value = "";
            clearPreviewObjectUrl();
            renderCustomIconPreview(state.currentIconUrl);
            showError("Event icons cannot exceed 2 MB.");
            return;
        }

        clearError();
        clearPreviewObjectUrl();

        state.previewObjectUrl = URL.createObjectURL(file);

        renderCustomIconPreview(state.previewObjectUrl, file.name);
    });

    removeIconButton?.addEventListener("click", () => {
        clearPreviewObjectUrl();

        state.currentIconUrl = null;

        if (iconInput) {
            iconInput.value = "";
        }

        renderCustomIconPreview();
    });

    const accountLoadErrors = new Map();
    const eventsByAccount = new Map();
    const $ = (selector, parent = page) => parent.querySelector(selector);
    const $$ = (selector, parent = page) => Array.from(parent.querySelectorAll(selector));

    async function apiRequest(url, options = {}, schema = null) {
        const isFormData = options.body instanceof FormData;
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: {
                ...(options.body && !isFormData ? { "Content-Type": "application/json" } : {}),
                ...(options.headers || {}),
            },
        });
        const text = await response.text();
        let data;

        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            throw new Error(`The server returned an invalid response (${response.status}).`);
        }

        if (!response.ok || data.success === false) {
            throw new Error(data.detail || data.error || `Request failed (${response.status}).`);
        }

        if (schema) {
            const result = schema.safeParse(data);

            if (!result.success) {
                console.error(
                    "Custom Events API validation failed:\n",
                    JSON.stringify(result.error.issues, null, 2),
                );

                throw new Error(
                    "The server returned unexpected Custom Events data. Please refresh the page.",
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

    const dateTimePickers = createDateTimePickers(form);
    const ctx = {
        state,
        toLocalInputValue,
        enhanceNumberInput,
        fromLocalInputValue,
        makeElement,
        recurrenceLabel,
        makeButton,
        initialiseAnimatedDetails,
        page,
        modal,
        form,
        titleElement,
        saveButton,
        iconInput,
        clearPreviewObjectUrl,
        getCustomIconUrl,
        renderCustomIconPreview,
        accountLoadErrors,
        eventsByAccount,
        $,
        $$,
        apiRequest,
        showError,
        clearError,
        dateTimePickers,
        loadEvents,
        removeEvent,
        toggleCompletion,
    };

    Object.assign(ctx, window.CyreneCustomEventDropdowns(ctx));

    Object.assign(ctx, window.CyreneCustomEventForm(ctx));

    Object.assign(ctx, window.CyreneCustomEventOrder(ctx));

    Object.assign(ctx, window.CyreneCustomEventProgress(ctx));

    Object.assign(ctx, window.CyreneCustomEventCards(ctx));

    Object.assign(ctx, window.CyreneCustomEventOverview(ctx));

    function initialiseAccountDropdown(...args) {
        return ctx.initialiseAccountDropdown(...args);
    }

    function initialiseFormDropdowns(...args) {
        return ctx.initialiseFormDropdowns(...args);
    }

    function renderEmpty(...args) {
        return ctx.renderEmpty(...args);
    }

    function renderEvents(...args) {
        return ctx.renderEvents(...args);
    }

    function updateConditionalFields(...args) {
        return ctx.updateConditionalFields(...args);
    }

    function updateCustomEventCountdowns(...args) {
        return ctx.updateCustomEventCountdowns(...args);
    }

    function updateFormDropdown(...args) {
        return ctx.updateFormDropdown(...args);
    }

    async function loadEvents() {
        if (state.loading) return;

        state.loading = true;

        try {
            const isOverview = page.dataset.overview === "true";

            if (isOverview) {
                const lists = $$("[data-custom-event-list]").filter(
                    (list) => list.dataset.accountId,
                );
                const accountResults = await Promise.allSettled(
                    lists.map(async (list) => {
                        const accountId = list.dataset.accountId;
                        const params = new URLSearchParams({
                            account_id: accountId,
                        });
                        const data = await apiRequest(
                            `/api/custom-events?${params.toString()}`,
                            {},
                            window.CyreneSchemas.customEventsListResponseSchema,
                        );

                        return [String(accountId), data.events || []];
                    }),
                );

                accountLoadErrors.clear();
                accountResults.forEach((result, index) => {
                    const accountId = String(lists[index].dataset.accountId);
                    if (result.status === "fulfilled") {
                        eventsByAccount.set(...result.value);
                    } else {
                        accountLoadErrors.set(
                            accountId,
                            result.reason?.message || "Unable to load this account's events.",
                        );
                        console.error(
                            "Failed to load Custom Events for account",
                            accountId,
                            result.reason,
                        );
                    }
                });
            } else {
                const params = new URLSearchParams();
                const accountId = page.dataset.accountId;

                if (accountId) {
                    params.set("account_id", accountId);
                }

                const suffix = params.toString() ? `?${params.toString()}` : "";
                const data = await apiRequest(
                    `/api/custom-events${suffix}`,
                    {},
                    window.CyreneSchemas.customEventsListResponseSchema,
                );

                state.events = data.events || [];
            }

            renderEvents();
        } catch (error) {
            console.error("Failed to load Custom Events:", error);

            $$("[data-custom-account-count]").forEach((count) => {
                count.textContent = "Unavailable";
                count.classList.remove("event-completion-pill");
            });

            $$("[data-custom-event-list]").forEach((list) => {
                list.replaceChildren();

                renderEmpty(
                    list,
                    "Couldn't Load Custom Events",
                    error.message || "Please refresh the page and try again.",
                );
            });
        } finally {
            state.loading = false;
        }
    }

    async function removeEvent(event, accountId = null) {
        const confirmation = page.querySelector(".events-custom-delete-dialog");
        if (!confirmation || confirmation.open) return;
        confirmation.querySelector("[data-delete-description]").textContent =
            `Delete "${event.title}" from this account? Your other accounts keep their events. This cannot be undone.`;
        confirmation.returnValue = "cancel";
        const confirmed = await new Promise((resolve) => {
            confirmation.addEventListener(
                "close",
                () => resolve(confirmation.returnValue === "delete"),
                { once: true },
            );
            confirmation.querySelector("[data-delete-confirm]").onclick = () =>
                confirmation.close("delete");
            confirmation.querySelector("[data-delete-cancel]").onclick = () =>
                confirmation.close("cancel");
            confirmation.showModal();
        });

        if (!confirmed) return;

        try {
            await apiRequest(
                `/api/custom-events/${encodeURIComponent(event.id)}?account_id=${encodeURIComponent(accountId || event.account_id || page.dataset.accountId)}`,
                { method: "DELETE" },
                window.CyreneSchemas.deleteCustomEventResponseSchema,
            );
            window.showCyreneToast?.("Event deleted.");
            await loadEvents();
        } catch (error) {
            window.showCyreneToast?.(error.message || "Unable to delete this event.", "error");
        }
    }

    async function toggleCompletion(event, completed, occurrenceStart, accountId = null) {
        if (event.completionSaving) return;
        event.completionSaving = true;
        const previousCompletions = event.completions;
        const openCards = new Set(
            $$(".events-custom-overview-event[open]").map(
                (row) => `${row.dataset.accountId}:${row.dataset.customEventId}`,
            ),
        );
        const renderCompletion = () => {
            renderEvents();
            $$(".events-custom-overview-event").forEach((row) => {
                row.open = openCards.has(`${row.dataset.accountId}:${row.dataset.customEventId}`);
            });
        };
        const occurrence = new Date(occurrenceStart).getTime();
        event.completions = (previousCompletions || []).filter(
            (entry) => new Date(entry.occurrence_start).getTime() !== occurrence,
        );
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
            await apiRequest(
                `/api/custom-events/${encodeURIComponent(event.id)}/completion`,
                {
                    method: "POST",
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(15000),
                },
                window.CyreneSchemas.customEventCompletionResponseSchema,
            );
            window.showCyreneToast?.(
                `${event.title}: marked ${completed ? "complete" : "incomplete"}.`,
            );
        } catch (error) {
            event.completions = previousCompletions;
            renderCompletion();
            window.showCyreneToast?.(
                error.message || "Unable to update event completion.",
                "error",
            );
        } finally {
            event.completionSaving = false;
        }
    }

    initialiseAccountDropdown();

    initialiseFormDropdowns();

    dateTimePickers.initialise();

    updateFormDropdown("recurrence_type", form.elements.recurrence_type.value || "none");

    updateFormDropdown("reminder_minutes", form.elements.reminder_minutes.value || "");

    updateConditionalFields();

    $$("[data-custom-account-group]").forEach((group) => {
        initialiseAnimatedDetails(
            group,
            group.querySelector(".events-custom-account-heading"),
            group.querySelector("[data-custom-event-list]"),
        );
    });

    loadEvents();

    updateCustomEventCountdowns();

    setInterval(updateCustomEventCountdowns, 60_000);
}

window.initCustomEvents = initCustomEvents;
