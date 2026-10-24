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
    }
    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            activateTab(tab.dataset.charactersTab);
        });
    });
    activateTab(tabs.find(tab => tab.classList.contains("active"))
        ?.dataset.charactersTab || "characters");
}
