// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
/* =========================================================
   PLANNER — BUTTON SELECTORS
   ========================================================= */

function createPlannerButtonSelectors(form, editor, editorDialog) {
    const selectors = form.querySelectorAll(
        "[data-planner-constellation], " +
            "[data-planner-level], " +
            "[data-planner-weapon-level], " +
            "[data-planner-current-weapon-level-input], " +
            "[data-planner-talent]",
    );

    let activeMenu = null;
    let activeTrigger = null;

    function close() {
        if (activeMenu) {
            activeMenu.remove();
            activeMenu = null;
        }

        if (activeTrigger) {
            activeTrigger.setAttribute("aria-expanded", "false");
            activeTrigger = null;
        }
    }

    function positionMenu(menu, trigger) {
        const rect = trigger.getBoundingClientRect();
        const width = Math.min(260, window.innerWidth - 24);
        const centredLeft = rect.left + rect.width / 2 - width / 2;
        const left = Math.max(12, Math.min(centredLeft, window.innerWidth - width - 12));

        menu.style.width = `${width}px`;
        menu.style.left = `${left}px`;

        const height = menu.offsetHeight;
        const below = window.innerHeight - rect.bottom;

        if (below >= height + 12 || rect.top < height + 12) {
            menu.style.top = `${rect.bottom + 6}px`;
        } else {
            menu.style.top = `${rect.top - height - 6}px`;
        }
    }

    function open(select, trigger) {
        if (activeTrigger === trigger) {
            close();
            return;
        }

        close();

        const menu = document.createElement("div");
        menu.className = "planner-choice-menu";
        menu.setAttribute("role", "group");
        menu.setAttribute("aria-label", trigger.getAttribute("aria-label") || "Choose a value");

        const grid = document.createElement("div");
        grid.className = "planner-choice-grid";

        const isConstellation = select.matches("[data-planner-constellation]");
        const isCurrentWeaponLevel = select.matches("[data-planner-current-weapon-level-input]");

        Array.from(select.options)
            .filter((option) => !option.disabled && !option.hidden)
            .forEach((option) => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "cyrene-button planner-choice-option";

                button.textContent = isConstellation
                    ? `C${option.value}`
                    : select.matches("[data-planner-talent]")
                      ? option.value
                      : `Lv. ${option.value}`;

                const selected = select.value === option.value;

                button.classList.toggle("is-selected", selected);
                button.setAttribute("aria-pressed", String(selected));

                button.addEventListener("click", () => {
                    select.value = option.value;

                    select.dispatchEvent(new Event("change", { bubbles: true }));

                    const selectedOption = select.selectedOptions[0];

                    trigger.querySelector(".planner-choice-value").textContent = isConstellation
                        ? `C${select.value}`
                        : select.matches("[data-planner-talent]")
                          ? select.value
                          : `Lv. ${select.value}`;

                    close();
                    trigger.focus();
                });

                grid.append(button);
            });

        menu.append(grid);
        editor.append(menu);

        activeMenu = menu;
        activeTrigger = trigger;

        trigger.setAttribute("aria-expanded", "true");

        positionMenu(menu, trigger);
    }

    const controls = [];
    const triggers = new Map();

    selectors.forEach((select) => {
        const isCurrentWeaponLevel = select.matches("[data-planner-current-weapon-level-input]");
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "planner-choice-trigger";
        trigger.setAttribute("aria-haspopup", "true");
        trigger.setAttribute("aria-expanded", "false");

        const fieldName =
            select.closest("label")?.querySelector("span")?.textContent.trim() ||
            select
                .closest(".planner-level-value")
                ?.querySelector(":scope > span")
                ?.textContent.trim() ||
            "Goal";

        trigger.setAttribute("aria-label", `Choose ${fieldName.toLowerCase()}`);

        const existingValue = select
            .closest(".planner-level-value")
            ?.querySelector("[data-planner-current-weapon-level]");
        const value = existingValue || document.createElement("span");
        value.classList.add("planner-choice-value");

        const arrow = document.createElement("span");
        arrow.className = "planner-choice-arrow";
        arrow.setAttribute("aria-hidden", "true");

        trigger.append(value, arrow);

        if (isCurrentWeaponLevel) {
            trigger.classList.add("planner-current-weapon-choice");
        }

        select.classList.add("planner-native-select");
        select.tabIndex = -1;
        select.setAttribute("aria-hidden", "true");

        select.after(trigger);
        triggers.set(select, trigger);

        function sync() {
            const option = select.selectedOptions[0];

            if (select.matches("[data-planner-constellation]")) {
                value.textContent = `C${select.value}`;
            } else if (select.matches("[data-planner-talent]")) {
                value.textContent = select.value;
            } else if (isCurrentWeaponLevel) {
                value.textContent = `Lv. ${select.value}`;
            } else {
                value.textContent = option?.textContent.trim() || `Lv. ${select.value}`;
            }
        }

        trigger.addEventListener("click", () => {
            if (select.disabled) return;
            open(select, trigger);
        });

        select.addEventListener("change", sync);

        controls.push(sync);
        sync();
    });

    document.addEventListener("pointerdown", (event) => {
        if (
            activeMenu &&
            !activeMenu.contains(event.target) &&
            !activeTrigger?.contains(event.target)
        ) {
            close();
        }
    });

    document.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Escape" && activeMenu) {
                event.preventDefault();
                event.stopImmediatePropagation();

                const trigger = activeTrigger;
                close();
                trigger?.focus();
            }
        },
        true,
    );

    editorDialog.addEventListener("scroll", close);
    window.addEventListener("resize", close);

    return {
        close,
        getTrigger(select) {
            return triggers.get(select) || null;
        },
        sync() {
            controls.forEach((update) => update());
        },
    };
}

/* =========================================================
   CHARACTERS — PROGRESSION PLANNER
   ========================================================= */

function initCharacterPlanner() {
    const page = document.querySelector(".characters-page");

    if (!page || page.dataset.plannerInitialised === "true") {
        return;
    }

    /* =====================================================
       REQUIRED ELEMENTS
       ===================================================== */

    const picker = page.querySelector("[data-planner-picker]");
    const editor = page.querySelector("[data-planner-editor]");
    const plannerGrid = page.querySelector("[data-planner-grid]");
    const emptyState = page.querySelector("[data-planner-empty]");

    if (!picker || !editor || !plannerGrid || !emptyState) {
        console.error(
            "Character Planner could not initialise: " +
                "the picker, editor, or planner grid is missing.",
        );
        return;
    }

    const pickerDialog = picker.querySelector(".planner-picker-dialog");
    const pickerSearch = picker.querySelector("[data-planner-character-search]");
    const pickerGrid = picker.querySelector("[data-planner-picker-grid]");
    const pickerEmpty = picker.querySelector("[data-planner-picker-empty]");

    const editorDialog = editor.querySelector(".planner-editor-dialog");
    const form = editor.querySelector("[data-planner-form]");

    if (!pickerDialog || !pickerSearch || !pickerGrid || !pickerEmpty || !editorDialog || !form) {
        console.error(
            "Character Planner could not initialise: " + "required modal elements are missing.",
        );
        return;
    }

    const notesInput = form.querySelector("[data-planner-notes]");
    const constellationInput = form.querySelector("[data-planner-constellation]");
    const levelInput = form.querySelector("[data-planner-level]");
    const weaponLevelInput = form.querySelector("[data-planner-weapon-level]");
    const craftingInput = form.querySelector("[data-planner-crafting]");
    const totalButton = editor.querySelector("[data-planner-total]");
    const totalPanel = editor.querySelector("[data-planner-total-panel]");
    const totalContent = editor.querySelector("[data-planner-total-content]");

    const editorIcon = editor.querySelector("[data-planner-editor-icon]");
    const editorTitle = editor.querySelector("#planner-editor-title");
    const editorSubtitle = editor.querySelector("[data-planner-editor-subtitle]");

    const currentLevelElement = editor.querySelector("[data-planner-current-level]");
    const currentWeaponNameElement = editor.querySelector("[data-planner-current-weapon-name]");
    const currentWeaponIcon = editor.querySelector("[data-planner-weapon-icon]");
    const currentWeaponLevelElement = editor.querySelector("[data-planner-current-weapon-level]");
    const currentWeaponLevelInput = editor.querySelector(
        "[data-planner-current-weapon-level-input]",
    );

    const progressionTabs = Array.from(form.querySelectorAll("[data-planner-tab]"));
    const progressionPanels = Array.from(form.querySelectorAll("[data-planner-panel]"));

    if (
        !notesInput ||
        !constellationInput ||
        !levelInput ||
        !weaponLevelInput ||
        !currentWeaponLevelInput
    ) {
        console.error(
            "Character Planner could not initialise: " + "one or more plan fields are missing.",
        );
        return;
    }

    page.dataset.plannerInitialised = "true";

    /* =====================================================
       CONFIGURATION AND STATE
       ===================================================== */

    const accountId = picker.dataset.accountId || "";
    const accountUid = picker.dataset.plannerAccountUid || "";
    const plannerUserId = picker.dataset.plannerUserId || "";
    const STORAGE_KEY = accountUid ? `cyrene-character-plans-v3-${accountUid}` : null;
    const legacyStorageKey =
        accountUid && plannerUserId
            ? `cyrene-character-plans-v2-${plannerUserId}-${accountUid}`
            : null;
    const pendingKey = STORAGE_KEY ? `${STORAGE_KEY}-pending` : null;

    const pickerButtons = Array.from(pickerGrid.querySelectorAll("[data-planner-character-id]"));

    pickerButtons
        .sort(
            (a, b) =>
                (b.dataset.plannerCharacterRelease || "").localeCompare(
                    a.dataset.plannerCharacterRelease || "",
                ) || a.dataset.plannerCharacterName.localeCompare(b.dataset.plannerCharacterName),
        )
        .forEach((button) => pickerGrid.append(button));
    const pickerFilters = { element: "all", weapon: "all", rarity: "all" };
    const pickerCount = picker.querySelector("[data-planner-picker-count]");

    let plans = loadPlans();
    let plansRevision = 0;
    let databaseSavePromise = Promise.resolve();
    const syncStatus = document.createElement("p");
    syncStatus.className = "planner-sync-status";
    syncStatus.setAttribute("role", "status");
    syncStatus.hidden = true;
    plannerGrid.before(syncStatus);
    let editingId = null;
    let editingPlan = null;
    let weaponCataloguePromise = null;
    const weaponPicker = page.querySelector("[data-planner-weapon-picker]");
    const chooseWeaponButton = form.querySelector("[data-planner-choose-weapon]");
    const syncWeaponButton = form.querySelector("[data-planner-sync-weapon]");
    const weaponStatus = form.querySelector("[data-planner-weapon-status]");
    const weaponSearch = weaponPicker.querySelector("[data-planner-weapon-search]");
    const weaponRarityFilter = weaponPicker.querySelector("[data-planner-weapon-rarity]");
    const weaponPickerStatus = weaponPicker.querySelector("[data-planner-weapon-picker-status]");
    const weaponGrid = weaponPicker.querySelector("[data-planner-weapon-grid]");
    const weaponRetry = weaponPicker.querySelector("[data-planner-weapon-retry]");
    let weaponCatalogue = [];
    let weaponSyncRequestId = 0;
    const ownershipFilter = picker.querySelector("[data-planner-ownership]");
    const ownershipControl = picker.querySelector("[data-planner-ownership-control]");
    const ownershipButton = ownershipControl?.querySelector(".custom-select-button");
    function closeOwnership() {
        ownershipControl?.classList.remove("open");
        ownershipButton?.setAttribute("aria-expanded", "false");
    }
    function setOwnership(value) {
        if (!ownershipFilter || !ownershipControl) return;
        ownershipFilter.value = value;
        ownershipControl.querySelectorAll(".custom-select-option").forEach((option) => {
            const selected = option.dataset.value === value;
            option.classList.toggle("selected", selected);
            option.setAttribute("aria-selected", String(selected));
            if (selected)
                ownershipControl.querySelector(".custom-select-value").textContent =
                    option.textContent;
        });
        closeOwnership();
    }
    ownershipButton?.addEventListener("click", () => {
        const opening = !ownershipControl.classList.contains("open");
        ownershipControl.classList.toggle("open", opening);
        ownershipButton.setAttribute("aria-expanded", String(opening));
    });
    ownershipControl?.querySelectorAll(".custom-select-option").forEach((option) => {
        option.addEventListener("click", () => {
            setOwnership(option.dataset.value);
            filterPicker();
            ownershipButton.focus();
        });
    });
    document.addEventListener("click", (event) => {
        if (!ownershipControl?.contains(event.target)) closeOwnership();
    });
    ownershipControl?.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            closeOwnership();
            ownershipButton.focus();
        } else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            const options = Array.from(ownershipControl.querySelectorAll(".custom-select-option"));
            const index = options.indexOf(document.activeElement);
            ownershipControl.classList.add("open");
            ownershipButton.setAttribute("aria-expanded", "true");
            options[
                (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
            ].focus();
        }
    });
    let previouslyFocused = null;
    let progressionRequestId = 0;
    let costRequestId = 0;
    let currentProgression = null;
    let inventoryPromise = null;
    let loadedInventory = null;
    let craftingUpdaters = [];
    const goalCostCache = new Map();
    const pendingGoalCosts = new Map();
    const UNREPORTED_INVENTORY_IDS = new Set(["104001", "104002", "104011", "104012"]);

    /* =====================================================
       SAVED PLANS
       ===================================================== */

    function loadPlans() {
        try {
            // Recover this user's unsynced v2 edits once. Clean legacy caches must
            // never overwrite the shared server snapshot or resurrect deletions.
            if (
                STORAGE_KEY &&
                legacyStorageKey &&
                localStorage.getItem(`${legacyStorageKey}-pending`) === "true"
            ) {
                const legacy = localStorage.getItem(legacyStorageKey);
                if (legacy !== null && localStorage.getItem(pendingKey) !== "true") {
                    localStorage.setItem(
                        STORAGE_KEY,
                        JSON.stringify(normalisePlans(JSON.parse(legacy))),
                    );
                    localStorage.setItem(pendingKey, "true");
                }
                localStorage.removeItem(`${legacyStorageKey}-pending`);
            }
            const stored = STORAGE_KEY ? localStorage.getItem(STORAGE_KEY) : null;
            const storedPlans = normalisePlans(stored ? JSON.parse(stored) : []);
            if (STORAGE_KEY && stored !== null) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(storedPlans));
            }
            return storedPlans;
        } catch (error) {
            console.warn("Could not load saved character plans.", error);
            return [];
        }
    }

    function normalisePlans(parsed) {
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed
            .filter((plan) => plan && plan.id !== undefined && plan.name && plan.icon)
            .map((plan) => ({
                ...plan,
                constellation: normaliseNumber(plan.constellation, 0, 0, 6),
                currentConstellation: normaliseOptionalNumber(plan.currentConstellation, 0, 6),
                level: normaliseNumber(plan.level, 90, 1, 90),
                talents: normaliseTalents(plan.talents),
                weaponLevel: normaliseNumber(plan.weaponLevel, 90, 1, 90),
                currentLevel: normaliseOptionalNumber(plan.currentLevel, 1, 90),
                currentTalents: Array.isArray(plan.currentTalents)
                    ? plan.currentTalents.map((value) => normaliseOptionalNumber(value, 1, 15))
                    : null,
                currentWeaponLevel: normaliseOptionalNumber(plan.currentWeaponLevel, 1, 90),
                currentWeaponRarity: normaliseOptionalNumber(plan.currentWeaponRarity, 1, 5),
                notes: typeof plan.notes === "string" ? plan.notes : "",
            }));
    }

    function normaliseNumber(value, fallback, min, max) {
        const number = Number(value);

        if (!Number.isFinite(number)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, number));
    }

    function normaliseOptionalNumber(value, min, max) {
        if (value === null || value === undefined || value === "") {
            return null;
        }

        const number = Number(value);

        return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : null;
    }

    function normaliseTalents(values) {
        return [0, 1, 2].map((index) => normaliseNumber(values?.[index], 1, 1, 13));
    }

    function persistPlans() {
        if (!STORAGE_KEY) {
            console.error("Cannot save character plans without a selected account.");
            return false;
        }

        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));

            localStorage.setItem(pendingKey, "true");
            syncStatus.hidden = false;
            syncStatus.textContent = "Saving plans...";
            const snapshot = JSON.parse(JSON.stringify(plans));
            plansRevision++;
            databaseSavePromise = databaseSavePromise
                .catch(() => undefined)
                .then(() => savePlansToDatabase(snapshot));
            databaseSavePromise.catch((error) => {
                console.error("Could not save Character Planner data.", error);
                syncStatus.textContent =
                    "Plans are saved in this browser only. Server save failed; they will retry when you reopen Planner.";
            });

            return true;
        } catch (error) {
            console.error("Could not save character plans.", error);

            return false;
        }
    }

    async function savePlansToDatabase(snapshot, recoverIfMissing = false) {
        const response = await fetch(
            `/api/characters/plans?account_id=${encodeURIComponent(accountId)}`,
            {
                method: "PUT",
                credentials: "same-origin",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ plans: snapshot, recover_if_missing: recoverIfMissing }),
                keepalive: true,
            },
        );

        if (!response.ok) {
            throw new Error("Could not save Character Planner data.");
        }

        const recovered = recoverIfMissing ? await response.json() : null;
        // A queued older save must not acknowledge newer edits.
        if (localStorage.getItem(STORAGE_KEY) === JSON.stringify(snapshot)) {
            if (recovered?.snapshot_exists === true) {
                plans = normalisePlans(recovered.plans);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
                renderPlans();
            }
            localStorage.removeItem(pendingKey);
            syncStatus.hidden = true;
        }
    }

    async function hydratePlansFromDatabase() {
        if (!accountId) {
            return;
        }

        const startingRevision = plansRevision;

        try {
            const response = await fetch(
                `/api/characters/plans?account_id=${encodeURIComponent(accountId)}`,
                {
                    method: "GET",
                    credentials: "same-origin",
                    headers: { Accept: "application/json" },
                },
            );
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload?.error || "Could not load plans.");
            }

            if (plansRevision !== startingRevision) {
                return;
            }

            if (localStorage.getItem(pendingKey) === "true") {
                // Include []: a failed deletion must never resurrect old plans.
                await savePlansToDatabase(JSON.parse(JSON.stringify(plans)));
            } else if (payload?.snapshot_exists === false) {
                // A missing snapshot is different from an intentional [] deletion.
                // Older browser-only plans may have no pending marker at all.
                const legacy = legacyStorageKey ? localStorage.getItem(legacyStorageKey) : null;
                const recovered = plans.length
                    ? plans
                    : normalisePlans(legacy !== null ? JSON.parse(legacy) : []);
                if (recovered.length) {
                    plans = recovered;
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
                    localStorage.setItem(pendingKey, "true");
                    renderPlans();
                    await savePlansToDatabase(JSON.parse(JSON.stringify(plans)), true);
                }
            } else {
                plans = normalisePlans(payload?.plans);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
                renderPlans();
            }
        } catch (error) {
            console.error("Could not synchronise Character Planner data.", error);
            syncStatus.hidden = false;
            syncStatus.textContent =
                "Could not sync Planner. Showing this browser's saved plans; reload to retry.";
        }
    }

    function getPlan(id) {
        return plans.find((plan) => String(plan.id) === String(id));
    }

    function makeElement(tag, className, text = "") {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        element.textContent = text;
        return element;
    }

    function fitAmountText(element, maximumSize, minimumSize) {
        element.style.fontSize = `${maximumSize}px`;

        let size = maximumSize;
        while (element.scrollWidth > element.clientWidth && size > minimumSize) {
            size -= 0.5;
            element.style.fontSize = `${size}px`;
        }
    }

    function makeArrow() {
        const arrow = makeElement("span", "cyrene-arrow");
        arrow.setAttribute("role", "img");
        arrow.setAttribute("aria-label", "to");
        return arrow;
    }

    function makeProgressionValues(current, target, prefix = "") {
        const values = makeElement("div", "planner-card-level-values");
        const hasCurrent = current !== null && current !== undefined;
        const changed = hasCurrent && Number(current) !== Number(target);

        if (hasCurrent && !changed) {
            values.append(makeElement("strong", "", `${prefix}${target}`));
        } else {
            values.append(
                makeElement("strong", "", hasCurrent ? `${prefix}${current}` : `${prefix}—`),
                makeArrow(),
                makeElement("strong", "", `${prefix}${target}`),
            );
        }

        values.classList.toggle("has-goal", changed);
        return values;
    }

    /* =====================================================
       TARGET TALENT FIELDS
       ===================================================== */

    function getTalentTargets() {
        return [1, 2, 3].map((index) => {
            const input = form.querySelector(`[data-planner-talent="${index}"]`);

            return Number(input?.value || 10);
        });
    }

    function setTalentTargets(values) {
        const targets = normaliseTalents(values);

        [1, 2, 3].forEach((index) => {
            const input = form.querySelector(`[data-planner-talent="${index}"]`);

            if (input) {
                input.value = String(targets[index - 1]);
            }
        });
    }

    function getTalentBonuses(character, talents) {
        const normaliseText = (value) =>
            String(value || "")
                .replace(/<[^>]*>/g, " ")
                .toLocaleLowerCase()
                .replace(/[^a-z0-9]+/g, " ")
                .trim();
        const activeEffects = (character?.constellations || [])
            .filter((item) => item?.activated && [3, 5].includes(Number(item.pos)))
            .map((item) => normaliseText(item.effect));

        return talents.map((talent, index) => {
            const name = normaliseText(talent?.name);
            const matched = name && activeEffects.some((effect) => effect.includes(name));

            return matched || (Number(talent?.level) > 10 && index > 0) ? 3 : 0;
        });
    }

    function setTalentLimits(minimums, maximums) {
        [1, 2, 3].forEach((index) => {
            const select = form.querySelector(`[data-planner-talent="${index}"]`);
            const minimum = minimums[index - 1] || 1;
            const maximum = maximums[index - 1] || 10;

            Array.from(select?.options || []).forEach((option) => {
                const value = Number(option.value);
                const unavailable = value < minimum || value > maximum;
                option.disabled = unavailable;
                option.hidden = unavailable;
            });

            if (select) {
                select.value = String(Math.min(maximum, Math.max(minimum, Number(select.value))));
            }
        });

        plannerSelectors.sync();
    }

    function withoutTalentBonuses(levels, bonuses) {
        return levels.map((level, index) =>
            Math.max(1, Number(level) - Number(bonuses?.[index] || 0)),
        );
    }

    function combinePlanCosts(costs) {
        const groups = ["level", "talents", ...(currentProgression?.weapon ? ["weapon"] : [])];
        if (
            groups.some(
                (group) =>
                    !costs?.[group] || ["unavailable", "invalid"].includes(costs[group].status),
            )
        ) {
            return {
                status: "unavailable",
                items: [],
                message: "Some material costs couldn't be loaded. Please try again.",
            };
        }
        const items = new Map();

        ["level", "talents", "weapon"].forEach((group) => {
            (costs?.[group]?.items || []).forEach((item) => {
                const id = String(item.id);
                const existing = items.get(id);

                if (existing) {
                    existing.amount += Number(item.amount) || 0;
                } else {
                    items.set(id, {
                        ...item,
                        amount: Number(item.amount) || 0,
                    });
                }
            });
        });

        return {
            status: items.size > 0 ? "required" : "complete",
            items: Array.from(items.values()),
            preview: ["level", "talents", "weapon"].some((group) => costs?.[group]?.preview),
            message:
                items.size > 0
                    ? "Combined character, talent, and weapon costs."
                    : "All saved goals are already reached.",
        };
    }

    function isUnowned(plan) {
        return (
            pickerButtons.find(
                (button) => String(button.dataset.plannerCharacterId) === String(plan.id),
            )?.dataset.plannerCharacterOwnership === "unowned"
        );
    }

    function unownedCharacter(plan) {
        const weapon = plan.plannedWeapon;
        return {
            name: plan.name,
            element: plan.element,
            level: 1,
            ascension: 0,
            constellation: 0,
            constellations: [],
            skills: [1, 2, 3].map((id) => ({ id, skill_type: 1, level: 1 })),
            weapon: weapon ? { ...weapon, level: 1, ascension: 0 } : null,
        };
    }

    function characterWeaponType(plan) {
        const type =
            pickerButtons.find(
                (button) => String(button.dataset.plannerCharacterId) === String(plan.id),
            )?.dataset.plannerCharacterWeapon || plan.weaponType;
        return (
            ["Sword", "Claymore", "Polearm", "Bow", "Catalyst"].find(
                (value) => value.toLowerCase() === type?.toLowerCase(),
            ) || ""
        );
    }

    function plannedWeapon(plan, character = null) {
        const equipped = !isUnowned(plan) && plan.weaponSource !== "manual" && character?.weapon;
        const weapon = equipped
            ? {
                  ...equipped,
                  type: characterWeaponType(plan),
                  refinement: Number(equipped.refinement) || 1,
              }
            : plan.plannedWeapon;
        return weapon
            ? {
                  ...weapon,
                  level:
                      plan.weaponSource === "manual"
                          ? normaliseNumber(
                                plan.currentWeaponLevel,
                                Number(weapon.level) || 1,
                                1,
                                90,
                            )
                          : Number(weapon.level) || 1,
                  ascension:
                      weapon.ascension ??
                      (Number(
                          plan.weaponSource === "manual"
                              ? plan.currentWeaponLevel
                              : weapon.level || 1,
                      ) === 1
                          ? 0
                          : undefined),
              }
            : null;
    }

    function closeWeaponPicker() {
        closeWeaponRarity();
        if (weaponPicker.open) weaponPicker.close();
        chooseWeaponButton.focus();
    }

    function selectWeapon(weapon) {
        const plan = editingPlan;
        if (!plan) return;
        weaponSyncRequestId++;
        syncWeaponButton.disabled = false;
        syncWeaponButton.textContent = "Sync from HoYoLAB";
        plan.weaponSource = "manual";
        plan.plannedWeapon = weapon ? { ...weapon, level: 1, ascension: 0 } : null;
        plan.currentWeaponLevel = weapon ? 1 : null;
        plan.currentWeaponRarity = weapon ? Number(weapon.rarity) || 5 : null;
        plan.weaponLevel = 1;
        weaponLevelInput.value = "1";
        weaponStatus.textContent = "";
        closeWeaponPicker();
        loadCurrentProgression(plan, ++progressionRequestId);
    }

    function renderWeaponChoices() {
        const plan = editingPlan;
        if (!plan) return;
        const type = characterWeaponType(plan);
        const query = weaponSearch.value.trim().toLocaleLowerCase();
        const availableWeapons = weaponCatalogue.filter(
            (weapon) =>
                (!weapon.unreleased ||
                    document.documentElement.dataset.showUnreleased === "true") &&
                weapon.type?.toLowerCase() === type?.toLowerCase(),
        );
        const weapons = availableWeapons
            .filter(
                (weapon) =>
                    (!weaponRarityFilter.value ||
                        Number(weapon.rarity) === Number(weaponRarityFilter.value)) &&
                    `${weapon.name} ${weapon.tag?.label || ""}`.toLocaleLowerCase().includes(query),
            )
            .sort(
                (a, b) =>
                    b.rarity - a.rarity ||
                    (b.release_version || "0").localeCompare(a.release_version || "0", undefined, {
                        numeric: true,
                    }) ||
                    a.name.localeCompare(b.name),
            );
        weaponGrid.replaceChildren();
        const shownCount = makeElement("strong");
        shownCount.textContent = String(weapons.length);
        const baseCount = makeElement("strong");
        baseCount.textContent = String(availableWeapons.length);
        const totalCount = makeElement("strong");
        totalCount.textContent = String(availableWeapons.length);
        const divider = makeElement("span", "characters-count-divider");
        divider.textContent = "|";
        divider.setAttribute("aria-hidden", "true");
        weaponPickerStatus.replaceChildren(
            "Showing ",
            shownCount,
            " of ",
            baseCount,
            " weapons ",
            divider,
            " ",
            totalCount,
            " Total",
        );
        for (const weapon of weapons) {
            const card = makeElement("button", "weapon-card");
            card.type = "button";
            card.dataset.rarity = String(weapon.rarity);
            card.dataset.weaponId = String(weapon.id);
            card.setAttribute("aria-label", weapon.name);
            card.setAttribute(
                "aria-pressed",
                String(
                    String(plan.plannedWeapon?.id) === String(weapon.id) ||
                        plan.plannedWeapon?.name === weapon.name,
                ),
            );
            const art = makeElement("span", "weapon-art");
            if (weapon.icon?.startsWith("https://")) {
                const image = makeElement("img");
                image.src = weapon.icon;
                image.alt = "";
                image.loading = "lazy";
                image.addEventListener(
                    "error",
                    () => {
                        image.hidden = true;
                    },
                    { once: true },
                );
                art.append(image);
            }
            const stars = makeElement("span", "weapon-badge weapon-stars");
            stars.setAttribute("aria-label", `${weapon.rarity}-star weapon`);
            for (
                let index = 0;
                index < Math.max(1, Math.min(5, Number(weapon.rarity) || 1));
                index++
            ) {
                const star = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                star.setAttribute("viewBox", "0 0 24 24");
                star.setAttribute("aria-hidden", "true");
                const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
                shape.setAttribute(
                    "d",
                    "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z",
                );
                shape.setAttribute("fill", "currentColor");
                star.append(shape);
                stars.append(star);
            }
            art.append(stars);
            const body = makeElement("span", "weapon-body");
            body.append(
                makeElement("span", "weapon-type", weapon.type),
                makeElement("strong", "weapon-name", weapon.name),
            );
            const tag = weapon.tag;
            const pill = makeElement("span", "weapon-tag", tag?.label || "Source unavailable");
            pill.dataset.kind = tag?.kind || "source";
            pill.dataset.source = tag?.source || tag?.label || "";
            if (tag?.kind === "signature") pill.title = `${tag.label} - Acquisition: ${tag.source}`;
            body.append(pill);
            card.append(art, body);
            card.addEventListener("click", () => selectWeapon(weapon));
            weaponGrid.append(card);
        }
    }

    async function loadWeaponChoices(plan) {
        weaponGrid.replaceChildren();
        weaponRetry.hidden = true;
        weaponPickerStatus.textContent = "Loading weapons...";
        try {
            weaponCataloguePromise ??= fetch(
                `/api/weapons?account_id=${encodeURIComponent(accountId)}`,
                { credentials: "same-origin" },
            )
                .then(async (response) => {
                    const data = await response.json();
                    if (!response.ok || data.catalogue_error || !Array.isArray(data.catalogue))
                        throw new Error(data.catalogue_error || "Could not load weapons.");
                    return data.catalogue;
                })
                .catch((error) => {
                    weaponCataloguePromise = null;
                    throw error;
                });
            const weapons = await weaponCataloguePromise;
            if (editingPlan !== plan || !weaponPicker.open) return;
            weaponCatalogue = weapons;
            renderWeaponChoices();
        } catch (error) {
            if (editingPlan !== plan || !weaponPicker.open) return;
            weaponPickerStatus.textContent = error.message || "Couldn't load weapons.";
            weaponRetry.hidden = false;
        }
    }

    chooseWeaponButton.addEventListener("click", () => {
        if (!editingPlan) return;
        plannerSelectors.close();
        weaponSearch.value = "";
        weaponRarityFilter.value = "";
        syncWeaponRarity();
        closeWeaponRarity();
        weaponPicker.querySelector("[data-planner-weapon-picker-description]").textContent =
            `Choose a weapon for ${editingPlan.name}.`;
        weaponPicker.showModal();
        weaponSearch.focus();
        loadWeaponChoices(editingPlan);
    });
    weaponSearch.addEventListener("input", renderWeaponChoices);
    const weaponRarityControl = weaponPicker.querySelector("[data-planner-weapon-rarity-control]");
    const weaponRarityButton = weaponRarityControl.querySelector(".custom-select-button");
    function closeWeaponRarity() {
        weaponRarityControl.classList.remove("open");
        weaponRarityButton.setAttribute("aria-expanded", "false");
    }
    function syncWeaponRarity() {
        weaponRarityButton.querySelector(".custom-select-value").textContent =
            weaponRarityFilter.selectedOptions[0].textContent;
        weaponRarityControl.querySelectorAll("[data-value]").forEach((option) => {
            const selected = option.dataset.value === weaponRarityFilter.value;
            option.classList.toggle("selected", selected);
            option.setAttribute("aria-selected", String(selected));
        });
    }
    weaponRarityButton.addEventListener("click", () => {
        const open = weaponRarityControl.classList.toggle("open");
        weaponRarityButton.setAttribute("aria-expanded", String(open));
    });
    weaponRarityControl.querySelectorAll("[data-value]").forEach((option) =>
        option.addEventListener("click", () => {
            weaponRarityFilter.value = option.dataset.value;
            syncWeaponRarity();
            closeWeaponRarity();
            renderWeaponChoices();
            weaponRarityButton.focus();
        }),
    );
    weaponPicker.addEventListener("pointerdown", (event) => {
        if (!weaponRarityControl.contains(event.target)) closeWeaponRarity();
    });
    weaponRarityControl.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && weaponRarityControl.classList.contains("open")) {
            event.preventDefault();
            event.stopPropagation();
            closeWeaponRarity();
            weaponRarityButton.focus();
        }
    });
    weaponRarityFilter.addEventListener("change", () => {
        syncWeaponRarity();
        renderWeaponChoices();
    });
    weaponPicker.querySelector("[data-planner-weapon-reset]").addEventListener("click", () => {
        weaponSearch.value = "";
        weaponRarityFilter.value = "";
        syncWeaponRarity();
        closeWeaponRarity();
        renderWeaponChoices();
    });
    weaponPicker
        .querySelector("[data-planner-weapon-clear]")
        .addEventListener("click", () => selectWeapon(null));
    weaponPicker
        .querySelector("[data-planner-weapon-picker-close]")
        .addEventListener("click", closeWeaponPicker);
    weaponRetry.addEventListener("click", () => loadWeaponChoices(editingPlan));
    weaponPicker.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeWeaponPicker();
    });
    weaponPicker.addEventListener("click", (event) => {
        if (event.target !== weaponPicker) return;
        const rect = weaponPicker.getBoundingClientRect();
        if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
        )
            closeWeaponPicker();
    });
    syncWeaponButton.addEventListener("click", async () => {
        const plan = editingPlan;
        if (!plan || isUnowned(plan)) return;
        const requestId = ++weaponSyncRequestId;
        syncWeaponButton.disabled = true;
        syncWeaponButton.textContent = "Syncing...";
        weaponStatus.textContent = "";
        try {
            const response = await fetch(
                `/api/characters/${encodeURIComponent(plan.id)}/showcase?account_id=${encodeURIComponent(accountId)}`,
                {
                    credentials: "same-origin",
                    cache: "no-store",
                    headers: { Accept: "application/json", "X-Cyrene-Loading": "syncing" },
                },
            );
            const payload = await response.json();
            if (!response.ok)
                throw new Error(payload?.error || "Couldn't sync the equipped weapon.");
            const character = Array.isArray(payload.data)
                ? payload.data[0]
                : payload.data?.characters?.[0];
            if (!character?.weapon?.name || !Number.isFinite(Number(character.weapon.level)))
                throw new Error("HoYoLAB didn't return an equipped weapon. Try again.");
            if (editingPlan !== plan || requestId !== weaponSyncRequestId || editor.hidden) return;
            plan.weaponSource = "hoyolab";
            plan.plannedWeapon = plannedWeapon(plan, character);
            plan.weaponLevel = Math.max(
                Number(plan.weaponLevel) || 1,
                Number(character.weapon.level),
            );
            weaponLevelInput.value = String(plan.weaponLevel);
            await loadCurrentProgression(plan, ++progressionRequestId, character);
        } catch (error) {
            if (editingPlan === plan && requestId === weaponSyncRequestId)
                weaponStatus.textContent =
                    error.message || "Couldn't sync the equipped weapon. Try again.";
        } finally {
            if (editingPlan === plan && requestId === weaponSyncRequestId) {
                syncWeaponButton.disabled = false;
                syncWeaponButton.textContent = "Sync from HoYoLAB";
            }
        }
    });

    async function loadGoalCostPayload(requestUrl) {
        if (goalCostCache.has(requestUrl)) return goalCostCache.get(requestUrl);
        if (pendingGoalCosts.has(requestUrl)) return pendingGoalCosts.get(requestUrl);
        const pending = (async () => {
            const response = await fetch(requestUrl, {
                credentials: "same-origin",
                headers: { Accept: "application/json", "X-Cyrene-Loading": "materials" },
            });
            const message =
                response.status === 401 || response.status === 403 || response.redirected
                    ? "Your session may have expired. Sign in again to load materials."
                    : "Couldn't load material data from the server. Please try again.";
            let payload;
            try {
                payload = await response.json();
            } catch {
                throw new Error(message);
            }
            if (!response.ok)
                throw new Error(typeof payload?.error === "string" ? payload.error : message);
            if (
                !payload?.costs ||
                typeof payload.costs !== "object" ||
                Array.isArray(payload.costs)
            )
                throw new Error(message);
            // Failed sections must be retried rather than preserved in the cache.
            if (
                ["level", "talents", "weapon"].every(
                    (key) =>
                        payload.costs[key] &&
                        !["unavailable", "invalid"].includes(payload.costs[key].status),
                )
            ) {
                goalCostCache.set(requestUrl, payload);
                if (goalCostCache.size > 20)
                    goalCostCache.delete(goalCostCache.keys().next().value);
            }
            return payload;
        })();
        pendingGoalCosts.set(requestUrl, pending);
        try {
            return await pending;
        } finally {
            pendingGoalCosts.delete(requestUrl);
        }
    }

    async function loadPlanTotal(plan, target) {
        if (String(plan.id) !== editingId) return;
        target.replaceChildren(makeElement("p", "planner-cost-message", "Calculating total..."));
        target.setAttribute("aria-busy", "true");
        // The editor already owns current progression and selected weapon state.
        // Its latest calculation also supplies Total, avoiding another showcase request.
        if (currentProgression) await updateGoalCosts();
    }

    /* =====================================================
       PLAN CARD RENDERING
       ===================================================== */

    let cardDrag = null;

    function finishCardDrag(commit = false) {
        const drag = cardDrag;
        if (!drag) return;
        cardDrag = null;
        clearTimeout(drag.timer);
        drag.preview?.remove();
        drag.card.classList.remove("is-dragging");
        if (drag.card.hasPointerCapture(drag.pointerId))
            drag.card.releasePointerCapture(drag.pointerId);
        if (!drag.active) return;
        if (commit) {
            const ids = [...plannerGrid.querySelectorAll(".planner-character-card")].map(
                (card) => card.dataset.planId,
            );
            const byId = new Map(plans.map((plan) => [String(plan.id), plan]));
            const visible = new Set(ids);
            let index = 0;
            plans = plans.map((plan) =>
                visible.has(String(plan.id)) ? byId.get(ids[index++]) : plan,
            );
            persistPlans();
        } else {
            renderPlans();
        }
    }

    document.addEventListener("pointerup", (event) => {
        if (cardDrag?.pointerId === event.pointerId) finishCardDrag(true);
    });
    document.addEventListener("pointercancel", (event) => {
        if (cardDrag?.pointerId === event.pointerId) finishCardDrag();
    });

    window.addEventListener("blur", () => finishCardDrag());

    function enableCardReordering(card) {
        card.addEventListener("pointerdown", (event) => {
            if (
                event.button !== 0 ||
                !event.isPrimary ||
                event.target.closest("button, a, input, select, textarea")
            )
                return;
            finishCardDrag();
            const drag = {
                card,
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                active: false,
                timer: null,
                preview: null,
            };
            cardDrag = drag;
            drag.timer = window.setTimeout(() => {
                if (cardDrag !== drag || !card.isConnected) return;
                drag.active = true;
                const rect = card.getBoundingClientRect();
                drag.left = rect.left;
                drag.top = rect.top;
                drag.preview = card.cloneNode(true);
                drag.preview.classList.add("planner-card-drag-preview");
                drag.preview.setAttribute("aria-hidden", "true");
                drag.preview.removeAttribute("tabindex");
                drag.preview.style.width = `${rect.width}px`;
                drag.preview.style.height = `${rect.height}px`;
                drag.preview.style.left = `${rect.left}px`;
                drag.preview.style.top = `${rect.top}px`;
                document.body.append(drag.preview);
                card.classList.add("is-dragging");
                card.setPointerCapture(event.pointerId);
                window.getSelection()?.removeAllRanges();
            }, 250);
        });
        card.addEventListener(
            "touchmove",
            (event) => {
                if (cardDrag?.active) event.preventDefault();
            },
            { passive: false },
        );
        card.addEventListener("dragstart", (event) => event.preventDefault());
        card.addEventListener("pointermove", (event) => {
            const drag = cardDrag;
            if (!drag || drag.card !== card || event.pointerId !== drag.pointerId) return;
            if (!drag.active) {
                if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8)
                    finishCardDrag();
                return;
            }
            event.preventDefault();
            drag.preview.style.left = `${drag.left + event.clientX - drag.x}px`;
            drag.preview.style.top = `${drag.top + event.clientY - drag.y}px`;
            const target = document
                .elementFromPoint(event.clientX, event.clientY)
                ?.closest(".planner-character-card");
            if (!target || target === card || target.parentElement !== plannerGrid) return;
            const cards = [...plannerGrid.children];
            plannerGrid.insertBefore(
                card,
                cards.indexOf(card) < cards.indexOf(target) ? target.nextSibling : target,
            );
            card.setPointerCapture(event.pointerId);
        });
        card.addEventListener("pointerup", () => {
            if (cardDrag?.card === card) finishCardDrag(true);
        });
        card.addEventListener("pointercancel", () => {
            if (cardDrag?.card === card) finishCardDrag();
        });
        card.addEventListener("keydown", (event) => {
            if (
                event.target !== card ||
                !event.altKey ||
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
            )
                return;
            event.preventDefault();
            const index = plans.findIndex((plan) => String(plan.id) === card.dataset.planId);
            const next = index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
            if (next < 0 || next >= plans.length) return;
            [plans[index], plans[next]] = [plans[next], plans[index]];
            persistPlans();
            renderPlans();
            plannerGrid.querySelector(`[data-plan-id="${card.dataset.planId}"]`)?.focus();
        });
    }

    function renderPlans() {
        finishCardDrag();
        plannerGrid.replaceChildren();

        const visiblePlans = plans.filter(
            (plan) =>
                document.documentElement.dataset.showUnreleased === "true" ||
                pickerButtons.find(
                    (button) => String(button.dataset.plannerCharacterId) === String(plan.id),
                )?.dataset.unreleased !== "true",
        );
        const hasPlans = visiblePlans.length > 0;

        emptyState.hidden = hasPlans;
        plannerGrid.hidden = !hasPlans;

        const currentLevels = new Map(
            pickerButtons.map((button) => [
                String(button.dataset.plannerCharacterId),
                Number(button.dataset.plannerCharacterLevel) || null,
            ]),
        );

        visiblePlans.forEach((plan) => {
            const card = makeElement("article", "planner-character-card");

            const image = makeElement("img");
            image.src = plan.icon;
            image.alt = plan.name;
            image.loading = "lazy";

            card.dataset.unreleased =
                pickerButtons.find(
                    (button) => String(button.dataset.plannerCharacterId) === String(plan.id),
                )?.dataset.unreleased || "false";
            card.dataset.planId = String(plan.id);
            card.tabIndex = 0;
            card.setAttribute(
                "aria-label",
                `${plan.name} plan. Hold to drag, or use Alt and arrow keys to reorder.`,
            );
            card.dataset.rarity = String(plan.rarity || 4);
            card.dataset.element = (plan.element || "").toLocaleLowerCase();

            const portrait = makeElement("div", "planner-card-portrait");
            const identity = makeElement("div", "planner-card-identity");
            const name = makeElement("h3", "", plan.name);
            const elementBadge = makeElement("span", "planner-card-element");
            const elementIcon = makeElement("img");
            elementIcon.src = `/static/images/characters/Element_${plan.element}.webp`;
            elementIcon.alt = plan.element || "Element";
            elementIcon.title = plan.element || "Element";
            elementBadge.append(elementIcon);
            identity.append(name, elementBadge);
            if (card.dataset.unreleased === "true")
                identity.append(
                    makeElement(
                        "span",
                        "cyrene-unreleased-badge planner-card-unreleased",
                        "Unreleased",
                    ),
                );
            const constellationBadge = makeElement("span", "planner-card-constellation");
            const constellationChanged =
                plan.currentConstellation != null &&
                plan.currentConstellation !== plan.constellation;
            if (constellationChanged) {
                constellationBadge.append(
                    makeElement("span", "", `C${plan.currentConstellation}`),
                    makeArrow(),
                    makeElement("span", "", `C${plan.constellation}`),
                );
            } else {
                constellationBadge.textContent = `C${plan.constellation}`;
            }
            constellationBadge.classList.toggle("has-goal", constellationChanged);
            portrait.append(image, constellationBadge, identity);

            const content = makeElement("div", "planner-card-content");
            const goals = makeElement("div", "planner-card-goals");
            const levelGoal = makeElement("div", "planner-card-goal");
            const currentLevel = currentLevels.get(String(plan.id)) || plan.currentLevel;
            const levelValues = makeProgressionValues(currentLevel, plan.level, "Lv. ");
            levelGoal.append(makeElement("span", "", "Character level"), levelValues);

            goals.append(levelGoal);

            const talentRow = makeElement("div", "planner-card-talents");
            const talentLabels = [
                ["N", "Normal Attack"],
                ["E", "Elemental Skill"],
                ["Q", "Elemental Burst"],
            ];

            plan.talents.forEach((value, index) => {
                const talent = makeElement("div", "planner-card-talent");
                const currentTalent = plan.currentTalents?.[index];
                talent.setAttribute(
                    "aria-label",
                    `${talentLabels[index][1]} level ` +
                        `${currentTalent ?? "unknown"} to ${value}`,
                );
                talent.title = talentLabels[index][1];
                const talentValues = makeProgressionValues(currentTalent, value);
                talentValues.classList.add("planner-card-talent-values");
                talent.classList.toggle("has-goal", talentValues.classList.contains("has-goal"));
                const talentKey = makeElement(
                    "span",
                    `planner-card-talent-key talent-${index + 1}`,
                );
                const letter = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                letter.setAttribute("viewBox", "0 0 12 12");
                letter.setAttribute("aria-hidden", "true");
                const strokes = document.createElementNS("http://www.w3.org/2000/svg", "path");
                strokes.setAttribute(
                    "d",
                    [
                        "M2.806 10.026L2.806 1.974L4.388 1.974L7.684 7.351L7.684 1.974L9.194 1.974L9.194 10.026L7.563 10.026L4.316 4.775L4.316 10.026Z",
                        "M2.938 10.026L2.938 1.974L8.909 1.974L8.909 3.336L4.564 3.336L4.564 5.121L8.607 5.121L8.607 6.478L4.564 6.478L4.564 8.67L9.062 8.67L9.062 10.026Z",
                        "M8.755 8.67C9.154 8.955 9.588 9.182 10.057 9.351L9.458 10.499C9.213 10.426 8.973 10.325 8.738 10.197C8.687 10.171 8.326 9.933 7.656 9.483C7.129 9.713 6.545 9.829 5.904 9.829C4.666 9.829 3.697 9.464 2.995 8.736C2.294 8.007 1.943 6.983 1.943 5.665C1.943 4.35 2.295 3.328 2.998 2.597C3.701 1.866 4.655 1.501 5.86 1.501C7.054 1.501 8 1.866 8.7 2.597C9.399 3.328 9.749 4.35 9.749 5.665C9.749 6.361 9.652 6.972 9.458 7.5C9.311 7.902 9.077 8.292 8.755 8.67ZM7.447 7.752C7.656 7.507 7.813 7.21 7.917 6.862C8.021 6.515 8.074 6.115 8.074 5.665C8.074 4.735 7.869 4.04 7.458 3.58C7.048 3.121 6.512 2.891 5.849 2.891C5.186 2.891 4.649 3.122 4.237 3.583C3.825 4.044 3.619 4.738 3.619 5.665C3.619 6.606 3.825 7.31 4.237 7.777C4.649 8.244 5.17 8.477 5.799 8.477C6.034 8.477 6.255 8.439 6.464 8.362C6.135 8.146 5.799 7.978 5.459 7.857L5.915 6.928C6.45 7.111 6.96 7.386 7.447 7.752Z",
                    ][index],
                );
                strokes.setAttribute("fill", "currentColor");
                strokes.setAttribute("fill-rule", "evenodd");
                strokes.setAttribute("stroke-linecap", "round");
                strokes.setAttribute("stroke-linejoin", "round");
                letter.append(strokes);
                talentKey.append(letter);
                talent.append(talentKey, talentValues);
                talentRow.append(talent);
            });

            const weaponMaximum =
                plan.currentWeaponRarity && plan.currentWeaponRarity < 3 ? 70 : 90;
            const weaponGoal = Math.min(plan.weaponLevel, weaponMaximum);
            const weapon = makeElement("div", "planner-card-weapon");
            const weaponLevels = makeElement("div", "planner-card-goal");
            weaponLevels.append(
                makeElement("span", "", "Weapon level"),
                !plan.plannedWeapon && !plan.currentWeaponName
                    ? makeElement("strong", "planner-card-no-weapon", "No weapon")
                    : makeProgressionValues(plan.currentWeaponLevel, weaponGoal, "Lv. "),
            );
            weapon.append(weaponLevels);
            if (plan.currentWeaponIcon || plan.currentWeaponName) {
                const identity = makeElement("div", "planner-card-equipped-weapon");
                if (plan.currentWeaponIcon) {
                    const icon = makeElement("img");
                    icon.src = plan.currentWeaponIcon;
                    icon.alt = "";
                    icon.loading = "lazy";
                    identity.append(icon);
                }
                const name = makeElement("span", "", plan.currentWeaponName || "Equipped weapon");
                name.title = name.textContent;
                identity.append(name);
                weapon.append(identity);
            }

            content.append(goals, talentRow, weapon);

            const actions = makeElement("div", "planner-card-actions");

            const editButton = makeElement("button", "planner-card-edit");
            editButton.append(makeElement("span", "cyrene-edit"));
            editButton.type = "button";
            editButton.title = `Edit ${plan.name}'s plan`;
            editButton.setAttribute("aria-label", `Edit ${plan.name}'s plan`);
            editButton.addEventListener("click", () => {
                openEditor(plan.id);
            });

            const removeButton = makeElement("button", "planner-card-remove");
            const closeIcon = makeElement("span", "cyrene-close");
            closeIcon.setAttribute("aria-hidden", "true");
            removeButton.append(closeIcon);
            removeButton.type = "button";
            removeButton.title = `Remove ${plan.name}'s plan`;
            removeButton.setAttribute("aria-label", `Remove ${plan.name}'s plan`);
            removeButton.addEventListener("click", () => {
                removePlan(plan.id);
            });

            actions.append(editButton, removeButton);
            goals.append(actions);
            card.append(portrait, content);

            if (plan.notes.trim()) {
                const notes = makeElement("p", "planner-card-notes");
                notes.textContent = plan.notes;

                content.append(notes);
            }
            enableCardReordering(card);
            plannerGrid.append(card);
        });
    }

    /* =====================================================
       CHARACTER PICKER
       ===================================================== */

    function filterPicker() {
        const query = pickerSearch.value.trim().toLocaleLowerCase();

        let visibleCount = 0;

        pickerButtons.forEach((button) => {
            const name = (button.dataset.plannerCharacterName || "").toLocaleLowerCase();

            const matches =
                (document.documentElement.dataset.showUnreleased === "true" ||
                    button.dataset.unreleased !== "true") &&
                (!ownershipFilter ||
                    ownershipFilter.value === "all" ||
                    button.dataset.plannerCharacterOwnership === ownershipFilter.value) &&
                name.includes(query) &&
                Object.entries(pickerFilters).every(
                    ([key, value]) =>
                        value === "all" ||
                        (
                            button.dataset[
                                `plannerCharacter${key[0].toUpperCase()}${key.slice(1)}`
                            ] || ""
                        ).toLowerCase() === value,
                );

            button.hidden = !matches;

            if (matches) {
                visibleCount++;
            }
        });

        pickerEmpty.hidden = visibleCount !== 0;
        if (pickerCount) {
            const available = pickerButtons.filter(
                (button) =>
                    document.documentElement.dataset.showUnreleased === "true" ||
                    button.dataset.unreleased !== "true",
            );
            pickerCount.querySelector("[data-count-shown]").textContent = String(visibleCount);
            pickerCount.querySelector("[data-count-base]").textContent = String(available.length);
            pickerCount.querySelector("[data-count-owned]").textContent = String(
                available.filter((button) => button.dataset.plannerCharacterOwnership === "owned")
                    .length,
            );
            pickerCount.querySelector("[data-count-total]").textContent = String(available.length);
        }
    }

    async function openPicker() {
        await hydrationPromise;
        pickerSearch.value = "";
        setOwnership("all");
        filterPicker();

        showModal(picker, pickerDialog);
        pickerSearch.focus();
    }

    function closePicker() {
        closeOwnership();
        hideModal(picker);
    }

    async function addCharacter(button) {
        await hydrationPromise;
        const id = button.dataset.plannerCharacterId;

        if (!id) {
            return;
        }

        let plan = getPlan(id);

        if (!plan) {
            plan = {
                id,
                name: button.dataset.plannerCharacterName || "Unknown character",
                element: button.dataset.plannerCharacterElement || "",
                rarity: Number(button.dataset.plannerCharacterRarity) || 0,
                icon: button.dataset.plannerCharacterIcon || "",
                notes: "",
                constellation: normaliseNumber(
                    button.dataset.plannerCharacterConstellation,
                    0,
                    0,
                    6,
                ),
                currentConstellation: normaliseNumber(
                    button.dataset.plannerCharacterConstellation,
                    0,
                    0,
                    6,
                ),
                currentLevel:
                    normaliseOptionalNumber(button.dataset.plannerCharacterLevel, 1, 90) || 1,
                weaponType: button.dataset.plannerCharacterWeapon,
                level: button.dataset.plannerCharacterOwnership === "unowned" ? 1 : 90,
                talents: [1, 1, 1],
                weaponLevel: button.dataset.plannerCharacterOwnership === "unowned" ? 1 : 90,
            };
        }

        closePicker();
        openEditor(plan.id, plan);
    }

    async function removePlan(id) {
        await hydrationPromise;
        const plan = getPlan(id);

        if (!plan) {
            return;
        }

        const confirmation =
            page.querySelector(".character-plan-delete-dialog") ||
            document.querySelector(".character-plan-delete-dialog");
        if (!confirmation || confirmation.open) return;
        confirmation.querySelector("[data-delete-description]").textContent =
            `Remove ${plan.name}'s saved plan from your Character Planner? This cannot be undone.`;
        confirmation.returnValue = "cancel";
        const confirmed = await new Promise((resolve) => {
            confirmation.addEventListener(
                "close",
                () => resolve(confirmation.returnValue === "delete"),
                { once: true },
            );
            confirmation.querySelector("[data-delete-confirm]").onclick = () =>
                confirmation.close("delete");
            confirmation.querySelector("[data-delete-cancel]").onclick = () =>
                confirmation.close("cancel");
            let pressedOutside = false;
            const outside = (event) => {
                const rect = confirmation.getBoundingClientRect();
                return (
                    event.target === confirmation &&
                    (event.clientX < rect.left ||
                        event.clientX > rect.right ||
                        event.clientY < rect.top ||
                        event.clientY > rect.bottom)
                );
            };
            confirmation.onpointerdown = (event) => {
                pressedOutside = outside(event);
            };
            confirmation.onclick = (event) => {
                if (pressedOutside && outside(event)) confirmation.close("cancel");
                pressedOutside = false;
            };
            confirmation.showModal();
        });

        if (!confirmed) {
            return;
        }

        plans = plans.filter((item) => String(item.id) !== String(id));

        persistPlans();
        renderPlans();
        window.showCyreneToast?.(`${plan.name} removed from Character Planner.`);
        try {
            await databaseSavePromise;
        } catch {
            window.showCyreneToast?.(
                `${plan.name} removed in this browser. Sync failed; reload to retry.`,
                "warning",
            );
        }
    }

    /* =====================================================
       MODAL HANDLING
       ===================================================== */

    function showModal(modal, dialog) {
        previouslyFocused = document.activeElement;

        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");

        document.body.classList.add("planner-modal-open");
        dialog.focus();
    }

    function hideModal(modal) {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");

        if (picker.hidden && editor.hidden) {
            document.body.classList.remove("planner-modal-open");
        }

        if (previouslyFocused?.isConnected) {
            previouslyFocused.focus();
        }
    }

    function closeEditor() {
        if (weaponPicker.open) weaponPicker.close();
        weaponSyncRequestId++;
        plannerSelectors.close();
        closeTotalPanel(true);

        progressionRequestId++;
        costRequestId++;
        currentProgression = null;
        editingPlan = null;
        editingId = null;

        hideModal(editor);
    }

    function closeTotalPanel(immediate = false) {
        if (!totalButton || !totalPanel) {
            return;
        }

        editor.classList.remove("is-total-open");
        totalButton.setAttribute("aria-expanded", "false");
        totalPanel.setAttribute("aria-hidden", "true");

        if (immediate) {
            totalPanel.hidden = true;
            return;
        }

        window.setTimeout(() => {
            if (!editor.classList.contains("is-total-open")) {
                totalPanel.hidden = true;
            }
        }, 220);
    }

    function positionTotalBookmark(includePanel = false) {
        if (!totalButton || editor.hidden) {
            return;
        }

        const displayedRect = editorDialog.getBoundingClientRect();
        const currentShift = editor.classList.contains("is-total-open")
            ? Number.parseFloat(
                  getComputedStyle(editor).getPropertyValue("--planner-total-shift"),
              ) || 0
            : 0;
        const rect = {
            top: displayedRect.top,
            left: displayedRect.left + currentShift,
            right: displayedRect.right + currentShift,
            height: displayedRect.height,
        };
        const constellationTrigger = constellationInput
            .closest(".planner-constellation-field")
            ?.querySelector(".planner-choice-trigger");
        const triggerRect = constellationTrigger?.getBoundingClientRect();
        const bookmarkTop = triggerRect?.top ?? rect.top + 92;
        const bookmarkLeft = Math.min(
            rect.right - 1,
            window.innerWidth - totalButton.offsetWidth - 8,
        );
        totalButton.style.left = `${bookmarkLeft}px`;
        totalButton.style.top = `${bookmarkTop}px`;

        if (!includePanel || !totalPanel) {
            return;
        }

        const panelWidth = Math.min(390, window.innerWidth - 24);
        const minimumShift = Math.max(0, rect.right + panelWidth - (window.innerWidth - 12));
        const maximumShift = Math.max(0, rect.left - 12);
        const shift = Math.min(maximumShift, Math.max(panelWidth / 2, minimumShift));
        const panelHeight = Math.max(280, rect.height - 72);
        const panelTop = rect.top + (rect.height - panelHeight) / 2;

        editor.style.setProperty("--planner-total-shift", `${shift}px`);
        editor.style.setProperty(
            "--planner-total-bookmark-x",
            `${rect.right - shift - bookmarkLeft}px`,
        );
        editor.style.setProperty("--planner-total-width", `${panelWidth}px`);
        editor.style.setProperty("--planner-total-bookmark-y", `${panelTop - bookmarkTop}px`);
        totalPanel.style.left = `${rect.right - shift}px`;
        totalPanel.style.top = `${rect.top + rect.height / 2}px`;
        totalPanel.style.width = `${panelWidth}px`;
        totalPanel.style.height = `${panelHeight}px`;
    }

    function openTotalPanel() {
        const plan = editingPlan;

        if (!plan || !totalButton || !totalPanel || !totalContent) {
            return;
        }

        totalPanel.hidden = false;
        positionTotalBookmark(true);
        totalPanel.setAttribute("aria-hidden", "false");
        totalButton.setAttribute("aria-expanded", "true");
        void totalPanel.offsetWidth;
        editor.classList.add("is-total-open");

        void loadPlanTotal(
            {
                ...plan,
                level: Number(levelInput.value),
                talents: getTalentTargets(),
                weaponLevel: Number(weaponLevelInput.value),
            },
            totalContent,
        );
    }

    if (typeof ResizeObserver !== "undefined") {
        const totalLayoutObserver = new ResizeObserver(() => {
            window.requestAnimationFrame(() => {
                positionTotalBookmark(editor.classList.contains("is-total-open"));
            });
        });
        totalLayoutObserver.observe(editorDialog);
    }

    /* =====================================================
       PROGRESSION TABS
       ===================================================== */

    function activateProgressionTab(name) {
        progressionTabs.forEach((tab) => {
            const active = tab.dataset.plannerTab === name;

            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
        });

        progressionPanels.forEach((panel) => {
            panel.hidden = panel.dataset.plannerPanel !== name;
        });
    }

    progressionTabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            activateProgressionTab(tab.dataset.plannerTab);
        });
    });

    /* =====================================================
       CURRENT PROGRESSION
       ===================================================== */

    function setCurrentProgressionLoading() {
        currentProgression = null;

        if (currentLevelElement) {
            currentLevelElement.textContent = "Loading…";
        }

        if (currentWeaponNameElement) {
            currentWeaponNameElement.textContent = "Loading equipped weapon…";
        }

        if (currentWeaponLevelElement) {
            currentWeaponLevelElement.textContent = "Loading…";
        }

        [1, 2, 3].forEach((index) => {
            const element = form.querySelector(`[data-planner-current-talent="${index}"]`);

            if (element) {
                element.textContent = "Loading…";
            }
        });

        if (currentWeaponIcon) {
            currentWeaponIcon.removeAttribute("src");
            currentWeaponIcon.alt = "";
            currentWeaponIcon.hidden = true;
        }

        currentWeaponIcon?.closest(".planner-weapon-identity")?.removeAttribute("data-rarity");
    }

    function setCurrentProgressionUnavailable() {
        currentProgression = null;
        const manualWeapon = editingPlan?.weaponSource === "manual" && editingPlan?.plannedWeapon;

        if (currentLevelElement) {
            currentLevelElement.textContent = "Unavailable";
        }

        if (currentWeaponNameElement) {
            currentWeaponNameElement.textContent = "Weapon data unavailable";
        }

        if (manualWeapon) {
            setCurrentWeaponLevelMode(
                editingPlan.currentWeaponLevel ?? editingPlan.plannedWeapon.level ?? 1,
                true,
                editingPlan.currentWeaponRarity ?? editingPlan.plannedWeapon.rarity ?? 5,
            );
        } else if (currentWeaponLevelElement) {
            currentWeaponLevelElement.textContent = "Unavailable";
            currentWeaponLevelInput.disabled = true;
            const trigger = plannerSelectors.getTrigger(currentWeaponLevelInput);
            if (trigger) {
                trigger.disabled = true;
                trigger.classList.add("is-readonly");
                trigger.tabIndex = -1;
            }
        }

        [1, 2, 3].forEach((index) => {
            const element = form.querySelector(`[data-planner-current-talent="${index}"]`);

            if (element) {
                element.textContent = "Unavailable";
            }
        });

        if (currentWeaponIcon) {
            currentWeaponIcon.removeAttribute("src");
            currentWeaponIcon.alt = "";
            currentWeaponIcon.hidden = true;
        }

        currentWeaponIcon?.closest(".planner-weapon-identity")?.removeAttribute("data-rarity");
    }

    function setLevelLimits(select, minimum, maximum) {
        const availableOptions = Array.from(select.options).filter((option) => {
            const value = Number(option.value);
            const unavailable = value < minimum || value > maximum;

            option.disabled = unavailable;
            option.hidden = unavailable;
            return !unavailable;
        });

        const selectedOption = select.selectedOptions[0];

        if (!selectedOption || selectedOption.disabled) {
            select.value = availableOptions[0]?.value || String(maximum);
        }

        plannerSelectors.sync();
    }

    function setWeaponLevelLimits(rarity, minimum = 1) {
        const maximum = Number(rarity) < 3 ? 70 : 90;

        setLevelLimits(weaponLevelInput, minimum, maximum);
        return maximum;
    }

    function setCurrentWeaponLevelMode(level, editable, rarity = 5) {
        const maximum = Number(rarity) < 3 ? 70 : 90;
        const target = normaliseNumber(level, 1, 1, maximum);

        setLevelLimits(currentWeaponLevelInput, 1, maximum);
        currentWeaponLevelInput.value = String(target);
        currentWeaponLevelInput.disabled = !editable;

        const trigger = plannerSelectors.getTrigger(currentWeaponLevelInput);
        if (trigger) {
            trigger.disabled = !editable;
            trigger.classList.toggle("is-readonly", !editable);
            trigger.setAttribute("aria-disabled", String(!editable));
            trigger.tabIndex = editable ? 0 : -1;
        }

        plannerSelectors.sync();
        return target;
    }

    async function loadCurrentProgression(plan, requestId, syncedCharacter = null) {
        if (!accountId) {
            setCurrentProgressionUnavailable();
            setGoalCostsMessage("Link an account to calculate costs from current levels.");
            return;
        }

        setCurrentProgressionLoading();

        try {
            const query = `?account_id=${encodeURIComponent(accountId)}`;

            const response = syncedCharacter
                ? { ok: true, json: async () => ({ data: { characters: [syncedCharacter] } }) }
                : isUnowned(plan)
                  ? {
                        ok: true,
                        json: async () => ({ data: { characters: [unownedCharacter(plan)] } }),
                    }
                  : await fetch(`/api/characters/${encodeURIComponent(plan.id)}/showcase${query}`, {
                        method: "GET",
                        credentials: "same-origin",
                        headers: {
                            Accept: "application/json",
                            "X-Cyrene-Loading": "materials",
                        },
                    });

            let payload;

            try {
                payload = await response.json();
            } catch {
                throw new Error("The server returned an invalid response.");
            }

            if (!response.ok) {
                throw new Error(payload?.error || "Couldn't load current progression.");
            }

            const responseData = payload?.data;
            const character = Array.isArray(responseData)
                ? responseData[0]
                : responseData?.characters?.[0];

            if (!character) {
                throw new Error("No detailed character data was returned.");
            }

            // Ignore old responses after switching characters or closing.
            if (requestId !== progressionRequestId || editor.hidden) {
                return;
            }

            if (currentLevelElement) {
                currentLevelElement.textContent =
                    character.level != null ? `Lv. ${character.level}` : "Unavailable";
            }

            const weapon = plannedWeapon(plan, character);
            if (plan.weaponSource !== "manual") plan.plannedWeapon = weapon;
            const weaponComparison = editor.querySelector(
                ".planner-weapon-overview .planner-level-comparison",
            );
            if (weaponComparison) weaponComparison.hidden = !weapon;
            const weaponOverview = editor.querySelector(".planner-weapon-overview");
            if (weaponOverview) weaponOverview.hidden = !weapon;
            const weaponRarity = Number(weapon?.rarity);
            const weaponIdentity = currentWeaponIcon?.closest(".planner-weapon-identity");

            if (weaponIdentity && Number.isFinite(weaponRarity)) {
                weaponIdentity.dataset.rarity = String(weaponRarity);
            }

            if (currentWeaponNameElement) {
                currentWeaponNameElement.textContent = weapon?.name || "No weapon";
            }

            if (currentWeaponIcon) {
                if (weapon?.icon) {
                    currentWeaponIcon.src = weapon.icon;
                    currentWeaponIcon.alt = weapon.name ? `${weapon.name} icon` : "Equipped weapon";
                    currentWeaponIcon.hidden = false;
                } else {
                    currentWeaponIcon.removeAttribute("src");
                    currentWeaponIcon.alt = "";
                    currentWeaponIcon.hidden = true;
                }
            }

            const manualWeapon = plan.weaponSource === "manual";
            if (weapon) {
                setCurrentWeaponLevelMode(weapon.level, manualWeapon, weaponRarity);
            } else {
                currentWeaponLevelInput.disabled = true;
                const trigger = plannerSelectors.getTrigger(currentWeaponLevelInput);
                if (trigger) {
                    trigger.disabled = true;
                    trigger.classList.add("is-readonly");
                    trigger.setAttribute("aria-disabled", "true");
                    trigger.tabIndex = -1;
                }
                if (currentWeaponLevelElement) currentWeaponLevelElement.textContent = "No weapon";
            }

            const talents = getCharacterCombatTalents(character);

            [1, 2, 3].forEach((index) => {
                const element = form.querySelector(`[data-planner-current-talent="${index}"]`);

                const talent = talents[index - 1];

                if (element) {
                    element.textContent =
                        talent?.level != null ? `Lv. ${talent.level}` : "Unavailable";
                }
            });

            const currentTalentLevels = talents.map((talent) => Number(talent.level));
            const talentBonuses = getTalentBonuses(character, talents);
            const talentMaximums = talentBonuses.map((bonus) => 10 + bonus);
            const talentMinimums = currentTalentLevels.map((level) =>
                Number.isFinite(level) ? level : 1,
            );

            setTalentLimits(talentMinimums, talentMaximums);
            plan.talents = plan.talents.map((level, index) =>
                Math.min(talentMaximums[index], Math.max(talentMinimums[index], level)),
            );
            setTalentTargets(plan.talents);

            const currentConstellation = Number(character.constellation);
            const currentCharacterLevel = Number(character.level);
            const currentWeaponLevel = Number(weapon?.level);

            setLevelLimits(
                levelInput,
                Number.isFinite(currentCharacterLevel) ? currentCharacterLevel : 1,
                90,
            );
            setWeaponLevelLimits(
                weaponRarity,
                Number.isFinite(currentWeaponLevel) ? currentWeaponLevel : 1,
            );

            plan.currentLevel = Number(character.level) || plan.currentLevel;
            plan.currentTalents =
                currentTalentLevels.length === 3 && currentTalentLevels.every(Number.isFinite)
                    ? currentTalentLevels
                    : plan.currentTalents;
            plan.currentWeaponLevel = Number(weapon?.level) || null;
            plan.currentWeaponName = weapon?.name || "";
            plan.currentWeaponIcon = weapon?.icon || "";
            plan.currentWeaponRarity = Number.isFinite(weaponRarity) ? weaponRarity : null;
            plan.level = Number(levelInput.value);
            plan.weaponLevel = Number(weaponLevelInput.value);

            if (Number.isFinite(currentConstellation)) {
                plan.currentConstellation = normaliseNumber(currentConstellation, 0, 0, 6);
                plan.constellation = Math.max(plan.constellation, plan.currentConstellation);
                constellationInput.value = String(plan.constellation);
                setLevelLimits(constellationInput, plan.currentConstellation, 6);
            }

            weaponLevelInput.value = String(plan.weaponLevel);
            plannerSelectors.sync();

            if (
                Number.isFinite(Number(character.level)) &&
                currentTalentLevels.length === 3 &&
                currentTalentLevels.every(Number.isFinite)
            ) {
                currentProgression = {
                    name:
                        Number(plan.id) === 10000005 || Number(plan.id) === 10000007
                            ? `Traveler (${character.element || plan.element})`
                            : character.name || plan.name,
                    level: Number(character.level),
                    ascension: character.ascension,
                    talents: currentTalentLevels,
                    talentBonuses,
                    weapon:
                        weapon &&
                        Number.isFinite(Number(weapon.level)) &&
                        Number.isFinite(Number(weapon.rarity))
                            ? {
                                  name: weapon.name || "",
                                  level: Number(weapon.level),
                                  rarity: Number(weapon.rarity),
                                  ascension: weapon.ascension,
                              }
                            : null,
                };

                updateGoalCosts();
            } else {
                setGoalCostsMessage(
                    "Current progression is unavailable, so costs " + "cannot be calculated.",
                );
            }
        } catch (error) {
            if (requestId !== progressionRequestId || editor.hidden) {
                return;
            }

            console.error("Could not load current character progression.", error);

            setCurrentProgressionUnavailable();
            setGoalCostsMessage(
                "Current progression is unavailable, so costs " + "cannot be calculated.",
            );
        }
    }

    /* =====================================================
       GOAL COSTS
       ===================================================== */

    function setGoalCostsMessage(message, loading = false) {
        craftingUpdaters = [];
        const costElements = Array.from(form.querySelectorAll("[data-planner-cost]"));
        if (editor.classList.contains("is-total-open")) costElements.push(totalContent);

        costElements.forEach((element) => {
            element.setAttribute("aria-busy", String(loading));
            element.closest(".planner-goal-cost")?.querySelector(".planner-cost-status")?.remove();
            element.replaceChildren(makeElement("p", "planner-cost-message", message));
        });
    }

    function renderGoalCost(element, cost, inventory = null) {
        element.replaceChildren();
        element.setAttribute("aria-busy", "false");
        const section = element.closest(".planner-goal-cost");
        section?.querySelector(".planner-cost-status")?.remove();

        if (cost?.status === "not_planned") {
            element.append(makeElement("p", "planner-cost-message", cost.message));
            return;
        }
        if (!cost || ["unavailable", "invalid"].includes(cost.status)) {
            element.append(
                makeElement(
                    "p",
                    "planner-cost-message",
                    cost?.message || "Cost information is unavailable.",
                ),
            );
            if (cost?.status !== "invalid") {
                const retry = makeElement(
                    "button",
                    "cyrene-button planner-cost-retry",
                    "Try again",
                );
                retry.type = "button";
                retry.addEventListener("click", () => {
                    goalCostCache.clear();
                    if (!currentProgression && editingPlan)
                        loadCurrentProgression(editingPlan, ++progressionRequestId);
                    else updateGoalCosts();
                });
                element.append(retry);
            }
            return;
        }

        const status = makeElement(
            "span",
            "planner-cost-status",
            cost.status === "complete" ? "Done" : "Required",
        );
        if (cost.status === "complete") {
            const check = makeElement("span", "cyrene-check");
            check.setAttribute("aria-hidden", "true");
            status.prepend(check);
        }
        status.classList.toggle("is-complete", cost.status === "complete");
        section?.querySelector("h3")?.append(status);

        if (cost.status === "complete") {
            element.append(
                makeElement(
                    "p",
                    "planner-cost-complete",
                    cost.message || "This goal is already reached.",
                ),
            );
            return;
        }

        if (cost.preview)
            element.append(
                makeElement(
                    "p",
                    "planner-cost-message",
                    "Preview materials; requirements may change before release.",
                ),
            );
        const grid = makeElement("div", "planner-cost-grid");
        grid.setAttribute("role", "list");
        element.append(grid);

        function inventoryAmount(materialId) {
            const inventoryItem = inventory?.get(String(materialId));
            return Number(inventoryItem?.amount) || 0;
        }
        function craftingPlan() {
            return window.CyrenePlannerMaterials.craftingPlan(
                cost.items,
                new Map(
                    Array.from(inventory || []).map(([id, item]) => [
                        String(id),
                        Number(item.amount) || 0,
                    ]),
                ),
            );
        }

        cost.items.forEach((item) => {
            const wrapper = makeElement("div", "planner-cost-entry");
            wrapper.setAttribute("role", "listitem");
            const tile = makeElement("button", "planner-cost-tile");
            tile.type = "button";
            tile.dataset.rarity = String(item.rarity || 1);
            const requiredAmount = Number(item.amount);
            const exact = requiredAmount.toLocaleString();
            let label = `${item.name}: ${exact} required`;
            let ownedAmount;
            let ownedDisplay = "";
            let ownedIndicator = null;

            const artwork = makeElement("span", "planner-cost-artwork");
            const fallback = makeElement("span", "planner-cost-fallback", item.name);
            artwork.append(fallback);
            if (item.icon) {
                const image = makeElement("img");
                image.alt = "";
                image.src = item.icon;
                image.loading = "lazy";
                image.addEventListener("load", () => {
                    fallback.hidden = true;
                });
                image.addEventListener("error", () => {
                    image.remove();
                });
                artwork.append(image);
            }

            if (inventory instanceof Map) {
                const materialId = String(item.id);
                const owned = inventory.has(materialId)
                    ? inventoryAmount(materialId)
                    : item.inventory_unavailable || UNREPORTED_INVENTORY_IDS.has(materialId)
                      ? null
                      : 0;
                ownedAmount = owned;
                const ownedExact = owned == null ? null : Number(owned).toLocaleString();
                const ownedLabel =
                    ownedExact == null
                        ? "Owned amount unavailable from HoYoLAB"
                        : `${ownedExact} owned`;
                ownedDisplay =
                    owned == null
                        ? "—"
                        : new Intl.NumberFormat("en-GB", {
                              notation: "compact",
                              maximumFractionDigits: 1,
                          }).format(owned);
                ownedIndicator = makeElement("span", "planner-cost-owned", ownedDisplay);
                ownedIndicator.title = ownedLabel;
                ownedIndicator.setAttribute("aria-label", ownedLabel);
                label += `, ${ownedLabel}`;
            }

            const compactFormatter = new Intl.NumberFormat("en-GB", {
                notation: "compact",
                maximumFractionDigits: 1,
            });
            const amount = compactFormatter.format(requiredAmount);
            const quantity = makeElement("strong", "planner-cost-quantity");
            quantity.append(makeElement("span", "planner-cost-required", `\u00d7${amount}`));
            let remainingElement = null;

            if (inventory instanceof Map) {
                remainingElement = makeElement("span", "planner-cost-remaining", "");
                quantity.append(" ", remainingElement);
            }

            tile.append(artwork, quantity);
            const tooltip = makeElement("span", "planner-cost-tooltip", label);
            tooltip.setAttribute("aria-hidden", "true");
            wrapper.append(tile);

            if (ownedIndicator) {
                wrapper.append(ownedIndicator);
            }

            wrapper.append(tooltip);
            grid.append(wrapper);

            const baseLabel = label;

            function updateCraftingDisplay() {
                let updatedLabel = baseLabel;
                tile.classList.remove("is-craft-enough", "is-craft-short");
                quantity.classList.remove("is-enough", "is-craft-enough", "is-short");

                if (ownedIndicator) {
                    ownedIndicator.textContent = ownedDisplay;
                    ownedIndicator.classList.remove("is-craft-gain", "is-craft-spent");
                }

                if (!(inventory instanceof Map) || !remainingElement) {
                    fitAmountText(quantity, 12, 9);
                    if (ownedIndicator) {
                        fitAmountText(ownedIndicator, 10.88, 8);
                    }
                    tile.setAttribute("aria-label", updatedLabel);
                    tile.title = updatedLabel;
                    tooltip.textContent = updatedLabel;
                    return;
                }

                const craftingEnabled = craftingInput?.getAttribute("aria-pressed") === "true";
                const craftResult = craftingPlan().get(String(item.id));
                const effectiveAmount =
                    craftingEnabled && craftResult ? craftResult.after : ownedAmount;
                const remaining =
                    effectiveAmount == null ? null : Math.max(0, requiredAmount - effectiveAmount);
                const remainingDisplay =
                    remaining == null ? "\u2014" : compactFormatter.format(remaining);

                remainingElement.textContent = `(${remainingDisplay})`;
                remainingElement.title =
                    remaining == null
                        ? "Amount left unavailable from HoYoLAB"
                        : craftingEnabled && craftResult
                          ? `${remaining.toLocaleString()} left after crafting`
                          : `${remaining.toLocaleString()} left`;

                if (remaining != null) {
                    if (craftResult?.enoughBeforeCrafting || (!craftResult && remaining === 0)) {
                        quantity.classList.add("is-enough");
                    } else if (craftResult && craftResult.enough) {
                        quantity.classList.add("is-craft-enough");
                    } else {
                        quantity.classList.add("is-short");
                    }

                    if (craftResult && craftingEnabled) {
                        tile.classList.add(
                            craftResult.enough ? "is-craft-enough" : "is-craft-short",
                        );
                        if (ownedIndicator) {
                            if (craftResult.after !== craftResult.before) {
                                ownedIndicator.textContent =
                                    `${compactFormatter.format(craftResult.before)} ` +
                                    `\u2192 ${compactFormatter.format(craftResult.after)}`;
                                ownedIndicator.classList.add(
                                    craftResult.after > craftResult.before
                                        ? "is-craft-gain"
                                        : "is-craft-spent",
                                );
                            }
                        }
                    }

                    updatedLabel += `\n${remaining.toLocaleString()} left to obtain.`;
                }

                fitAmountText(quantity, 12, 9);
                if (ownedIndicator) {
                    fitAmountText(ownedIndicator, 10.88, 8);
                }

                tile.setAttribute("aria-label", updatedLabel);
                tile.title = updatedLabel;
                tooltip.textContent = updatedLabel;
            }

            craftingUpdaters.push(updateCraftingDisplay);
            updateCraftingDisplay();
        });

        if (cost.message) {
            element.append(makeElement("p", "planner-cost-note", cost.message));
        }
    }

    function loadInventory() {
        if (!accountId) {
            return Promise.resolve(null);
        }

        if (inventoryPromise) {
            return inventoryPromise;
        }

        inventoryPromise = fetch(`/api/inventory?account_id=${encodeURIComponent(accountId)}`, {
            method: "GET",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
        })
            .then(async (response) => {
                const payload = await response.json();

                if (!response.ok) {
                    throw new Error(payload?.error || "Couldn't retrieve inventory.");
                }

                loadedInventory = new Map(
                    (payload?.inventory || []).map((item) => [
                        String(item.id),
                        {
                            amount: Number(item.amount) || 0,
                            rarity: Number(item.rarity) || 0,
                            name: item.name || "",
                        },
                    ]),
                );
                return loadedInventory;
            })
            .catch((error) => {
                console.warn("Could not load HoYoLAB inventory for the planner.", error);
                loadedInventory = null;
                return null;
            });

        return inventoryPromise;
    }

    async function updateGoalCosts() {
        const plan = editingPlan;

        if (!plan || !currentProgression) {
            return;
        }

        const requestId = ++costRequestId;
        setGoalCostsMessage("Calculating required materials…", true);

        const parameters = new URLSearchParams({
            character_name: currentProgression.name || plan.name,
            current_level: String(currentProgression.level),
            target_level: levelInput.value,
            current_talents: withoutTalentBonuses(
                currentProgression.talents,
                currentProgression.talentBonuses,
            ).join(","),
            target_talents: withoutTalentBonuses(
                getTalentTargets(),
                currentProgression.talentBonuses,
            ).join(","),
            target_weapon_level: weaponLevelInput.value,
        });

        if (currentProgression.ascension != null) {
            parameters.set("current_ascension", String(currentProgression.ascension));
        }

        if (currentProgression.weapon) {
            if (currentProgression.weapon.ascension != null) {
                parameters.set("weapon_ascension", String(currentProgression.weapon.ascension));
            }
            parameters.set("weapon_name", currentProgression.weapon.name);
            parameters.set("weapon_rarity", String(currentProgression.weapon.rarity));
            parameters.set("current_weapon_level", String(currentProgression.weapon.level));
        }

        try {
            const requestUrl =
                `/api/characters/${encodeURIComponent(plan.id)}` +
                `/planner-costs?${parameters.toString()}`;
            const inventoryRequest = loadInventory();
            const payload = await loadGoalCostPayload(requestUrl);

            if (requestId !== costRequestId || editor.hidden || String(plan.id) !== editingId) {
                return;
            }

            const renderCosts = (inventory) => {
                craftingUpdaters = [];
                form.querySelectorAll("[data-planner-cost]").forEach((element) => {
                    renderGoalCost(
                        element,
                        element.dataset.plannerCost === "weapon" && !currentProgression.weapon
                            ? {
                                  status: "not_planned",
                                  message: "Choose a weapon to plan its upgrades.",
                              }
                            : payload?.costs?.[element.dataset.plannerCost],
                        inventory,
                    );
                });
                if (editor.classList.contains("is-total-open")) {
                    renderGoalCost(totalContent, combinePlanCosts(payload.costs), inventory);
                }
            };

            renderCosts(loadedInventory);

            if (!(loadedInventory instanceof Map)) {
                const inventory = await inventoryRequest;

                if (
                    inventory instanceof Map &&
                    requestId === costRequestId &&
                    !editor.hidden &&
                    String(plan.id) === editingId
                ) {
                    renderCosts(inventory);
                }
            }
        } catch (error) {
            if (requestId !== costRequestId || editor.hidden) {
                return;
            }

            console.error("Could not calculate planner costs.", error);
            setGoalCostsMessage(error.message || "Couldn't calculate goal costs.");
            form.querySelectorAll("[data-planner-cost]").forEach((element) => {
                renderGoalCost(element, { status: "unavailable", message: error.message });
            });
            if (editor.classList.contains("is-total-open")) {
                renderGoalCost(totalContent, {
                    status: "unavailable",
                    message: error.message || "Couldn't calculate the total. Please try again.",
                });
            }
        }
    }

    /* =====================================================
       OPEN AND SAVE EDITOR
       ===================================================== */

    function openEditor(id, draft = null) {
        const saved = getPlan(id) || draft;
        const plan = saved ? JSON.parse(JSON.stringify(saved)) : null;
        editingPlan = plan;

        if (!plan) {
            return;
        }

        plan.weaponSource ||= isUnowned(plan) || plan.plannedWeapon ? "manual" : "hoyolab";
        plan.plannedWeapon ??= null;
        editingId = String(plan.id);
        costRequestId++;

        editorTitle.textContent = plan.name;

        editorSubtitle.textContent =
            `${plan.element || "Unknown element"} · ` + `${plan.rarity || "?"}-star character`;

        editorIcon?.setAttribute("data-rarity", String(plan.rarity));
        weaponSyncRequestId++;
        syncWeaponButton.hidden = isUnowned(plan);
        syncWeaponButton.disabled = false;
        syncWeaponButton.textContent = "Sync from HoYoLAB";
        weaponStatus.textContent = "";
        if (editorIcon) {
            editorIcon.src = plan.icon;
            editorIcon.alt = plan.name;
        }

        notesInput.value = plan.notes || "";
        constellationInput.value = String(plan.constellation ?? 0);
        setLevelLimits(constellationInput, plan.currentConstellation ?? 0, 6);
        levelInput.value = String(plan.level ?? 90);
        weaponLevelInput.value = String(plan.weaponLevel ?? 90);

        setLevelLimits(levelInput, plan.currentLevel ?? 1, 90);
        setWeaponLevelLimits(plan.currentWeaponRarity ?? 5, plan.currentWeaponLevel ?? 1);
        setCurrentWeaponLevelMode(
            plan.currentWeaponLevel ?? plan.plannedWeapon?.level ?? 1,
            plan.weaponSource === "manual" || isUnowned(plan),
            plan.currentWeaponRarity ?? plan.plannedWeapon?.rarity ?? 5,
        );

        setTalentLimits(
            [1, 1, 1],
            plan.talents.map((level) => (level > 10 ? 13 : 10)),
        );
        setTalentTargets(plan.talents);

        plannerSelectors.sync();

        setGoalCostsMessage("Loading current progression…", true);
        activateProgressionTab("level");

        showModal(editor, editorDialog);
        positionTotalBookmark();

        const requestId = ++progressionRequestId;
        loadCurrentProgression(plan, requestId);
    }

    /* =====================================================
       EVENT LISTENERS
       ===================================================== */

    page.querySelectorAll("[data-planner-add]").forEach((button) => {
        button.addEventListener("click", openPicker);
    });

    pickerButtons.forEach((button) => {
        button.addEventListener("click", () => {
            addCharacter(button);
        });
    });

    pickerSearch.addEventListener("input", filterPicker);
    picker.querySelectorAll("[data-planner-filter]").forEach((group) => {
        group.querySelectorAll("button").forEach((button) => {
            button.addEventListener("click", () => {
                pickerFilters[group.dataset.plannerFilter] = button.dataset.value;
                group.querySelectorAll("button").forEach((option) => {
                    const selected = option === button;
                    option.classList.toggle("selected", selected);
                    option.setAttribute("aria-pressed", String(selected));
                });
                filterPicker();
            });
        });
    });
    picker.querySelector("[data-planner-filter-reset]")?.addEventListener("click", () => {
        pickerSearch.value = "";
        setOwnership("all");
        picker
            .querySelectorAll('[data-planner-filter] [data-value="all"]')
            .forEach((button) => button.click());
        filterPicker();
    });

    levelInput.addEventListener("change", updateGoalCosts);
    weaponLevelInput.addEventListener("change", updateGoalCosts);
    currentWeaponLevelInput.addEventListener("change", () => {
        const plan = editingPlan;
        if (!plan || plan.weaponSource !== "manual") return;

        const current = Number(currentWeaponLevelInput.value) || 1;
        plan.currentWeaponLevel = current;
        if (plan.plannedWeapon) {
            plan.plannedWeapon.level = current;
            plan.plannedWeapon.ascension = current === 1 ? 0 : plan.plannedWeapon.ascension;
        }

        setWeaponLevelLimits(plan.currentWeaponRarity ?? plan.plannedWeapon?.rarity ?? 5, current);
        if (Number(weaponLevelInput.value) < current) weaponLevelInput.value = String(current);
        plannerSelectors.sync();
        if (currentProgression?.weapon) currentProgression.weapon.level = current;
        updateGoalCosts();
    });
    form.querySelectorAll("[data-planner-talent]").forEach((input) => {
        input.addEventListener("change", updateGoalCosts);
    });
    craftingInput?.addEventListener("click", () => {
        const enabled = craftingInput.getAttribute("aria-pressed") !== "true";
        craftingInput.setAttribute("aria-pressed", String(enabled));
        craftingUpdaters.forEach((update) => update());
    });
    totalButton?.addEventListener("click", () => {
        if (editor.classList.contains("is-total-open")) {
            closeTotalPanel();
        } else {
            openTotalPanel();
        }
    });

    picker.querySelectorAll("[data-planner-picker-close]").forEach((button) => {
        button.addEventListener("click", closePicker);
    });

    editor.querySelectorAll("[data-planner-editor-close]").forEach((button) => {
        button.addEventListener("click", closeEditor);
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        await hydrationPromise;

        const plan = editingPlan;

        if (!plan) {
            return;
        }

        plan.notes = notesInput.value.trim();
        plan.constellation = Number(constellationInput.value);
        plan.level = Number(levelInput.value);
        plan.talents = getTalentTargets();
        plan.weaponLevel = Number(weaponLevelInput.value);

        const existingIndex = plans.findIndex((item) => String(item.id) === String(plan.id));
        if (existingIndex < 0) plans.push(plan);
        else plans[existingIndex] = plan;
        persistPlans();
        renderPlans();

        closeEditor();
        window.showCyreneToast?.(
            existingIndex < 0
                ? `${plan.name} added to Character Planner.`
                : `${plan.name}'s plan updated.`,
        );
        try {
            await databaseSavePromise;
        } catch {
            window.showCyreneToast?.(
                "Plan kept in this browser. Could not sync; try saving again.",
                "warning",
            );
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && cardDrag) {
            finishCardDrag();
            return;
        }
        if (event.key !== "Escape") {
            return;
        }

        if (weaponPicker.open) {
            event.preventDefault();
            closeWeaponPicker();
            return;
        }

        if (!editor.hidden) {
            closeEditor();
        } else if (!picker.hidden) {
            closePicker();
        }
    });

    /* =====================================================
       INITIAL RENDER
       ===================================================== */

    const plannerSelectors = createPlannerButtonSelectors(form, editor, editorDialog);

    window.addEventListener("cyrene-content-preferences-changed", () => {
        if (!page.isConnected) return;
        renderPlans();
        filterPicker();
    });
    renderPlans();
    filterPicker();
    const hydrationPromise = hydratePlansFromDatabase();
    void hydrationPromise.then(async () => {
        let changed = false;
        plans.forEach((plan) => {
            const character = pickerButtons.find(
                (button) => String(button.dataset.plannerCharacterId) === String(plan.id),
            );
            if (character?.dataset.plannerCharacterOwnership !== "owned") return;

            const currentConstellation = normaliseOptionalNumber(
                character.dataset.plannerCharacterConstellation,
                0,
                6,
            );
            if (currentConstellation !== null) {
                if (plan.currentConstellation !== currentConstellation) changed = true;
                plan.currentConstellation = currentConstellation;
                const constellationGoal = Math.max(plan.constellation, currentConstellation);
                if (plan.constellation !== constellationGoal) changed = true;
                plan.constellation = constellationGoal;
            }

            const currentLevel = normaliseOptionalNumber(
                character.dataset.plannerCharacterLevel,
                1,
                90,
            );
            if (currentLevel !== null) {
                if (plan.currentLevel !== currentLevel) changed = true;
                plan.currentLevel = currentLevel;
                const levelGoal = Math.max(plan.level, currentLevel);
                if (plan.level !== levelGoal) changed = true;
                plan.level = levelGoal;
            }
        });

        if (changed) {
            persistPlans();
            renderPlans();
        }

        await Promise.all(
            plans.map(async (plan) => {
                if (
                    plan.weaponSource === "manual" ||
                    (plan.plannedWeapon && !plan.weaponSource) ||
                    !accountId ||
                    isUnowned(plan)
                )
                    return;
                try {
                    const response = await fetch(
                        `/api/characters/${encodeURIComponent(plan.id)}/showcase?account_id=${encodeURIComponent(accountId)}`,
                        { credentials: "same-origin", headers: { "X-Cyrene-Background": "1" } },
                    );
                    if (!response.ok) return;
                    const data = await response.json();
                    const character = Array.isArray(data.data)
                        ? data.data[0]
                        : data.data?.characters?.[0];
                    const weapon = plannedWeapon({ ...plan, weaponSource: "hoyolab" }, character);
                    if (!weapon || getPlan(plan.id) !== plan) return;
                    plan.weaponSource = "hoyolab";
                    plan.plannedWeapon = weapon;
                    plan.currentWeaponLevel = Number(weapon.level) || 1;
                    plan.currentWeaponRarity = Number(weapon.rarity) || 5;
                    plan.weaponLevel = Math.max(
                        Number(plan.weaponLevel) || 1,
                        plan.currentWeaponLevel,
                    );
                    plan.currentWeaponName = weapon.name || "";
                    plan.currentWeaponIcon = weapon.icon || "";
                    changed = true;
                } catch (error) {
                    console.warn("Could not load the equipped weapon for a planner card.", error);
                }
            }),
        );
        if (changed) {
            persistPlans();
            renderPlans();
        }
    });
}
