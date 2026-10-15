/* =========================================================
   CHARACTERS — ACCOUNT DROPDOWN AND ROSTER FILTERS
   ========================================================= */

function initCharacters() {
    initCharactersAccountDropdown();
    initCharactersFilters();
}

/* =========================================================
   ACCOUNT DROPDOWN
   ========================================================= */

function initCharactersAccountDropdown() {
    const form = document.querySelector(
        "[data-characters-account-form]"
    );

    if (!form || form.dataset.initialised === "true") {
        return;
    }

    const select = form.querySelector(
        ".characters-account-select"
    );
    const button = select?.querySelector(
        ".custom-select-button"
    );
    const menu = select?.querySelector(
        ".custom-select-menu"
    );
    const valueElement = select?.querySelector(
        ".custom-select-value"
    );
    const hiddenInput = select?.querySelector(
        'input[name="account_id"]'
    );
    const options = select?.querySelectorAll(
        ".custom-select-option"
    );

    if (
        !select ||
        !button ||
        !menu ||
        !valueElement ||
        !hiddenInput ||
        !options
    ) {
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
        } else {
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
                item.setAttribute(
                    "aria-selected",
                    String(isSelected)
                );
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
   CHARACTER FILTERS AND SORTING
   ========================================================= */

function initCharactersFilters() {
    const page = document.querySelector(".characters-page");
    const toolbar = page?.querySelector("[data-character-filters]");
    const grid = page?.querySelector(".characters-grid");

    if (
        !page ||
        !toolbar ||
        !grid ||
        toolbar.dataset.initialised === "true"
    ) {
        return;
    }

    toolbar.dataset.initialised = "true";

    const searchInput = toolbar.querySelector(
        "[data-character-search]"
    );
    const sortSelect = toolbar.querySelector(
        "[data-character-sort]"
    );
    const raritySelect = toolbar.querySelector(
        "[data-character-rarity]"
    );
    const elementSelect = toolbar.querySelector(
        "[data-character-element]"
    );
    const ownershipSelect = toolbar.querySelector(
        "[data-character-ownership]"
    );
    const resetButton = toolbar.querySelector(
        "[data-character-reset]"
    );
    const countElement = page.querySelector(
        "[data-character-count]"
    );

    const cards = Array.from(
        grid.querySelectorAll(".character-card")
    );

    function sortCards(visibleCards) {
        const sortBy = sortSelect.value;

        visibleCards.sort((a, b) => {
            const aOwned = a.dataset.owned === "true";
            const bOwned = b.dataset.owned === "true";

            // Always put owned characters first.
            if (aOwned !== bOwned) {
                return aOwned ? -1 : 1;
            }

            const aLevel = Number(a.dataset.level) || 0;
            const bLevel = Number(b.dataset.level) || 0;

            const aRarity = Number(a.dataset.rarity) || 0;
            const bRarity = Number(b.dataset.rarity) || 0;

            const aName = a.dataset.name || "";
            const bName = b.dataset.name || "";

            if (sortBy === "name") {
                return (
                    aName.localeCompare(bName) ||
                    bLevel - aLevel
                );
            }

            if (sortBy === "rarity") {
                return (
                    bRarity - aRarity ||
                    bLevel - aLevel ||
                    aName.localeCompare(bName)
                );
            }

            // Default: highest level first.
            // Unowned characters have no level and remain below owned characters because ownership is sorted first.
            return (
                bLevel - aLevel ||
                aName.localeCompare(bName)
            );
        });

        visibleCards.forEach(card => grid.appendChild(card));
    }

    function applyFilters() {
        const query = searchInput.value.trim().toLowerCase();
        const rarity = raritySelect.value;
        const element = elementSelect.value;
        const ownership = ownershipSelect.value;

        const visibleCards = [];

        cards.forEach(card => {
            const name = card.dataset.name || "";
            const cardRarity = card.dataset.rarity;
            const cardElement = card.dataset.element;
            const owned = card.dataset.owned === "true";

            const matchesSearch =
                !query || name.includes(query);

            const matchesRarity =
                rarity === "all" || cardRarity === rarity;

            const matchesElement =
                element === "all" || cardElement === element;

            const matchesOwnership =
                ownership === "all" ||
                (ownership === "owned" && owned) ||
                (ownership === "unowned" && !owned);

            const matches =
                matchesSearch &&
                matchesRarity &&
                matchesElement &&
                matchesOwnership;

            card.hidden = !matches;

            if (matches) {
                visibleCards.push(card);
            }
        });

        sortCards(visibleCards);

        if (countElement) {
            countElement.textContent =
                `Showing ${visibleCards.length} of ${cards.length} characters`;
        }
    }

    searchInput.addEventListener("input", applyFilters);
    sortSelect.addEventListener("change", applyFilters);
    raritySelect.addEventListener("change", applyFilters);
    elementSelect.addEventListener("change", applyFilters);
    ownershipSelect.addEventListener("change", applyFilters);

    resetButton.addEventListener("click", () => {
        searchInput.value = "";
        sortSelect.value = "level";
        raritySelect.value = "all";
        elementSelect.value = "all";
        ownershipSelect.value = "all";

        applyFilters();
    });

    applyFilters();
}

window.initCharacters = initCharacters;