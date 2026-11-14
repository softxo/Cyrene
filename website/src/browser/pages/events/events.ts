// @ts-nocheck -- Legacy global script; types will be tightened incrementally.

window.scheduleEventsPreviewRefresh = function () {
    clearTimeout(window.eventsPreviewRefreshTimeout);
    const page = document.querySelector(".events-page");
    if (page?.dataset.previewsPending !== "true") return;
    window.eventsPreviewRefreshTimeout = setTimeout(async () => {
        if (!document.hidden) await window.refreshEvents?.();
        window.scheduleEventsPreviewRefresh();
    }, 2000);
};

function initEvents() {
    const eventsPage = document.querySelector(".events-page");

    if (!eventsPage) {
        return;
    }
    window.scheduleEventsPreviewRefresh();

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

    if (!window.eventsTimerInterval && window.updateEventTimeLeft) {
        window.eventsTimerInterval = setInterval(window.updateEventTimeLeft, 1000);
    }

    if (!window.eventsRefreshInterval && window.refreshEvents) {
        window.eventsRefreshInterval = setInterval(window.refreshEvents, 60000);
    }

    if (!window.eventsVisibilityInitialised) {
        window.eventsVisibilityInitialised = true;

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible" && window.refreshEvents) {
                window.refreshEvents();
            }
        });
    }
}

window.initEvents = initEvents;
