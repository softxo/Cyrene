// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
/* =========================================================
   CHARACTERS — SHOWCASE MODAL
   ========================================================= */
function initCharacterShowcase() {
    const page = document.querySelector(".characters-page");
    const modal = page?.querySelector("[data-character-showcase]");
    const dialog = modal?.querySelector(".character-showcase-modal");
    const backgroundVideo = modal?.querySelector("[data-showcase-background]");
    const showcase = modal?.querySelector("[data-showcase-card]");
    const portrait = modal?.querySelector("[data-showcase-portrait]");
    const nameElement = modal?.querySelector("#showcase-character-name");
    const elementElement = modal?.querySelector("[data-showcase-element]");
    const elementIconElement = modal?.querySelector("[data-showcase-element-icon]");
    const levelElement = modal?.querySelector("[data-showcase-level]");
    const rarityElement = modal?.querySelector("[data-showcase-rarity]");
    const statusElement = modal?.querySelector("[data-showcase-status]");
    const weaponElement = modal?.querySelector("[data-showcase-weapon]");
    const statsElement = modal?.querySelector("[data-showcase-stats]");
    const artifactsElement = modal?.querySelector("[data-showcase-artifacts]");
    const setsElement = modal?.querySelector("[data-showcase-sets]");
    const talentsElement = modal?.querySelector("[data-showcase-talents]");
    const constellationsElement = modal?.querySelector("[data-showcase-constellations]");
    const errorElement = modal?.querySelector("[data-showcase-error]");
    if (!page ||
        !modal ||
        !dialog ||
        !showcase ||
        !portrait ||
        !nameElement ||
        !elementElement ||
        !levelElement ||
        !statusElement ||
        !weaponElement ||
        !statsElement ||
        !artifactsElement ||
        !setsElement ||
        !talentsElement ||
        !constellationsElement ||
        !errorElement ||
        modal.dataset.initialised === "true") {
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
    function getPropertyName(property) {
        return cleanGameText(property?.info?.filter_name ??
            property?.info?.name ??
            property?.name ??
            property?.key ??
            "");
    }
    function getPropertyValue(property) {
        return formatValue(property?.formatted ??
            property?.final ??
            property?.value);
    }
    function getProperties(item, ...keys) {
        for (const key of keys) {
            if (Array.isArray(item?.[key])) {
                return item[key];
            }
        }
        return [];
    }
    function getItemImage(item) {
        return (item?.icon ??
            item?.image ??
            item?.icon_url ??
            "");
    }
    function getRarityClass(rarity) {
        const value = Number(rarity);
        return Number.isFinite(value)
            ? `rarity-${value}`
            : "";
    }
    const SHOWCASE_ICON_PATH = "/static/images/characters/showcase/main/";
    const ELEMENT_BACKGROUND_FILES = {
        anemo: "Anemo_BG.mp4",
        geo: "Geo_BG.mp4",
        electro: "Electro_BG.mp4",
        dendro: "Dendro_BG.mp4",
        hydro: "Hydro_BG.mp4",
        pyro: "Pyro_BG.mp4",
        cryo: "Cryo_BG.mp4"
    };
    function setElementBackground(element) {
        if (!backgroundVideo) {
            return;
        }
        const elementKey = String(element || "")
            .trim()
            .toLowerCase();
        const filename = ELEMENT_BACKGROUND_FILES[elementKey];
        if (!filename) {
            backgroundVideo.pause();
            backgroundVideo.removeAttribute("src");
            backgroundVideo.load();
            return;
        }
        const videoPath = `${SHOWCASE_ICON_PATH}${filename}`;
        if (backgroundVideo.getAttribute("src") !== videoPath) {
            backgroundVideo.pause();
            backgroundVideo.src = videoPath;
            backgroundVideo.load();
        }
        backgroundVideo.play().catch(() => {
            // Muted autoplay may be restricted by the browser.
        });
    }
    const ELEMENT_DAMAGE_ICONS = {
        Cryo: "DMG_Cryo.png",
        Pyro: "DMG_Pyro.png",
        Hydro: "DMG_Hydro.png",
        Electro: "DMG_Electro.png",
        Dendro: "DMG_Dendro.png",
        Anemo: "DMG_Anemo.png",
        Geo: "DMG_Geo.png"
    };
    const STAT_ICON_FILES = {
        "maxhp": "HP.png",
        "hp": "HP.png",
        "atk": "ATK.png",
        "baseatk": "ATK.png",
        "def": "DEF.png",
        "elementalmastery": "Elemental_Mastery.png",
        "em": "Elemental_Mastery.png",
        "critrate": "Crit_Rate.png",
        "criticalrate": "Crit_Rate.png",
        "critdmg": "Crit_DMG.png",
        "criticaldamage": "Crit_DMG.png",
        "energyrecharge": "Energy_Recharge.png",
        "er": "Energy_Recharge.png",
        "hppercentage": "HP_Percentage.png",
        "atkpercentage": "ATK_Percentage.png",
        "defpercentage": "DEF_Percentage.png",
        "healingbonus": "HP_Percentage.png",
        "incominghealingbonus": "HP.png"
    };
    function normaliseStatName(value) {
        return String(value ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
    }
    function getElementDamageIcon(element) {
        const filename = ELEMENT_DAMAGE_ICONS[cleanGameText(element)];
        return filename ? `${SHOWCASE_ICON_PATH}${filename}` : "";
    }
    function getStatIcon(statName, element = "") {
        const normalised = normaliseStatName(statName);
        const elementalDamageNames = [
            "cryodmg",
            "cryodamage",
            "pyrodmg",
            "pyrodamage",
            "hydrodmg",
            "hydrodamage",
            "electrodmg",
            "electrodamage",
            "dendrodmg",
            "dendrodamage",
            "anemodmg",
            "anemodamage",
            "geodmg",
            "geodamage"
        ];
        if (normalised.includes("elementaldmg") ||
            normalised.includes("elementaldamage") ||
            elementalDamageNames.includes(normalised)) {
            return getElementDamageIcon(element);
        }
        const filename = STAT_ICON_FILES[normalised];
        return filename ? `${SHOWCASE_ICON_PATH}${filename}` : "";
    }
    function appendStatIcon(container, statName, element = "") {
        const iconPath = getStatIcon(statName, element);
        if (!iconPath) {
            return;
        }
        const icon = createImage(iconPath, "", "enka-stat-icon");
        icon.alt = "";
        icon.setAttribute("aria-hidden", "true");
        icon.loading = "lazy";
        // Avoid broken-image placeholders if an optional icon is unavailable.
        icon.addEventListener("error", () => icon.remove(), { once: true });
        container.append(icon);
    }
    function renderRarityStars(container, rarity) {
        if (!container) {
            return;
        }
        container.replaceChildren();
        const count = Math.max(0, Math.min(5, Number.parseInt(rarity, 10) || 0));
        container.setAttribute("aria-label", `${count}-star character`);
        for (let index = 0; index < count; index++) {
            container.append(createElement("span", "enka-rarity-star", "★"));
        }
    }
    function getPropertyIndex(properties) {
        return new Map(properties.map(property => [
            normaliseStatName(getPropertyName(property)),
            property
        ]));
    }
    function findProperty(index, names) {
        for (const name of names) {
            const match = index.get(normaliseStatName(name));
            if (match) {
                return match;
            }
        }
        return null;
    }
    function formatMissingStat(value, isPercentage = false) {
        if (value === null ||
            value === undefined ||
            value === "" ||
            value === "—") {
            return isPercentage ? "0.0%" : "0";
        }
        return String(value);
    }
    function getStatDisplayValue(property, isPercentage = false) {
        if (!property) {
            return isPercentage ? "0.0%" : "0";
        }
        // Prefer the API's formatted value, which already includes units.
        const formatted = property.formatted;
        if (formatted !== null &&
            formatted !== undefined &&
            formatted !== "") {
            return String(formatted);
        }
        const rawValue = property.final ?? property.value;
        if (rawValue === null ||
            rawValue === undefined ||
            rawValue === "") {
            return isPercentage ? "0.0%" : "0";
        }
        if (isPercentage) {
            const numericValue = Number(rawValue);
            if (Number.isFinite(numericValue)) {
                // Genshin stat APIs can expose percentage stats as either
                // percentage points (e.g. 5.0) or ratios (e.g. 0.05).
                const percentage = Math.abs(numericValue) <= 1
                    ? numericValue * 100
                    : numericValue;
                return `${percentage.toFixed(1)}%`;
            }
            const textValue = String(rawValue);
            return textValue.includes("%")
                ? textValue
                : `${textValue}`;
        }
        return String(rawValue);
    }
    function getCharacterProperties(character) {
        return getProperties(character, "selected_properties", "properties", "stats");
    }
    function renderWeapon(character) {
        weaponElement.replaceChildren();
        const weapon = character?.weapon;
        if (!weapon) {
            weaponElement.append(createElement("p", "enka-empty-value", "No weapon data available"));
            return;
        }
        const panel = createElement("div", "enka-weapon-card");
        const imageWrap = createElement("div", `enka-weapon-image ${getRarityClass(weapon.rarity)}`);
        imageWrap.append(createImage(getItemImage(weapon), weapon.name ?? "Equipped weapon", "enka-weapon-icon"));
        if (weapon.refinement != null) {
            imageWrap.append(createElement("span", "enka-weapon-refinement", `R${weapon.refinement}`));
        }
        if (weapon.level != null) {
            imageWrap.append(createElement("span", "enka-weapon-level", `Lv. ${weapon.level}`));
        }
        const info = createElement("div", "enka-weapon-info");
        info.append(createElement("h4", "enka-weapon-name", cleanGameText(weapon.name ?? "Unknown weapon")));
        const weaponStats = createElement("div", "enka-weapon-stats");
        const mainStat = weapon.main_stat;
        const subStat = weapon.sub_stat;
        const appendWeaponStat = (property, fallbackName) => {
            if (!property) {
                return;
            }
            const name = getPropertyName(property) || fallbackName;
            const value = getPropertyValue(property);
            if (value === "—") {
                return;
            }
            const row = createElement("div", "enka-weapon-stat");
            appendStatIcon(row, name, character?.element);
            row.append(createElement("span", "enka-weapon-stat-name", fallbackName), createElement("strong", "enka-weapon-stat-value", value));
            weaponStats.append(row);
        };
        appendWeaponStat(mainStat, "Base ATK");
        appendWeaponStat(subStat, getPropertyName(subStat) || "Secondary Stat");
        info.append(weaponStats);
        panel.append(imageWrap, info);
        weaponElement.append(panel);
    }
    function renderCombatStats(character) {
        statsElement.replaceChildren();
        const properties = getCharacterProperties(character);
        const propertyIndex = getPropertyIndex(properties);
        const element = cleanGameText(character?.element ?? "");
        const elementalDamageNames = [
            `${element} DMG Bonus`,
            `${element} Damage Bonus`,
            `${element} DMG`,
            `${element} Damage`
        ];
        const statDefinitions = [
            {
                label: "Max HP",
                names: ["Max HP", "HP", "Max Health"],
                icon: "HP.png",
                percentage: false
            },
            {
                label: "Crit Rate",
                names: ["CRIT Rate", "Crit Rate", "Critical Rate"],
                icon: "Crit_Rate.png",
                percentage: true
            },
            {
                label: "ATK",
                names: ["ATK", "Attack"],
                icon: "ATK.png",
                percentage: false
            },
            {
                label: "Crit DMG",
                names: ["CRIT DMG", "Crit DMG", "Critical Damage"],
                icon: "Crit_DMG.png",
                percentage: true
            },
            {
                label: "DEF",
                names: ["DEF", "Defense"],
                icon: "DEF.png",
                percentage: false
            },
            {
                label: "Healing Bonus",
                names: ["Healing Bonus", "Heal Bonus"],
                icon: "HP_Percentage.png",
                percentage: true
            },
            {
                label: "Elemental Mastery",
                names: ["Elemental Mastery", "EM"],
                icon: "Elemental_Mastery.png",
                percentage: false
            },
            {
                label: "Incoming Healing",
                names: ["Incoming Healing Bonus", "Incoming Heal Bonus"],
                icon: "HP.png",
                percentage: true
            },
            {
                label: "Elemental DMG Bonus",
                names: elementalDamageNames,
                icon: getElementDamageIcon(element),
                percentage: true
            },
            {
                label: "Energy Recharge",
                names: ["Energy Recharge", "ER"],
                icon: "Energy_Recharge.png",
                percentage: true
            }
        ];
        statDefinitions.forEach(definition => {
            const property = findProperty(propertyIndex, definition.names);
            const row = createElement("div", "enka-stat-row");
            const label = createElement("div", "enka-stat-name");
            const iconPath = definition.icon.startsWith("/")
                ? definition.icon
                : `${SHOWCASE_ICON_PATH}${definition.icon}`;
            const icon = createImage(iconPath, "", "enka-stat-icon");
            icon.alt = "";
            icon.setAttribute("aria-hidden", "true");
            icon.addEventListener("error", () => icon.remove(), { once: true });
            label.append(icon, createElement("span", "enka-stat-label", definition.label));
            row.append(label, createElement("strong", "enka-stat-value", getStatDisplayValue(property, definition.percentage)));
            statsElement.append(row);
        });
    }
    function renderArtifacts(character) {
        artifactsElement.replaceChildren();
        setsElement.replaceChildren();
        const artifacts = Array.isArray(character?.artifacts)
            ? character.artifacts
            : [];
        const setCounts = new Map();
        artifacts.forEach(artifact => {
            const setName = cleanGameText(artifact?.set?.name ?? "");
            if (setName) {
                setCounts.set(setName, (setCounts.get(setName) ?? 0) + 1);
            }
        });
        function appendArtifactStat(container, property, className = "") {
            if (!property) {
                return;
            }
            const name = getPropertyName(property);
            const value = getPropertyValue(property);
            if (!name || value === "—") {
                return;
            }
            const row = createElement("div", className || "enka-artifact-substat");
            appendStatIcon(row, name, character?.element);
            row.append(createElement("span", "enka-artifact-stat-name", name), createElement("strong", "enka-artifact-stat-value", value));
            container.append(row);
        }
        artifacts.forEach(artifact => {
            const card = createElement("article", `enka-artifact-card ${getRarityClass(artifact?.rarity)}`);
            const header = createElement("div", "enka-artifact-header");
            const imageWrap = createElement("div", "enka-artifact-image-wrap");
            imageWrap.append(createImage(getItemImage(artifact), artifact.name ?? artifact.pos_name ?? "Artefact", "enka-artifact-icon"));
            if (artifact.level != null) {
                imageWrap.append(createElement("span", "enka-artifact-level", `+${artifact.level}`));
            }
            const titleWrap = createElement("div", "enka-artifact-title-wrap");
            titleWrap.append(createElement("h4", "enka-artifact-name", cleanGameText(artifact.pos_name ??
                artifact.name ??
                "Artefact")), createElement("span", "enka-artifact-rarity", "★".repeat(Math.max(0, Math.min(5, Number.parseInt(artifact.rarity, 10) || 0)))));
            header.append(imageWrap, titleWrap);
            const mainStat = createElement("div", "enka-artifact-main-stat");
            appendArtifactStat(mainStat, artifact.main_stat, "enka-artifact-main-stat-row");
            const subStats = createElement("div", "enka-artifact-substats");
            const properties = Array.isArray(artifact.sub_stats)
                ? artifact.sub_stats
                : [];
            properties.slice(0, 4).forEach(property => {
                appendArtifactStat(subStats, property);
            });
            /* Calculate artifact CV from its CRIT substats. */
            let critRate = 0;
            let critDamage = 0;
            properties.forEach(property => {
                const statName = normaliseStatName([
                    property?.info?.filter_name,
                    property?.info?.name,
                    property?.name,
                    property?.key
                ].filter(Boolean).join(" "));
                const isCritRate = statName.includes("critrate") ||
                    statName.includes("criticalrate");
                const isCritDamage = statName.includes("critdmg") ||
                    statName.includes("critdamage") ||
                    statName.includes("criticaldamage");
                if (!isCritRate && !isCritDamage) {
                    return;
                }
                const formatted = property?.formatted;
                const rawValue = formatted ?? property?.final ?? property?.value;
                if (rawValue == null || rawValue === "") {
                    return;
                }
                const value = Number.parseFloat(String(rawValue).replace(/,/g, ".").replace(/%/g, "").trim());
                if (!Number.isFinite(value)) {
                    return;
                }
                // Convert fractional percentages (e.g. 0.078) to percentage points.
                const percentage = formatted == null && Math.abs(value) <= 1
                    ? value * 100
                    : value;
                if (isCritRate) {
                    critRate = percentage;
                }
                else {
                    critDamage = percentage;
                }
            });
            const cv = critDamage + (2 * critRate);
            const cvRow = createElement("div", "enka-artifact-cv", `CV ${cv.toFixed(1)}`);
            cvRow.setAttribute("aria-label", `Artifact Crit Value: ${cv.toFixed(1)}`);
            card.append(header, mainStat, subStats, cvRow);
            artifactsElement.append(card);
        });
        if (!artifacts.length) {
            artifactsElement.append(createElement("p", "enka-empty-value", "Artefact data is unavailable"));
        }
        setCounts.forEach((count, name) => {
            const tag = createElement("div", "enka-artifact-set");
            tag.append(createElement("strong", "enka-artifact-set-count", `${count}pc`), createElement("span", "enka-artifact-set-name", name));
            setsElement.append(tag);
        });
    }
    function renderTalents(character) {
        talentsElement.replaceChildren();
        const skills = Array.isArray(character?.skills)
            ? character.skills
            : [];
        const talents = skills
            .filter(skill => Number(skill.skill_type) === 1)
            .slice(0, 3);
        talents.forEach((talent, index) => {
            const item = createElement("div", "enka-progression-item enka-talent");
            item.append(createImage(getItemImage(talent), talent.name ?? `Talent ${index + 1}`, "enka-progression-icon"));
            item.append(createElement("span", "enka-progression-level", talent.level != null
                ? String(talent.level)
                : "—"));
            item.title = cleanGameText(talent.name ?? `Talent ${index + 1}`);
            talentsElement.append(item);
        });
        if (!talents.length) {
            talentsElement.append(createElement("p", "enka-empty-value", "Talent data unavailable"));
        }
    }
    function renderConstellations(character) {
        constellationsElement.replaceChildren();
        const constellations = Array.isArray(character?.constellations)
            ? character.constellations.slice(0, 6)
            : [];
        for (let index = 0; index < 6; index++) {
            const constellation = constellations[index];
            const number = index + 1;
            const activated = constellation?.activated === true;
            const item = createElement("div", [
                "enka-progression-item",
                "enka-constellation",
                activated ? "is-unlocked" : "is-locked"
            ].join(" "));
            item.dataset.index = String(index);
            if (constellation && getItemImage(constellation)) {
                item.append(createImage(getItemImage(constellation), constellation.name ?? `Constellation ${number}`, "enka-progression-icon"));
            }
            item.append(createElement("span", "enka-constellation-number", String(number)));
            item.title = cleanGameText(constellation?.name ?? `Constellation ${number}`);
            item.setAttribute("aria-label", `Constellation ${number}: ${activated ? "unlocked" : "locked"}`);
            constellationsElement.append(item);
        }
    }
    function renderCharacter(character) {
        weaponElement.replaceChildren();
        statsElement.replaceChildren();
        artifactsElement.replaceChildren();
        setsElement.replaceChildren();
        talentsElement.replaceChildren();
        constellationsElement.replaceChildren();
        renderWeapon(character);
        renderCombatStats(character);
        renderArtifacts(character);
        renderTalents(character);
        renderConstellations(character);
        if (elementIconElement) {
            elementIconElement.replaceChildren();
            const iconPath = getElementDamageIcon(character?.element);
            if (iconPath) {
                const icon = createImage(iconPath, `${character.element} element`, "enka-element-icon");
                icon.addEventListener("error", () => icon.remove(), {
                    once: true
                });
                elementIconElement.append(icon);
            }
        }
        if (rarityElement) {
            renderRarityStars(rarityElement, character?.rarity);
        }
        errorElement.hidden = true;
        errorElement.textContent = "";
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
        const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}/showcase${query}`, {
            method: "GET",
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        });
        let payload;
        try {
            payload = await response.json();
        }
        catch {
            throw new Error("The server returned an invalid response.");
        }
        if (!response.ok) {
            throw new Error(payload?.error || "Couldn't retrieve this character's build.");
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
        showcase.dataset.element = String(character.element || "").toLowerCase();
        setElementBackground(character.element);
        showcase.dataset.rarity = String(character.rarity || "");
        levelElement.textContent =
            `Level ${formatValue(character.level)} · ` +
                `C${formatValue(character.constellation)} · ` +
                `Friendship ${formatValue(character.friendship)}`;
        portrait.src = character.display_image || character.icon || "";
        portrait.alt = character.name || "Character artwork";
        if (elementIconElement) {
            elementIconElement.replaceChildren();
            const iconPath = getElementDamageIcon(character.element);
            if (iconPath) {
                const icon = createImage(iconPath, `${character.element} element`, "enka-element-icon");
                icon.addEventListener("error", () => icon.remove(), {
                    once: true
                });
                elementIconElement.append(icon);
            }
        }
        if (rarityElement) {
            renderRarityStars(rarityElement, character.rarity);
        }
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
        modal.dataset.element = (card.dataset.element || "").toLowerCase();
        setElementBackground(card.dataset.element);
        modal.dataset.rarity = card.dataset.rarity || "";
        levelElement.textContent = card.dataset.level
            ? `Level ${card.dataset.level}`
            : "Level unavailable";
        weaponElement.replaceChildren();
        statsElement.replaceChildren();
        artifactsElement.replaceChildren();
        setsElement.replaceChildren();
        talentsElement.replaceChildren();
        constellationsElement.replaceChildren();
        if (elementIconElement) {
            elementIconElement.replaceChildren();
        }
        if (rarityElement) {
            rarityElement.replaceChildren();
        }
        errorElement.hidden = true;
        errorElement.textContent = "";
        statusElement.textContent = "Loading character build…";
        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");
        document.body.classList.add("character-showcase-open");
        dialog.focus();
        loadCharacter(card, requestId).catch(error => {
            if (requestId !== activeRequestId || modal.hidden) {
                return;
            }
            errorElement.textContent =
                error instanceof Error
                    ? error.message
                    : "Couldn't retrieve this character's build.";
            errorElement.hidden = false;
            statusElement.textContent = "";
        });
    }
    function closeShowcase() {
        if (modal.hidden) {
            return;
        }
        backgroundVideo?.pause();
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
