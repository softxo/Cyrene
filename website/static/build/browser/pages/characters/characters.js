// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
/* =========================================================
   CHARACTERS — MAIN INITIALISER
   ========================================================= */
function initCharacters() {
    initCharactersAccountDropdown();
    initCharactersFilters();
    initCharactersTabs();
    initCharacterPlanner();
    initCharacterShowcase();
}
/* =========================================================
   ACCOUNT DROPDOWN
   ========================================================= */
function initCharactersAccountDropdown() {
    const form = document.querySelector("[data-characters-account-form]");
    if (!form || form.dataset.initialised === "true") {
        return;
    }
    const select = form.querySelector(".characters-account-select");
    const button = select?.querySelector(".custom-select-button");
    const menu = select?.querySelector(".custom-select-menu");
    const valueElement = select?.querySelector(".custom-select-value");
    const hiddenInput = select?.querySelector('input[name="account_id"]');
    const options = select?.querySelectorAll(".custom-select-option");
    if (!select ||
        !button ||
        !menu ||
        !valueElement ||
        !hiddenInput ||
        !options) {
        return;
    }
    form.dataset.initialised = "true";
    function closeDropdown() {
        select.classList.remove("open");
        button.setAttribute("aria-expanded", "false");
    }
    function openDropdown() {
        select.classList.add("open");
        button.setAttribute("aria-expanded", "true");
    }
    button.addEventListener("click", event => {
        event.preventDefault();
        if (select.classList.contains("open")) {
            closeDropdown();
        }
        else {
            openDropdown();
        }
    });
    options.forEach(option => {
        option.addEventListener("click", () => {
            const accountId = option.dataset.value;
            if (!accountId) {
                return;
            }
            hiddenInput.value = accountId;
            valueElement.textContent = option.textContent.trim();
            options.forEach(item => {
                const isSelected = item === option;
                item.classList.toggle("selected", isSelected);
                item.setAttribute("aria-selected", String(isSelected));
            });
            closeDropdown();
            form.requestSubmit();
        });
    });
    document.addEventListener("click", event => {
        if (!select.contains(event.target)) {
            closeDropdown();
        }
    });
    button.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeDropdown();
            button.focus();
        }
    });
}
/* =========================================================
   EXPOSE MAIN INITIALISER
   ========================================================= */
window.initCharacters = initCharacters;
