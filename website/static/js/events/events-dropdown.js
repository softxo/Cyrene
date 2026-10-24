// =========================================================
// EVENTS — ACCOUNT DROPDOWN
// =========================================================

window.initialiseEventsDropdown = function initialiseEventsDropdown() {

    const dropdown =
        document.getElementById("events-account");

    if (!dropdown) {
        return;
    }

    const button =
        dropdown.querySelector(".custom-select-button");

    if (!button) {
        return;
    }

    if (button.dataset.initialised === "true") {
        return;
    }

    button.dataset.initialised = "true";

    button.addEventListener("click", event => {

        event.preventDefault();
        event.stopPropagation();

        dropdown.classList.toggle("open");

    });

    // -----------------------------------------
    // Account Options
    // -----------------------------------------

    dropdown.querySelectorAll(".custom-select-option")
        .forEach(option => {

            if (option.dataset.initialised === "true") {
                return;
            }

            option.dataset.initialised = "true";

            option.addEventListener("click", event => {

                event.preventDefault();
                event.stopPropagation();

                const accountId =
                    option.dataset.accountId;

                if (!accountId) {
                    return;
                }

                dropdown.classList.remove("open");

                const currentTab =
                    document.querySelector(
                        ".events-account-tab.active"
                    )?.dataset.accountTab ||
                    localStorage.getItem(
                        "cyreneAccountEventTab"
                    ) ||
                    "all";

                window.location.href =
                    `/events?account_id=${accountId}&tab=${encodeURIComponent(currentTab)}`;

            });

        });

};


// =========================================================
// CLOSE ACCOUNT DROPDOWN WHEN CLICKING OUTSIDE
// =========================================================

window.initialiseDropdownClose = function initialiseDropdownClose() {

    if (window.eventsDropdownCloseInitialised) {
        return;
    }

    window.eventsDropdownCloseInitialised = true;

    document.addEventListener("click", event => {

        const dropdown =
            document.getElementById("events-account");

        if (!dropdown) {
            return;
        }

        if (!dropdown.contains(event.target)) {
            dropdown.classList.remove("open");
        }

    });

};