/* =========================================================
   CHARACTERS — ROSTER FILTERS AND SORTING
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

    const searchInput = toolbar.querySelector(
        "[data-character-search]"
    );
    const sortSelect = toolbar.querySelector(
        "[data-character-sort]"
    );
    const rarityFilter = toolbar.querySelector(
        "[data-character-rarity]"
    );
    const elementFilter = toolbar.querySelector(
        "[data-character-element]"
    );
    const weaponFilter = toolbar.querySelector(
        "[data-character-weapon]"
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

    const filterDropdowns = [
        sortSelect,
        ownershipSelect
    ];

    const cards = Array.from(
        grid.querySelectorAll(".character-card")
    );

    if (
        !searchInput ||
        filterDropdowns.some(dropdown => !dropdown) ||
        !rarityFilter ||
        !elementFilter ||
        !weaponFilter ||
        !resetButton
    ) {
        return;
    }

    toolbar.dataset.initialised = "true";

    /* =====================================================
       CUSTOM FILTER DROPDOWNS
       ===================================================== */

    function closeDropdown(dropdown) {
        dropdown.classList.remove("open");

        const button = dropdown.querySelector(
            ".custom-select-button"
        );

        button?.setAttribute("aria-expanded", "false");
    }

    function closeAllDropdowns(except = null) {
        filterDropdowns.forEach(dropdown => {
            if (dropdown !== except) {
                closeDropdown(dropdown);
            }
        });
    }

    function getDropdownValue(dropdown) {
        return dropdown.querySelector(
            ".custom-select-option.selected"
        )?.dataset.value ?? "all";
    }

    function setDropdownValue(dropdown, value) {
        const options = dropdown.querySelectorAll(
            ".custom-select-option"
        );

        const selectedOption = Array.from(options).find(
            option => option.dataset.value === value
        );

        if (!selectedOption) {
            return;
        }

        options.forEach(option => {
            const isSelected = option === selectedOption;

            option.classList.toggle("selected", isSelected);
            option.setAttribute(
                "aria-selected",
                String(isSelected)
            );
        });

        const valueElement = dropdown.querySelector(
            ".custom-select-value"
        );

        if (valueElement) {
            valueElement.textContent =
                selectedOption.textContent.trim();
        }
    }

    function initialiseDropdown(dropdown) {
        const button = dropdown.querySelector(
            ".custom-select-button"
        );

        const menu = dropdown.querySelector(
            ".custom-select-menu"
        );

        const options = dropdown.querySelectorAll(
            ".custom-select-option"
        );

        if (!button || !menu || !options.length) {
            return;
        }

        button.addEventListener("click", event => {
            event.preventDefault();

            const isOpen = dropdown.classList.contains("open");

            closeAllDropdowns(dropdown);

            if (isOpen) {
                closeDropdown(dropdown);
            } else {
                dropdown.classList.add("open");
                button.setAttribute("aria-expanded", "true");
            }
        });

        options.forEach(option => {
            option.addEventListener("click", () => {
                const value = option.dataset.value;

                if (value === undefined) {
                    return;
                }

                setDropdownValue(dropdown, value);
                closeDropdown(dropdown);

                applyFilters();
            });
        });

        button.addEventListener("keydown", event => {
            if (event.key === "Escape") {
                closeDropdown(dropdown);
                button.focus();
            }

            if (
                event.key === "ArrowDown" &&
                !dropdown.classList.contains("open")
            ) {
                event.preventDefault();
                closeAllDropdowns(dropdown);
                dropdown.classList.add("open");
                button.setAttribute("aria-expanded", "true");
                dropdown.querySelector(
                    ".custom-select-option.selected"
                )?.focus();
            }
        });

        options.forEach((option, index) => {
            option.addEventListener("keydown", event => {
                let nextIndex = index;

                if (event.key === "ArrowDown") {
                    nextIndex = (index + 1) % options.length;
                } else if (event.key === "ArrowUp") {
                    nextIndex =
                        (index - 1 + options.length) % options.length;
                } else if (event.key === "Escape") {
                    closeDropdown(dropdown);
                    button.focus();
                    return;
                } else if (event.key === "Tab") {
                    closeDropdown(dropdown);
                    return;
                } else {
                    return;
                }

                event.preventDefault();
                options[nextIndex].focus();
            });
        });
    }

    filterDropdowns.forEach(initialiseDropdown);

    
    /* =====================================================
    RARITY, ELEMENT AND WEAPON ICON FILTERS
    ===================================================== */

    function getButtonFilterValue(container) {
        return container.querySelector(
            ".characters-icon-button.selected"
        )?.dataset.value ?? "all";
    }

    function setButtonFilterValue(container, value) {
        const buttons = container.querySelectorAll(
            ".characters-icon-button"
        );

        buttons.forEach(button => {
            const selected = button.dataset.value === value;

            button.classList.toggle("selected", selected);
            button.setAttribute("aria-pressed", String(selected));
        });
    }

    function initialiseButtonFilter(container) {
        const buttons = container.querySelectorAll(
            ".characters-icon-button"
        );

        buttons.forEach(button => {
            button.addEventListener("click", () => {
                setButtonFilterValue(container, button.dataset.value);
                applyFilters();
            });
        });
    }

    initialiseButtonFilter(rarityFilter);
    initialiseButtonFilter(elementFilter);
    initialiseButtonFilter(weaponFilter);

    /* Close dropdowns when clicking elsewhere. */

    document.addEventListener("click", event => {
        if (
            !filterDropdowns.some(
                dropdown => dropdown.contains(event.target)
            )
        ) {
            closeAllDropdowns();
        }
    });

    /* =====================================================
       SORTING
       ===================================================== */

    function sortCards(visibleCards) {
        const sortBy = getDropdownValue(sortSelect);

        visibleCards.sort((a, b) => {
            const aOwned = a.dataset.owned === "true";
            const bOwned = b.dataset.owned === "true";

            // Priority 1: Owned characters first.
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
                // Alphabetical order, with rarity as a tiebreaker.
                return (
                    aName.localeCompare(bName) ||
                    bRarity - aRarity ||
                    bLevel - aLevel
                );
            }

            if (sortBy === "rarity") {
                // Rarity first, then level, then alphabetical order.
                return (
                    bRarity - aRarity ||
                    bLevel - aLevel ||
                    aName.localeCompare(bName)
                );
            }

            // Default: Level first, rarity as the tiebreaker.
            return (
                bLevel - aLevel ||
                bRarity - aRarity ||
                aName.localeCompare(bName)
            );
        });

        visibleCards.forEach(card => grid.appendChild(card));
    }

    /* =====================================================
       APPLY FILTERS
       ===================================================== */

    function applyFilters() {
        const query = searchInput.value.trim().toLowerCase();

        const rarity = getButtonFilterValue(rarityFilter);
        const element = getButtonFilterValue(elementFilter);
        const weapon = getButtonFilterValue(weaponFilter);
        const ownership = getDropdownValue(ownershipSelect);

        const visibleCards = [];

        cards.forEach(card => {
            const name = card.dataset.name || "";
            const cardRarity = card.dataset.rarity;
            const cardElement = (
                card.dataset.element || ""
            ).toLowerCase();

            const cardWeapon = (
                card.dataset.weapon || ""
            ).toLowerCase();

            const owned = card.dataset.owned === "true";

            const matchesSearch =
                !query || name.includes(query);

            const matchesRarity =
                rarity === "all" || cardRarity === rarity;

            const matchesElement =
                element === "all" || cardElement === element;

            const matchesWeapon =
                weapon === "all" || cardWeapon === weapon;

            const matchesOwnership =
                ownership === "all" ||
                (ownership === "owned" && owned) ||
                (ownership === "unowned" && !owned);

            const matches =
                matchesSearch &&
                matchesRarity &&
                matchesElement &&
                matchesWeapon &&
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

    /* =====================================================
       RESET FILTERS
       ===================================================== */

    searchInput.addEventListener("input", applyFilters);

    resetButton.addEventListener("click", () => {
        searchInput.value = "";

        setDropdownValue(sortSelect, "level");
        setButtonFilterValue(rarityFilter, "all");
        setButtonFilterValue(elementFilter, "all");
        setButtonFilterValue(weaponFilter, "all");
        setDropdownValue(ownershipSelect, "all");

        closeAllDropdowns();
        applyFilters();
    });

    applyFilters();
}