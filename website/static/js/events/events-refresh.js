// =========================================================
// EVENTS — AUTOMATIC PAGE REFRESH
// =========================================================

window.refreshEvents = async function refreshEvents() {

    if (window.eventsRefreshing) {
        return;
    }

    window.eventsRefreshing = true;

    try {

        const currentPage =
            document.querySelector(".events-page");

        if (!currentPage) {
            return;
        }

        // -----------------------------------------
        // Current Page State
        // -----------------------------------------

        const isOverview =
            currentPage.dataset.overview === "true";

        const accountId =
            currentPage.dataset.accountId || "";

        // -----------------------------------------
        // Preserve UI State
        // -----------------------------------------

        const expandedCards =
            Array.from(
                currentPage.querySelectorAll(
                    ".event-featured-card:not(.collapsed)"
                )
            ).map(
                card => card.dataset.eventType
            );

        const activeAccountTab =
            currentPage.querySelector(
                ".events-account-tab.active"
            )?.dataset.accountTab ||
            localStorage.getItem(
                "cyreneAccountEventTab"
            ) ||
            "all";

        const activeOverviewTab =
            currentPage.querySelector(
                ".events-overview-tab.active"
            )?.dataset.overviewTab ||
            localStorage.getItem(
                "cyreneOverviewTab"
            ) ||
            "daily";

        const scrollPosition = window.scrollY;

        // -----------------------------------------
        // Build Request
        // -----------------------------------------

        const params = new URLSearchParams();

        if (isOverview) {
            params.set("overview", "true");
        }

        if (accountId) {
            params.set("account_id", accountId);
        }

        const response =
            await fetch(
                `/events/refresh?${params.toString()}`
            );

        if (!response.ok) {
            return;
        }

        const html = await response.text();

        const parser = new DOMParser();

        const documentHTML =
            parser.parseFromString(
                html,
                "text/html"
            );

        const newPage =
            documentHTML.querySelector(".events-page");

        if (!newPage) {
            return;
        }

        // -----------------------------------------
        // Replace Page
        // -----------------------------------------

        currentPage.replaceWith(newPage);

        const eventsPage =
            document.querySelector(".events-page");

        if (!eventsPage) {
            return;
        }

        // -----------------------------------------
        // Restore Expanded Featured Cards
        // -----------------------------------------

        expandedCards.forEach(eventType => {

            const card =
                eventsPage.querySelector(
                    `.event-featured-card[data-event-type="${eventType}"]`
                );

            if (!card) {
                return;
            }

            card.classList.remove("collapsed");

            const toggle =
                card.querySelector(
                    ".event-featured-toggle"
                );

            if (toggle) {

                toggle.setAttribute(
                    "aria-expanded",
                    "true"
                );

            }

        });

        // -----------------------------------------
        // Reinitialise Controls
        // -----------------------------------------

        if (window.initialiseEventsDropdown) {
            window.initialiseEventsDropdown();
        }

        if (window.initialiseAccountTabs) {
            window.initialiseAccountTabs();
        }

        if (window.initialiseEventFeatureToggles) {
            window.initialiseEventFeatureToggles();
        }

        if (window.initialiseOverviewTabs) {
            window.initialiseOverviewTabs();
        }

        if (window.initialiseActivityCheckmarks) {
            window.initialiseActivityCheckmarks();
        }

        if (window.initCustomEvents) {
            window.initCustomEvents();
        }

        if (window.updateEventTimeLeft) {
            window.updateEventTimeLeft();
        }

        // -----------------------------------------
        // Restore Account Category
        // -----------------------------------------

        if (!isOverview) {

            const accountTab =
                eventsPage.querySelector(
                    `.events-account-tab[data-account-tab="${activeAccountTab}"]`
                );

            if (accountTab) {
                accountTab.click();
            }

        }

        // -----------------------------------------
        // Restore Overview Category
        // -----------------------------------------

        if (isOverview) {

            const overviewTab =
                eventsPage.querySelector(
                    `.events-overview-tab[data-overview-tab="${activeOverviewTab}"]`
                );

            if (overviewTab) {
                overviewTab.click();
            }

        }

        // -----------------------------------------
        // Restore Scroll Position
        // -----------------------------------------

        window.scrollTo(0, scrollPosition);

    } catch (error) {

        console.error(
            "Failed to refresh Events:",
            error
        );

    } finally {

        window.eventsRefreshing = false;

    }

};