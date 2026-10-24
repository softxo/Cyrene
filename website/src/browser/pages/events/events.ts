// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// =========================================================
// CYRENE — EVENTS PAGE ENTRY POINT
// =========================================================

function initEvents() {

    const eventsPage =
        document.querySelector(".events-page");

    if (!eventsPage) {
        return;
    }

    // =========================================
    // INITIALISE PAGE CONTROLS
    // =========================================

    if (window.initialiseEventsDropdown) {
        window.initialiseEventsDropdown();
    }

    if (window.initialiseDropdownClose) {
        window.initialiseDropdownClose();
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

    // =========================================
    // COUNTDOWN TIMER
    // =========================================

    if (
        !window.eventsTimerInterval &&
        window.updateEventTimeLeft
    ) {

        window.eventsTimerInterval =
            setInterval(
                window.updateEventTimeLeft,
                1000
            );

    }

    // =========================================
    // AUTOMATIC REFRESH
    // =========================================

    if (
        !window.eventsRefreshInterval &&
        window.refreshEvents
    ) {

        window.eventsRefreshInterval =
            setInterval(
                window.refreshEvents,
                60000
            );

    }

    // =========================================
    // REFRESH WHEN TAB BECOMES VISIBLE
    // =========================================

    if (!window.eventsVisibilityInitialised) {

        window.eventsVisibilityInitialised = true;

        document.addEventListener(
            "visibilitychange",
            () => {

                if (
                    document.visibilityState === "visible" &&
                    window.refreshEvents
                ) {

                    window.refreshEvents();

                }

            }
        );

    }

}

window.initEvents = initEvents;
