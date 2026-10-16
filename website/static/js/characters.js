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
    
    function getStatLabel(stat) {
        return cleanGameText(
            stat?.info?.name ??
            stat?.name ??
            stat?.type ??
            "Stat"
        );
    }

    function getStatValue(stat) {
        return formatValue(
            stat?.final ??
            stat?.value ??
            stat?.display ??
            stat?.formatted_value
        );
    }

    function getArtifactStatText(stat) {
        if (!stat) {
            return "—";
        }

        const name = getStatLabel(stat);
        const value = getStatValue(stat);

        return `${name} ${value}`;
    }

    function getArtifactTooltip(artifact) {
        const lines = [
            cleanGameText(artifact.position),
            cleanGameText(artifact.name),
            `+${formatValue(artifact.level)}`
        ];

        if (artifact.main_stat) {
            lines.push(
                getArtifactStatText(artifact.main_stat)
            );
        }

        for (const stat of artifact.substats || []) {
            lines.push(getArtifactStatText(stat));
        }

        if (artifact.set?.name) {
            lines.push(
                `Set: ${cleanGameText(artifact.set.name)}`
            );
        }

        return lines.filter(Boolean).join("\n");
    }

    function renderWeapon(character) {
        const weapon = character.weapon;

        const section = addSection(
            "WEAPON",
            "showcase-weapon-section"
        );

        if (!weapon) {
            section.append(
                createElement(
                    "p",
                    "showcase-empty",
                    "Weapon data unavailable"
                )
            );
            return;
        }

        const weaponCard = createElement(
            "div",
            "showcase-weapon"
        );

        const icon = createImage(
            weapon.icon,
            weapon.name || "Weapon",
            "showcase-item-icon"
        );

        const info = createElement(
            "div",
            "showcase-weapon-info"
        );

        info.append(
            createElement(
                "h4",
                "showcase-item-name",
                cleanGameText(weapon.name)
            ),
            createElement(
                "p",
                "showcase-item-meta",
                `Lv. ${formatValue(weapon.level)} · R${formatValue(weapon.refinement)}`
            )
        );

        const stats = createElement(
            "div",
            "showcase-weapon-stats"
        );

        for (const stat of [
            weapon.main_stat,
            weapon.sub_stat
        ]) {
            if (!stat) {
                continue;
            }

            const line = createElement(
                "p",
                "showcase-weapon-stat",
                `${getStatLabel(stat)} ${getStatValue(stat)}`
            );

            stats.append(line);
        }

        weaponCard.append(icon, info);

        if (stats.childElementCount > 0) {
            weaponCard.append(stats);
        }

        section.append(weaponCard);
    }

    function renderCombatStats(character) {
        const properties = character.selected_properties || [];

        const preferredStats = [
            "CRIT Rate",
            "CRIT DMG",
            "Energy Recharge",
            "Elemental Mastery",
            "ATK",
            "Max HP",
            "DEF"
        ];

        const propertyMap = new Map();

        for (const property of properties) {
            const name = cleanGameText(property.info?.name);

            if (!name) {
                continue;
            }

            propertyMap.set(
                name,
                property.final ?? property.value
            );
        }

        const section = addSection(
            "COMBAT STATS",
            "showcase-combat-section"
        );

        const grid = createElement(
            "div",
            "showcase-stats-grid"
        );

        for (const name of preferredStats) {
            if (!propertyMap.has(name)) {
                continue;
            }

            const stat = createElement(
                "div",
                "showcase-stat"
            );

            stat.append(
                createElement(
                    "span",
                    "showcase-stat-label",
                    name
                ),
                createElement(
                    "strong",
                    "showcase-stat-value",
                    formatValue(propertyMap.get(name))
                )
            );

            if (
                name === "CRIT Rate" ||
                name === "CRIT DMG" ||
                name === "Energy Recharge"
            ) {
                stat.classList.add("showcase-stat-priority");
            }

            grid.append(stat);
        }

        if (grid.childElementCount === 0) {
            grid.append(
                createElement(
                    "p",
                    "showcase-empty",
                    "Combat stats unavailable"
                )
            );
        }

        section.append(grid);
    }

    function renderArtifacts(character) {
        const artifacts = character.artifacts || [];

        const section = addSection(
            "ARTIFACTS",
            "showcase-artifacts-section"
        );

        const grid = createElement(
            "div",
            "showcase-artifact-grid"
        );

        for (const artifact of artifacts) {
            const artifactCard = createElement(
                "div",
                "showcase-artifact"
            );

            const tooltip = getArtifactTooltip(artifact);

            artifactCard.title = tooltip;
            artifactCard.setAttribute("aria-label", tooltip);

            const icon = createImage(
                artifact.icon,
                artifact.name || "Artifact",
                "showcase-item-icon"
            );

            const level = createElement(
                "span",
                "showcase-artifact-level",
                `+${formatValue(artifact.level)}`
            );

            artifactCard.append(icon, level);
            grid.append(artifactCard);
        }

        if (grid.childElementCount === 0) {
            grid.append(
                createElement(
                    "p",
                    "showcase-empty",
                    "Artifact data unavailable"
                )
            );
        }

        section.append(grid);

        // Keep set bonuses compact, while retaining their full descriptions.
        const setCounts = new Map();
        const setEffects = new Map();

        for (const artifact of artifacts) {
            const set = artifact.set;

            if (!set?.name) {
                continue;
            }

            const setName = cleanGameText(set.name);

            setCounts.set(
                setName,
                (setCounts.get(setName) || 0) + 1
            );

            if (Array.isArray(set.effects)) {
                setEffects.set(setName, set.effects);
            }
        }

        if (setCounts.size === 0) {
            return;
        }

        const sets = createElement(
            "div",
            "showcase-artifact-sets"
        );

        for (const [name, count] of setCounts) {
            const setInfo = createElement(
                "div",
                "showcase-artifact-set"
            );

            const effects = setEffects.get(name) || [];
            const activeEffects = effects.filter(effect => {
                const requiredPieces = Number(
                    effect?.pieces ??
                    effect?.required_pieces ??
                    effect?.count ??
                    0
                );

                return requiredPieces > 0 &&
                    count >= requiredPieces;
            });

            const descriptions = activeEffects
                .map(effect => cleanGameText(
                    effect.description ??
                    effect.name ??
                    ""
                ))
                .filter(Boolean);

            setInfo.textContent = `${count}× ${name}`;

            if (descriptions.length > 0) {
                setInfo.title = descriptions.join("\n");
            }

            sets.append(setInfo);
        }

        section.append(sets);
    }

    function renderTalents(character) {
        const skills = (character.skills || []).filter(
            skill => Number(skill.skill_type) === 1
        );

        const section = addSection(
            "TALENTS",
            "showcase-talents-section"
        );

        const grid = createElement(
            "div",
            "showcase-talent-grid"
        );

        for (const skill of skills) {
            const talent = createElement(
                "div",
                "showcase-talent"
            );

            const name = cleanGameText(skill.name);
            const level = formatValue(skill.level);

            talent.title = `${name} · Level ${level}`;
            talent.setAttribute("aria-label", talent.title);

            talent.append(
                createImage(
                    skill.icon,
                    name || "Talent",
                    "showcase-talent-icon"
                ),
                createElement(
                    "span",
                    "showcase-talent-level",
                    level
                )
            );

            grid.append(talent);
        }

        if (grid.childElementCount === 0) {
            grid.append(
                createElement(
                    "p",
                    "showcase-empty",
                    "Talent data unavailable"
                )
            );
        }

        section.append(grid);
    }

    function renderConstellations(character) {
        const constellations = character.constellations || [];

        if (constellations.length === 0) {
            return;
        }

        const section = addSection(
            "CONSTELLATIONS",
            "showcase-constellations-section"
        );

        const grid = createElement(
            "div",
            "showcase-constellation-grid"
        );

        for (const constellation of constellations) {
            const active = Boolean(constellation.activated);
            const name = cleanGameText(constellation.name);
            const description = cleanGameText(
                constellation.description
            );

            const item = createElement(
                "div",
                `showcase-constellation${active ? " is-active" : ""}`
            );

            item.title = [
                name,
                description,
                active ? "Unlocked" : "Locked"
            ].filter(Boolean).join("\n");

            item.setAttribute("aria-label", item.title);

            item.append(
                createImage(
                    constellation.icon,
                    name || "Constellation",
                    "showcase-constellation-icon"
                ),
                createElement(
                    "span",
                    "showcase-constellation-number",
                    formatValue(constellation.pos)
                )
            );

            grid.append(item);
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

        modal.dataset.element = String(
            character.element || ""
        ).toLowerCase();

        modal.dataset.rarity = String(character.rarity || "");
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
        modal.dataset.element = (
            card.dataset.element || ""
        ).toLowerCase();

        modal.dataset.rarity = card.dataset.rarity || "";
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