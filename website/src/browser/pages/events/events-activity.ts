// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// =========================================================
// EVENTS — ACTIVITY CHECKMARKS
// =========================================================

window.initialiseActivityCheckmarks = function initialiseActivityCheckmarks() {

    document.querySelectorAll(
        ".event-checkmark[data-activity-type]"
    ).forEach(checkmark => {

        if (checkmark.dataset.initialised === "true") {
            return;
        }

        checkmark.dataset.initialised = "true";

        checkmark.addEventListener(
            "click",
            async event => {

                event.preventDefault();
                event.stopPropagation();

                const accountId =
                    checkmark.dataset.accountId;

                const activityType =
                    checkmark.dataset.activityType;

                if (!accountId || !activityType) {
                    return;
                }

                const currentlyChecked =
                    checkmark.getAttribute(
                        "aria-pressed"
                    ) === "true";

                const newChecked =
                    !currentlyChecked;

                // Prevent duplicate requests.
                if (checkmark.dataset.saving === "true") {
                    return;
                }

                checkmark.dataset.saving = "true";

                try {

                    const response =
                        await fetch(
                            "/api/events/activity-check",
                            {
                                method: "POST",

                                headers: {
                                    "Content-Type": "application/json",
                                },

                                body: JSON.stringify({
                                    account_id: Number(accountId),
                                    activity_type: activityType,
                                    checked: newChecked,
                                }),
                            }
                        );

                    const responseText =
                        await response.text();

                    let data;

                    try {

                        data = JSON.parse(responseText);

                    } catch {

                        throw new Error(
                            `Server returned ${response.status}: ${responseText}`
                        );

                    }

                    if (!response.ok || !data.success) {

                        throw new Error(
                            data.error ||
                            `Failed to save activity check (${response.status}).`
                        );

                    }

                    checkmark.setAttribute(
                        "aria-pressed",
                        String(data.checked)
                    );

                    checkmark.classList.toggle(
                        "event-checkmark-empty",
                        !data.checked
                    );

                    const row =
                        checkmark.closest(
                            ".event-list-item, .overview-account-row"
                        );

                    if (row) {

                        row.classList.toggle(
                            "completed",
                            data.checked ||
                            row.dataset.automaticComplete === "true"
                        );

                    }

                } catch (error) {

                    console.error(
                        "Failed to update activity checkmark:",
                        error
                    );

                } finally {

                    delete checkmark.dataset.saving;

                }

            }
        );

    });

};
