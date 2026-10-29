// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Tab state belongs to this Events visit, carried by its URL across reloads.
// Fresh navigation to /events starts with the default tabs.
window.updateEventsTabUrl = function updateEventsTabUrl(key, value) {
    const url = new URL(window.location.href);
    url.searchParams.set(key, value);
    window.history.replaceState(window.history.state, "", url);
    const layout = document.querySelector(".events-layout-switch");
    if (layout) {
        const target = new URL(layout.href, window.location.origin);
        for (const name of ["tab", "overview_tab"]) {
            const selected = url.searchParams.get(name);
            if (selected)
                target.searchParams.set(name, selected);
        }
        layout.href = target.href;
    }
};
window.initialiseAccountTabs = function initialiseAccountTabs() {
    const page = document.querySelector(".events-page");
    if (!page)
        return;
    const tabs = page.querySelectorAll(".events-account-tab");
    if (!tabs.length)
        return;
    function activateCategory(category) {
        tabs.forEach((tab) => {
            tab.classList.toggle("active", tab.dataset.accountTab === category);
        });
        // Query live sections: a refresh may have inserted or replaced one.
        page.querySelectorAll("[data-account-category]").forEach((section) => {
            section.hidden =
                category === "all"
                    ? section.classList.contains("events-account-empty") ||
                        section.dataset.accountCategory === "wishes"
                    : section.dataset.accountCategory !== category;
        });
        window.updateEventsTabUrl("tab", category);
    }
    tabs.forEach((tab) => {
        if (tab.dataset.initialised === "true")
            return;
        tab.dataset.initialised = "true";
        tab.addEventListener("click", () => {
            if (tab.dataset.accountTab)
                activateCategory(tab.dataset.accountTab);
        });
    });
    const requested = new URLSearchParams(window.location.search).get("tab");
    const category = Array.from(tabs).some((tab) => tab.dataset.accountTab === requested)
        ? requested
        : "all";
    // Always reconcile visibility, even when the active button already matches.
    activateCategory(category);
};
window.initialiseOverviewTabs = function initialiseOverviewTabs() {
    const page = document.querySelector(".events-page");
    if (!page)
        return;
    const tabs = page.querySelectorAll(".events-overview-tab");
    if (!tabs.length)
        return;
    function activateTab(target) {
        document.documentElement.dataset.overviewTab = target;
        tabs.forEach((tab) => {
            tab.classList.toggle("active", tab.dataset.overviewTab === target);
        });
        page.querySelectorAll(".events-overview-panel").forEach((panel) => {
            panel.classList.toggle("active", panel.dataset.overviewPanel === target);
        });
        window.updateEventsTabUrl("overview_tab", target);
    }
    tabs.forEach((tab) => {
        if (tab.dataset.initialised === "true")
            return;
        tab.dataset.initialised = "true";
        tab.addEventListener("click", () => {
            if (tab.dataset.overviewTab)
                activateTab(tab.dataset.overviewTab);
        });
    });
    const requested = new URLSearchParams(window.location.search).get("overview_tab");
    activateTab(Array.from(tabs).some((tab) => tab.dataset.overviewTab === requested) ? requested : "daily");
};
