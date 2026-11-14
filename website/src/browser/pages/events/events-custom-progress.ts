// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Objective progress bars and their increment controls.
window.CyreneCustomEventProgress = (ctx) => {
    const { makeElement, page, apiRequest } = ctx;

    async function changeObjectiveProgress(event, objectiveIndex, amount, ui) {
        const objective = event.progress?.[objectiveIndex];
        if (!objective) return;

        const isOverview = page.dataset.overview === "true";
        const accountId = page.dataset.accountId;

        if (!isOverview && !accountId) {
            window.showCyreneToast?.(
                "The selected account could not be identified. Please refresh the page.",
                "error",
            );
            return;
        }

        const target = Math.max(1, Number(objective.target) || 1);
        const previous = Math.max(0, Math.min(target, Number(objective.current) || 0));
        const next = Math.max(0, Math.min(target, previous + amount));

        if (next === previous) return;

        objective.current = next;

        function updateProgressUI(current) {
            ui.value.textContent = `${current}/${target}`;

            ui.fill.style.width = `${Math.min(100, (current / target) * 100)}%`;

            ui.track.setAttribute("aria-valuenow", String(current));

            ui.increase.disabled = current >= target;
            ui.decrease.disabled = current <= 0;
        }

        updateProgressUI(next);

        ui.increase.disabled = true;
        ui.decrease.disabled = true;

        try {
            if (!isOverview) {
                const result = await apiRequest(
                    `/api/custom-events/${encodeURIComponent(event.id)}/progress`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            account_id: Number(accountId),
                            objective_index: objectiveIndex,
                            amount,
                        }),
                    },
                );

                objective.current = result.current;
                updateProgressUI(result.current);
            } else {
                const payload = {
                    title: event.title,
                    description: event.description || null,
                    account_scope: event.account_scope,
                    account_id: event.account_scope === "account" ? event.account_id : null,
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

                await apiRequest(
                    `/api/custom-events/${encodeURIComponent(event.id)}`,
                    {
                        method: "PUT",
                        body: JSON.stringify(payload),
                    },
                    window.CyreneSchemas.customEventResponseSchema,
                );
            }
            window.showCyreneToast?.("Objective progress saved.");
        } catch (error) {
            objective.current = previous;
            updateProgressUI(previous);

            window.showCyreneToast?.(
                error.message || "Unable to update objective progress.",
                "error",
            );
        } finally {
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
            const name = makeElement(
                "span",
                "events-custom-progress-name",
                objective.title || "Objective",
            );
            const value = makeElement(
                "span",
                "events-custom-progress-value",
                `${current}/${target}`,
            );

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

            const decreaseButton = makeElement(
                "button",
                "cyrene-button events-custom-progress-button",
                "−",
            );

            decreaseButton.type = "button";
            decreaseButton.setAttribute(
                "aria-label",
                `Decrease ${objective.title || "objective"} progress`,
            );
            decreaseButton.disabled = current <= 0;

            decreaseButton.addEventListener("click", () => {
                changeObjectiveProgress(event, index, -1, {
                    value,
                    fill,
                    increase: increaseButton,
                    decrease: decreaseButton,
                    track,
                });
            });

            const increaseButton = makeElement(
                "button",
                "cyrene-button events-custom-progress-button",
                "+",
            );

            increaseButton.type = "button";
            increaseButton.setAttribute(
                "aria-label",
                `Increase ${objective.title || "objective"} progress`,
            );
            increaseButton.disabled = current >= target;

            increaseButton.addEventListener("click", () => {
                changeObjectiveProgress(event, index, 1, {
                    value,
                    fill,
                    increase: increaseButton,
                    decrease: decreaseButton,
                    track,
                });
            });

            controls.append(track, decreaseButton, increaseButton);
            item.append(heading, controls);
            section.append(item);
        });

        card.append(section);
    }

    return {
        renderProgress,
    };
};
