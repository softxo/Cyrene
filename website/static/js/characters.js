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

/* =========================================================
   CHARACTER SHOWCASE MODAL
   ========================================================= */


function initCharacterShowcase() {
    const page = document.querySelector(".characters-page");
    const modal = page?.querySelector("[data-character-showcase]");
    const dialog = modal?.querySelector(".character-showcase-modal");
    const portrait = modal?.querySelector("[data-showcase-portrait]");
    const nameElement = modal?.querySelector("#showcase-character-name");
    const elementElement = modal?.querySelector("[data-showcase-element]");
    const levelElement = modal?.querySelector("[data-showcase-level]");
    const statusElement = modal?.querySelector("[data-showcase-status]");
    const detailsElement = modal?.querySelector("[data-showcase-details]");

    if (
        !page ||
        !modal ||
        !dialog ||
        !portrait ||
        !nameElement ||
        !elementElement ||
        !levelElement ||
        !statusElement ||
        !detailsElement ||
        modal.dataset.initialised === "true"
    ) {
        return;
    }

    modal.dataset.initialised = "true";

    let previouslyFocused = null;
    let activeRequestId = 0;

    function createElement(tag, className, text = "") {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        element.textContent = text;
        return element;
    }

    function createImage(src, alt, className = "") {
        const image = createElement("img", className);
        image.alt = alt;
        image.loading = "lazy";

        if (src) {
            image.src = src;
        }

        return image;
    }

    function addSection(title, className = "") {
        const section = createElement(
            "section",
            `showcase-section ${className}`.trim()
        );

        section.append(
            createElement("h3", "showcase-section-title", title)
        );

        detailsElement.append(section);
        return section;
    }

    function addStatCard(container, label, value) {
        const stat = createElement("div", "showcase-stat");

        stat.append(
            createElement("span", "showcase-stat-label", label),
            createElement("strong", "showcase-stat-value", value ?? "—")
        );

        container.append(stat);
    }

    function formatValue(value) {
        if (value === null || value === undefined || value === "") {
            return "—";
        }

        return String(value);
    }

    function cleanGameText(value) {
        return String(value ?? "")
            .replace(/\\n/g, " ")
            .replace(/<color(?:=[^>]*)?>/gi, "")
            .replace(/<\/color>/gi, "")
            .replace(/<[^>]*>/g, "")
            .replace(/\{LINK#\d+\}/g, "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function renderWeapon(character) {
        const weapon = character.weapon;

        if (!weapon) {
            return;
        }

        const section = addSection("Weapon", "showcase-weapon-section");
        const card = createElement("div", "showcase-weapon");

        if (weapon.icon) {
            card.append(
                createImage(weapon.icon, weapon.name || "Weapon", "showcase-item-icon")
            );
        }

        const info = createElement("div", "showcase-weapon-info");

        info.append(
            createElement("h4", "", weapon.name || "Unknown weapon"),
            createElement(
                "p",
                "showcase-item-meta",
                `Level ${formatValue(weapon.level)} · R${formatValue(weapon.refinement)}`
            )
        );

        const stats = createElement("div", "showcase-weapon-stats");

        for (const stat of [weapon.main_stat, weapon.sub_stat]) {
            if (!stat) {
                continue;
            }

            const label = stat.info?.name;
            const value = stat.final ?? stat.value;

            if (label || value !== undefined) {
                addStatCard(stats, label || "Weapon stat", formatValue(value));
            }
        }

        info.append(stats);
        card.append(info);
        section.append(card);
    }
    
    function renderCombatStats(character) {
        const properties = character.selected_properties || [];

        const preferredStats = [
            "CRIT Rate",
            "CRIT DMG",
            "Energy Recharge",
            "Max HP",
            "ATK",
            "DEF",
            "Elemental Mastery",
            `${character.element || ""} DMG Bonus`
        ];

        const propertyMap = new Map(
            properties
                .filter(property => property.info?.name)
                .map(property => [
                    property.info.name,
                    property.final ?? property.value
                ])
        );

        const statsToShow = preferredStats
            .filter(name => propertyMap.has(name))
            .map(name => ({
                label: name,
                value: propertyMap.get(name),
                priority: [
                    "CRIT Rate",
                    "CRIT DMG",
                    "Energy Recharge"
                ].includes(name)
            }));

        if (!statsToShow.length) {
            return;
        }

        const section = addSection("Combat Attributes");
        const grid = createElement("div", "showcase-stats-grid");

        for (const stat of statsToShow) {
            const card = createElement(
                "div",
                `showcase-stat${stat.priority ? " showcase-stat-priority" : ""}`
            );

            card.append(
                createElement(
                    "span",
                    "showcase-stat-label",
                    stat.label
                ),
                createElement(
                    "strong",
                    "showcase-stat-value",
                    formatValue(stat.value)
                )
            );

            grid.append(card);
        }

        section.append(grid);
    }

    function renderArtifacts(character) {
        const artifacts = character.artifacts || [];

        if (!artifacts.length) {
            return;
        }

        const section = addSection("Artifacts");
        const grid = createElement("div", "showcase-artifact-grid");

        for (const artifact of artifacts) {
            const card = createElement("article", "showcase-artifact");

            if (artifact.icon) {
                card.append(
                    createImage(
                        artifact.icon,
                        artifact.name || "Artifact",
                        "showcase-item-icon"
                    )
                );
            }

            const info = createElement("div", "showcase-artifact-info");

            info.append(
                createElement(
                    "p",
                    "showcase-artifact-slot",
                    artifact.pos_name || "Artifact"
                ),
                createElement(
                    "h4",
                    "showcase-artifact-name",
                    artifact.name || "Unknown artifact"
                ),
                createElement(
                    "p",
                    "showcase-item-meta",
                    `+${formatValue(artifact.level)}`
                )
            );

            if (artifact.main_stat) {
                const mainStat = artifact.main_stat;
                const mainValue = mainStat.value ?? mainStat.final;

                info.append(
                    createElement(
                        "p",
                        "showcase-artifact-main-stat",
                        `${mainStat.info?.name || "Main stat"}: ${formatValue(mainValue)}`
                    )
                );
            }

            const subStats = artifact.sub_stats || [];

            if (subStats.length) {
                const list = createElement(
                    "ul",
                    "showcase-artifact-substats"
                );

                for (const subStat of subStats) {
                    const label = subStat.info?.name || "Sub-stat";
                    const value = subStat.value ?? subStat.final;

                    list.append(
                        createElement(
                            "li",
                            "",
                            `${label} ${formatValue(value)}`
                        )
                    );
                }

                info.append(list);
            }

            card.append(info);
            grid.append(card);
        }

        section.append(grid);

        /* Calculate equipped set counts from the actual artifacts. */

        const setCounts = new Map();

        for (const artifact of artifacts) {
            const setName = artifact.set?.name;

            if (!setName) {
                continue;
            }

            const existing = setCounts.get(setName) || {
                count: 0,
                effects: []
            };

            existing.count += 1;

            for (const effect of artifact.set?.effects || []) {
                const requiredPieces = Number(effect.required_piece_num);
                const description = cleanGameText(effect.effect);

                if (
                    Number.isFinite(requiredPieces) &&
                    requiredPieces > 0 &&
                    description &&
                    !existing.effects.some(item =>
                        item.requiredPieces === requiredPieces &&
                        item.description === description
                    )
                ) {
                    existing.effects.push({
                        requiredPieces,
                        description
                    });
                }
            }

            setCounts.set(setName, existing);
        }

        const equippedSets = Array.from(setCounts.entries())
            .filter(([, set]) => set.count >= 2)
            .sort((a, b) => b[1].count - a[1].count);

        if (!equippedSets.length) {
            return;
        }

        const setSection = createElement(
            "div",
            "showcase-artifact-sets"
        );

        for (const [setName, set] of equippedSets) {
            const setCard = createElement(
                "article",
                "showcase-artifact-set"
            );

            setCard.append(
                createElement(
                    "h4",
                    "showcase-artifact-set-name",
                    `${set.count}-Piece Set · ${setName}`
                )
            );

            const activeEffects = set.effects
                .filter(effect => effect.requiredPieces <= set.count)
                .sort((a, b) => a.requiredPieces - b.requiredPieces);

            if (activeEffects.length) {
                for (const effect of activeEffects) {
                    const effectBlock = createElement(
                        "div",
                        "showcase-artifact-set-effect"
                    );

                    effectBlock.append(
                        createElement(
                            "strong",
                            "",
                            `${effect.requiredPieces}-Piece Bonus`
                        ),
                        createElement(
                            "p",
                            "",
                            effect.description
                        )
                    );

                    setCard.append(effectBlock);
                }
            } else {
                setCard.append(
                    createElement(
                        "p",
                        "showcase-artifact-set-effect",
                        "Set bonus details unavailable."
                    )
                );
            }

            setSection.append(setCard);
        }

        section.append(setSection);
    }

    function renderTalents(character) {
        const skills = character.skills || [];
        const talents = skills.filter(skill => Number(skill.skill_type) === 1);

        if (!talents.length) {
            return;
        }

        const section = addSection("Talents");
        const grid = createElement("div", "showcase-talent-grid");

        for (const talent of talents) {
            const card = createElement("article", "showcase-talent");

            if (talent.icon) {
                card.append(
                    createImage(
                        talent.icon,
                        talent.name || "Talent",
                        "showcase-talent-icon"
                    )
                );
            }

            const info = createElement("div", "showcase-talent-info");

            info.append(
                createElement("h4", "", talent.name || "Talent"),
                createElement(
                    "p",
                    "showcase-item-meta",
                    `Level ${formatValue(talent.level)}`
                )
            );

            card.append(info);
            grid.append(card);
        }

        section.append(grid);
    }

    function renderConstellations(character) {
        const constellations = character.constellations || [];

        if (!constellations.length) {
            return;
        }

        const section = addSection("Constellations");
        const grid = createElement("div", "showcase-constellation-grid");

        for (const constellation of constellations) {
            const active = Boolean(constellation.activated);
            const description = cleanGameText(constellation.effect);
            const card = createElement(
                "article",
                `showcase-constellation${active ? " is-active" : ""}`
            );

            if (constellation.icon) {
                card.append(
                    createImage(
                        constellation.icon,
                        constellation.name || `Constellation ${constellation.pos}`,
                        "showcase-constellation-icon"
                    )
                );
            }

            if (description) {
                card.title = description;
                card.tabIndex = 0;
                card.setAttribute(
                    "aria-label",
                    `C${constellation.pos}: ${constellation.name || "Constellation"}. ` +
                    `${active ? "Unlocked." : "Locked."} ${description}`
                );
            }

            card.append(
                createElement("span", "showcase-constellation-number", `C${constellation.pos}`),
                createElement(
                    "span",
                    "showcase-constellation-name",
                    constellation.name || "Constellation"
                ),
                createElement(
                    "span",
                    "showcase-constellation-state",
                    active ? "Unlocked" : "Locked"
                )
            );

            grid.append(card);
        }

        section.append(grid);
    }

    function renderCharacter(character) {
        detailsElement.replaceChildren();

        renderWeapon(character);
        renderCombatStats(character);
        renderArtifacts(character);
        renderTalents(character);
        renderConstellations(character);

        detailsElement.hidden = false;
    }

    async function loadCharacter(card, requestId) {
        const characterId = card.dataset.characterId;
        const accountId = modal.dataset.accountId;

        if (!characterId) {
            throw new Error("This character card is missing its character ID.");
        }

        const query = accountId
            ? `?account_id=${encodeURIComponent(accountId)}`
            : "";

        const response = await fetch(
            `/api/characters/${encodeURIComponent(characterId)}/showcase${query}`,
            {
                method: "GET",
                credentials: "same-origin",
                headers: { Accept: "application/json" }
            }
        );

        let payload;

        try {
            payload = await response.json();
        } catch {
            throw new Error("The server returned an invalid response.");
        }

        if (!response.ok) {
            throw new Error(
                payload?.error || "Couldn't retrieve this character's build."
            );
        }

        const character = payload?.data?.characters?.[0];

        if (!character) {
            throw new Error("No detailed build data was returned for this character.");
        }

        if (requestId !== activeRequestId || modal.hidden) {
            return;
        }

        nameElement.textContent = character.name || "Unknown character";
        elementElement.textContent = character.element || "";
        levelElement.textContent =
            `Level ${formatValue(character.level)} · ` +
            `C${formatValue(character.constellation)} · ` +
            `Friendship ${formatValue(character.friendship)}`;

        portrait.src = character.display_image || character.icon || "";
        portrait.alt = character.name || "Character artwork";

        renderCharacter(character);
        statusElement.textContent = "";
    }

    function openShowcase(card) {
        if (card.dataset.owned !== "true") {
            return;
        }

        const image = card.querySelector(".character-card-image img");
        const name = card.querySelector(".character-card-info h2");
        const element = card.querySelector(".character-element span");

        if (!image || !name) {
            return;
        }

        previouslyFocused = document.activeElement;
        const requestId = ++activeRequestId;

        portrait.src = image.src;
        portrait.alt = name.textContent.trim();
        nameElement.textContent = name.textContent.trim();
        elementElement.textContent = element?.textContent.trim() || "";
        levelElement.textContent = card.dataset.level
            ? `Level ${card.dataset.level}`
            : "Level unavailable";

        detailsElement.replaceChildren();
        detailsElement.hidden = true;
        statusElement.textContent = "Loading character build…";

        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("character-showcase-open");
        dialog.focus();

        loadCharacter(card, requestId).catch(error => {
            if (requestId !== activeRequestId || modal.hidden) {
                return;
            }

            statusElement.textContent =
                error instanceof Error
                    ? error.message
                    : "Couldn't retrieve this character's build.";
        });
    }

    function closeShowcase() {
        if (modal.hidden) {
            return;
        }

        activeRequestId++;
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        document.body.classList.remove("character-showcase-open");

        if (previouslyFocused?.isConnected) {
            previouslyFocused.focus();
        }
    }

    page.addEventListener("click", event => {
        if (!(event.target instanceof Element)) {
            return;
        }

        const closeButton = event.target.closest("[data-showcase-close]");

        if (closeButton && modal.contains(closeButton)) {
            closeShowcase();
            return;
        }

        const card = event.target.closest(".character-card");

        if (card && page.contains(card)) {
            openShowcase(card);
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) {
            closeShowcase();
        }
    });
}

window.initCharacters = initCharacters;
window.initCharacterShowcase = initCharacterShowcase;