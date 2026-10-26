// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
/* =========================================================
   CHARACTERS — TAB NAVIGATION
   ========================================================= */
function initCharactersTabs() {
    const page = document.querySelector(".characters-page");
    if (!page || page.dataset.tabsInitialised === "true") {
        return;
    }
    const tabs = Array.from(page.querySelectorAll("[data-characters-tab]"));
    const panels = Array.from(page.querySelectorAll("[data-characters-panel]"));
    const summary = page.querySelector(".characters-summary");
    const tabInput = page.querySelector("[data-characters-tab-input]");
    if (!tabs.length || !panels.length) {
        return;
    }
    page.dataset.tabsInitialised = "true";
    function activateTab(name) {
        tabs.forEach(tab => {
            const active = tab.dataset.charactersTab === name;
            tab.classList.toggle("active", active);
            tab.setAttribute("aria-pressed", String(active));
        });
        panels.forEach(panel => {
            const active = panel.dataset.charactersPanel === name;
            panel.hidden = !active;
            panel.classList.toggle("active", active);
        });
        if (summary) {
            summary.hidden = name !== "characters";
        }
        if (tabInput) {
            tabInput.value = name;
        }
    }
    function updateTabParameter(name) {
        const url = new URL(window.location.href);
        if (name === "planner") {
            url.searchParams.set("tab", name);
        }
        else {
            url.searchParams.delete("tab");
        }
        history.replaceState(history.state, "", url);
    }
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const name = tab.dataset.charactersTab;
            activateTab(name);
            updateTabParameter(name);
        });
    });
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    const initialTab = requestedTab === "planner" ? "planner" : "characters";
    activateTab(initialTab);
}
