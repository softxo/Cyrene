// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// =========================================================
// EVENTS — ACCOUNT TABS
// =========================================================
window.initialiseAccountTabs = function initialiseAccountTabs() {
    const page = document.querySelector(".events-page");
    if (!page) {
        return;
    }
    const tabs = page.querySelectorAll(".events-account-tab");
    const sections = page.querySelectorAll("[data-account-category]");
    if (!tabs.length || !sections.length) {
        return;
    }
    // -----------------------------------------
    // Activate Category
    // -----------------------------------------
    function activateCategory(category) {
        tabs.forEach(tab => {
            tab.classList.toggle("active", tab.dataset.accountTab === category);
        });
        sections.forEach(section => {
            const sectionCategory = section.dataset.accountCategory;
            const isEmptyState = section.classList.contains("events-account-empty");
            if (category === "all") {
                section.hidden =
                    isEmptyState ||
                        sectionCategory === "wishes";
                return;
            }
            section.hidden =
                sectionCategory !== category;
        });
        localStorage.setItem("cyreneAccountEventTab", category);
        const url = new URL(window.location.href);
        url.searchParams.set("tab", category);
        window.history.replaceState(window.history.state, "", url);
    }
    // -----------------------------------------
    // Tab Listeners
    // -----------------------------------------
    tabs.forEach(tab => {
        if (tab.dataset.initialised === "true") {
            return;
        }
        tab.dataset.initialised = "true";
        tab.addEventListener("click", () => {
            const category = tab.dataset.accountTab;
            if (!category) {
                return;
            }
            activateCategory(category);
        });
    });
    // -----------------------------------------
    // Restore Previously Selected Category
    // -----------------------------------------
    const urlCategory = new URLSearchParams(window.location.search).get("tab");
    const savedCategory = localStorage.getItem("cyreneAccountEventTab");
    const categoryToRestore = urlCategory ||
        savedCategory ||
        "all";
    const categoryExists = Array.from(tabs).some(tab => tab.dataset.accountTab ===
        categoryToRestore);
    if (categoryExists) {
        const serverActiveTab = page.querySelector(".events-account-tab.active")?.dataset.accountTab;
        if (serverActiveTab !== categoryToRestore) {
            activateCategory(categoryToRestore);
        }
        else {
            localStorage.setItem("cyreneAccountEventTab", categoryToRestore);
        }
    }
    else {
        activateCategory("all");
    }
};
// =========================================================
// EVENTS — OVERVIEW TABS
// =========================================================
window.initialiseOverviewTabs = function initialiseOverviewTabs() {
    const page = document.querySelector(".events-page");
    if (!page) {
        return;
    }
    const tabs = page.querySelectorAll(".events-overview-tab");
    const panels = page.querySelectorAll(".events-overview-panel");
    if (!tabs.length || !panels.length) {
        return;
    }
    // -----------------------------------------
    // Activate Overview Tab
    // -----------------------------------------
    function activateTab(target) {
        document.documentElement.dataset.overviewTab =
            target;
        tabs.forEach(tab => {
            tab.classList.toggle("active", tab.dataset.overviewTab === target);
        });
        panels.forEach(panel => {
            panel.classList.toggle("active", panel.dataset.overviewPanel === target);
        });
    }
    // -----------------------------------------
    // Tab Listeners
    // -----------------------------------------
    tabs.forEach(tab => {
        if (tab.dataset.initialised === "true") {
            return;
        }
        tab.dataset.initialised = "true";
        tab.addEventListener("click", () => {
            const target = tab.dataset.overviewTab;
            if (!target) {
                return;
            }
            localStorage.setItem("cyreneOverviewTab", target);
            activateTab(target);
        });
    });
    // -----------------------------------------
    // Restore Previously Selected Tab
    // -----------------------------------------
    const savedTab = localStorage.getItem("cyreneOverviewTab");
    const savedTabExists = Array.from(tabs).some(tab => tab.dataset.overviewTab === savedTab);
    activateTab(savedTabExists
        ? savedTab
        : "daily");
};
