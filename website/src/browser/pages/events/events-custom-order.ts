// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Drag-to-reorder for custom event cards.
window.CyreneCustomEventOrder = (ctx) => {
    const { state, page, eventsByAccount, $$, apiRequest } = ctx;
    const renderEvents = (...args) => ctx.renderEvents(...args);

    function getOrderedEventIds(list) {
        return Array.from(list.querySelectorAll(":scope > [data-custom-event-id]")).map(
            (card) => card.dataset.customEventId,
        );
    }

    function handleEventDragStart(event, card) {
        if (state.savingOrder) {
            event.preventDefault();
            return;
        }

        state.draggingEventId = card.dataset.customEventId;

        const bounds = card.getBoundingClientRect();
        event.dataTransfer.setDragImage(
            card,
            event.clientX - bounds.left,
            event.clientY - bounds.top,
        );
        card.classList.add("is-dragging");

        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", state.draggingEventId);
    }

    function handleEventDragOver(event, list, card) {
        if (!state.draggingEventId || state.savingOrder) {
            return;
        }

        const draggingCard = list.querySelector(
            `[data-custom-event-id="${CSS.escape(state.draggingEventId)}"]`,
        );

        if (!draggingCard) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        if (draggingCard === card) return;

        const bounds = card.getBoundingClientRect();
        const insertAfter = event.clientY > bounds.top + bounds.height / 2;

        if (insertAfter) {
            card.after(draggingCard);
        } else {
            card.before(draggingCard);
        }
    }

    function handleEventDragEnd() {
        $$("[data-custom-event-id]").forEach((card) => {
            card.classList.remove("is-dragging");
        });

        state.draggingEventId = null;
    }

    async function saveEventOrder(list, previousEvents) {
        const accountId = list.dataset.accountId || page.dataset.accountId;

        if (!accountId) {
            renderEvents();
            return;
        }

        const orderedIds = getOrderedEventIds(list);
        const previousIds = previousEvents.map((event) => String(event.id));

        if (
            orderedIds.length !== previousIds.length ||
            orderedIds.every((id, index) => id === previousIds[index])
        ) {
            renderEvents();
            return;
        }

        const eventsById = new Map(previousEvents.map((event) => [String(event.id), event]));
        const reorderedEvents = orderedIds.map((id) => eventsById.get(id));

        if (
            reorderedEvents.some((event) => !event) ||
            reorderedEvents.length !== previousEvents.length
        ) {
            renderEvents();
            return;
        }

        const isOverview = page.dataset.overview === "true";

        if (isOverview) {
            eventsByAccount.set(String(accountId), reorderedEvents);
        } else {
            state.events = reorderedEvents;
        }

        renderEvents();

        state.savingOrder = true;

        $$("[data-custom-event-drag-handle]").forEach((handle) => {
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
            window.showCyreneToast?.("Event order saved.");
        } catch (error) {
            if (isOverview) {
                eventsByAccount.set(String(accountId), previousEvents);
            } else {
                state.events = previousEvents;
            }

            renderEvents();

            window.showCyreneToast?.(
                error.message || "Could not save the event order. Please try again.",
                "error",
            );
        } finally {
            state.savingOrder = false;

            $$("[data-custom-event-drag-handle]").forEach((handle) => {
                handle.disabled = false;
            });
        }
    }

    function initialiseEventDragAndDrop(card, list) {
        card.draggable = false;

        const dragHandle = card.querySelector("[data-custom-event-drag-handle]");

        if (dragHandle) {
            dragHandle.draggable = true;

            dragHandle.addEventListener("dragstart", (event) => {
                event.stopPropagation();
                handleEventDragStart(event, card);
            });

            dragHandle.addEventListener("dragend", (event) => {
                event.stopPropagation();
                handleEventDragEnd();
            });
        }

        card.addEventListener("dragover", (event) => {
            handleEventDragOver(event, list, card);
        });

        card.addEventListener("drop", async (event) => {
            if (
                !state.draggingEventId ||
                state.savingOrder ||
                !list.querySelector(`[data-custom-event-id="${CSS.escape(state.draggingEventId)}"]`)
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const accountId = list.dataset.accountId || page.dataset.accountId;
            const previousEvents =
                page.dataset.overview === "true"
                    ? [...(eventsByAccount.get(String(accountId)) || [])]
                    : [...state.events];

            handleEventDragEnd();

            await saveEventOrder(list, previousEvents);
        });
    }

    return {
        initialiseEventDragAndDrop,
    };
};
