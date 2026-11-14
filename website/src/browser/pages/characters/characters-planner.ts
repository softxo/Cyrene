// @ts-nocheck -- Legacy global script; types will be tightened incrementally.

function initCharacterPlanner() {
    const {
        createButtonSelectors,
        makeElement,
        makeArrow,
        makeProgressionValues,
        makeWeaponCard,
        renderGoalCost: renderGoalCostTiles,
    } = window.CyrenePlannerRender;
    const {
        safeCharacterIcon,
        elementIcons,
        getTalentBonuses,
        withoutTalentBonuses,
        combinePlanCosts: combineGoalCosts,
        unownedCharacter,
    } = window.CyrenePlannerData;
    const page = document.querySelector(".characters-page");

    if (!page || page.dataset.plannerInitialised === "true") {
        return;
    }

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
                Number(b.dataset.unreleased === "true") - Number(a.dataset.unreleased === "true") ||
                (b.dataset.plannerCharacterRelease || "").localeCompare(
                    a.dataset.plannerCharacterRelease || "",
                ) ||
                a.dataset.plannerCharacterName.localeCompare(b.dataset.plannerCharacterName),
        )
        .forEach((button) => pickerGrid.append(button));

    const pickerFilters = { element: "all", weapon: "all", rarity: "all" };
    const pickerCount = picker.querySelector("[data-planner-picker-count]");
    const state = {
        plans: loadPlans(),
        plansLoading: true,
        lastRenderSignature: "",
        plansRevision: 0,
        databaseSavePromise: Promise.resolve(),
        editingId: null,
        editingPlan: null,
        weaponCataloguePromise: null,
        weaponCatalogue: [],
        weaponSyncRequestId: 0,
        previouslyFocused: null,
        progressionRequestId: 0,
        costRequestId: 0,
        currentProgression: null,
        inventoryPromise: null,
        loadedInventory: null,
        craftingUpdaters: [],
        cardDrag: null,
        refreshingProgression: false,
    };
    const syncStatus = document.createElement("p");

    syncStatus.className = "planner-sync-status";

    syncStatus.setAttribute("role", "status");

    syncStatus.hidden = true;

    plannerGrid.before(syncStatus);

    const weaponPicker = page.querySelector("[data-planner-weapon-picker]");
    const chooseWeaponButton = form.querySelector("[data-planner-choose-weapon]");
    const syncWeaponButton = form.querySelector("[data-planner-sync-weapon]");
    const weaponStatus = form.querySelector("[data-planner-weapon-status]");
    const weaponSearch = weaponPicker.querySelector("[data-planner-weapon-search]");
    const weaponRarityFilter = weaponPicker.querySelector("[data-planner-weapon-rarity]");
    const weaponPickerStatus = weaponPicker.querySelector("[data-planner-weapon-picker-status]");
    const weaponGrid = weaponPicker.querySelector("[data-planner-weapon-grid]");
    const weaponRetry = weaponPicker.querySelector("[data-planner-weapon-retry]");
    const goalCostCache = new Map();
    const pendingGoalCosts = new Map();
    const ctx = {
        state,
        makeElement,
        makeWeaponCard,
        makeArrow,
        makeProgressionValues,
        renderGoalCostTiles,
        safeCharacterIcon,
        elementIcons,
        combineGoalCosts,
        withoutTalentBonuses,
        unownedCharacter,
        getTalentBonuses,
        page,
        picker,
        editor,
        plannerGrid,
        emptyState,
        pickerDialog,
        pickerSearch,
        pickerEmpty,
        editorDialog,
        form,
        constellationInput,
        levelInput,
        weaponLevelInput,
        craftingInput,
        totalButton,
        totalPanel,
        totalContent,
        currentLevelElement,
        currentWeaponNameElement,
        currentWeaponIcon,
        currentWeaponLevelElement,
        currentWeaponLevelInput,
        progressionTabs,
        progressionPanels,
        accountId,
        pickerButtons,
        pickerFilters,
        pickerCount,
        weaponPicker,
        chooseWeaponButton,
        syncWeaponButton,
        weaponStatus,
        weaponSearch,
        weaponRarityFilter,
        weaponPickerStatus,
        weaponGrid,
        weaponRetry,
        goalCostCache,
        pendingGoalCosts,
        normaliseNumber,
        normaliseOptionalNumber,
        normaliseTalents,
        persistPlans,
        getPlan,
        showModal,
        hideModal,
        openEditor,
    };

    Object.assign(ctx, window.CyrenePlannerPicker(ctx));

    Object.assign(ctx, window.CyrenePlannerWeapons(ctx));

    Object.assign(ctx, window.CyrenePlannerCards(ctx));

    Object.assign(ctx, window.CyrenePlannerCosts(ctx));

    Object.assign(ctx, window.CyrenePlannerProgression(ctx));

    function activateProgressionTab(...args) {
        return ctx.activateProgressionTab(...args);
    }

    function addCharacter(...args) {
        return ctx.addCharacter(...args);
    }

    function closePicker(...args) {
        return ctx.closePicker(...args);
    }

    function closeTotalPanel(...args) {
        return ctx.closeTotalPanel(...args);
    }

    function closeWeaponPicker(...args) {
        return ctx.closeWeaponPicker(...args);
    }

    function filterPicker(...args) {
        return ctx.filterPicker(...args);
    }

    function finishCardDrag(...args) {
        return ctx.finishCardDrag(...args);
    }

    function getTalentTargets(...args) {
        return ctx.getTalentTargets(...args);
    }

    function isUnowned(...args) {
        return ctx.isUnowned(...args);
    }

    function loadCurrentProgression(...args) {
        return ctx.loadCurrentProgression(...args);
    }

    function openPicker(...args) {
        return ctx.openPicker(...args);
    }

    function openTotalPanel(...args) {
        return ctx.openTotalPanel(...args);
    }

    function plannedWeapon(...args) {
        return ctx.plannedWeapon(...args);
    }

    function positionTotalBookmark(...args) {
        return ctx.positionTotalBookmark(...args);
    }

    function renderPlans(...args) {
        return ctx.renderPlans(...args);
    }

    function setCurrentWeaponLevelMode(...args) {
        return ctx.setCurrentWeaponLevelMode(...args);
    }

    function setGoalCostsMessage(...args) {
        return ctx.setGoalCostsMessage(...args);
    }

    function setLevelLimits(...args) {
        return ctx.setLevelLimits(...args);
    }

    function setOwnership(...args) {
        return ctx.setOwnership(...args);
    }

    function setTalentLimits(...args) {
        return ctx.setTalentLimits(...args);
    }

    function setTalentTargets(...args) {
        return ctx.setTalentTargets(...args);
    }

    function setWeaponLevelLimits(...args) {
        return ctx.setWeaponLevelLimits(...args);
    }

    function updateGoalCosts(...args) {
        return ctx.updateGoalCosts(...args);
    }

    function loadPlans() {
        try {
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
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state.plans));

            localStorage.setItem(pendingKey, "true");
            syncStatus.hidden = false;
            syncStatus.textContent = "Saving plans...";
            const snapshot = JSON.parse(JSON.stringify(state.plans));
            state.plansRevision++;
            state.databaseSavePromise = state.databaseSavePromise
                .catch(() => undefined)
                .then(() => savePlansToDatabase(snapshot));
            state.databaseSavePromise.catch((error) => {
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
        if (localStorage.getItem(STORAGE_KEY) === JSON.stringify(snapshot)) {
            if (recovered?.snapshot_exists === true) {
                state.plans = normalisePlans(recovered.plans);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state.plans));
                renderPlans();
            }
            localStorage.removeItem(pendingKey);
            syncStatus.hidden = true;
        }
    }

    async function hydratePlansFromDatabase() {
        if (!accountId) {
            state.plansLoading = false;
            renderPlans();
            return;
        }

        const startingRevision = state.plansRevision;

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

            if (state.plansRevision !== startingRevision) {
                return;
            }

            if (localStorage.getItem(pendingKey) === "true") {
                await savePlansToDatabase(JSON.parse(JSON.stringify(state.plans)));
            } else if (payload?.snapshot_exists === false) {
                const legacy = legacyStorageKey ? localStorage.getItem(legacyStorageKey) : null;
                const recovered = state.plans.length
                    ? state.plans
                    : normalisePlans(legacy !== null ? JSON.parse(legacy) : []);
                if (recovered.length) {
                    state.plans = recovered;
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.plans));
                    localStorage.setItem(pendingKey, "true");
                    renderPlans();
                    await savePlansToDatabase(JSON.parse(JSON.stringify(state.plans)), true);
                }
            } else {
                state.plans = normalisePlans(payload?.plans);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(state.plans));
                renderPlans();
            }
        } catch (error) {
            console.error("Could not synchronise Character Planner data.", error);
            syncStatus.hidden = false;
            syncStatus.textContent =
                "Could not sync Planner. Showing this browser's saved plans; reload to retry.";
        } finally {
            state.plansLoading = false;
            renderPlans();
        }
    }

    function getPlan(id) {
        return state.plans.find((plan) => String(plan.id) === String(id));
    }

    function showModal(modal, dialog) {
        state.previouslyFocused = document.activeElement;

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

        if (state.previouslyFocused?.isConnected) {
            state.previouslyFocused.focus();
        }
    }

    function closeEditor() {
        if (weaponPicker.open) weaponPicker.close();
        state.weaponSyncRequestId++;
        plannerSelectors.close();
        closeTotalPanel(true);

        state.progressionRequestId++;
        state.costRequestId++;
        state.currentProgression = null;
        state.editingPlan = null;
        state.editingId = null;

        hideModal(editor);
    }

    function openEditor(id, draft = null) {
        const saved = getPlan(id) || draft;
        const plan = saved ? JSON.parse(JSON.stringify(saved)) : null;
        state.editingPlan = plan;

        if (!plan) {
            return;
        }

        plan.weaponSource ||= isUnowned(plan) || plan.plannedWeapon ? "manual" : "hoyolab";
        plan.plannedWeapon ??= null;
        state.editingId = String(plan.id);
        state.costRequestId++;

        editorTitle.textContent = plan.name;

        editorSubtitle.textContent =
            `${plan.element || "Unknown element"} · ` + `${plan.rarity || "?"}-star character`;

        editorIcon?.setAttribute("data-rarity", String(plan.rarity));
        state.weaponSyncRequestId++;
        syncWeaponButton.hidden = isUnowned(plan);
        syncWeaponButton.disabled = false;
        syncWeaponButton.textContent = "Sync from HoYoLAB";
        weaponStatus.textContent = "";
        if (editorIcon) {
            const iconUrl = safeCharacterIcon(plan.icon);
            if (iconUrl) editorIcon.src = iconUrl;
            else editorIcon.removeAttribute("src");
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

        const requestId = ++state.progressionRequestId;
        loadCurrentProgression(plan, requestId);
    }

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
        const plan = state.editingPlan;
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
        if (state.currentProgression?.weapon) state.currentProgression.weapon.level = current;
        updateGoalCosts();
    });

    form.querySelectorAll("[data-planner-talent]").forEach((input) => {
        input.addEventListener("change", updateGoalCosts);
    });

    craftingInput?.addEventListener("click", () => {
        const enabled = craftingInput.getAttribute("aria-pressed") !== "true";
        craftingInput.setAttribute("aria-pressed", String(enabled));
        state.craftingUpdaters.forEach((update) => update());
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

        const plan = state.editingPlan;

        if (!plan) {
            return;
        }

        plan.notes = notesInput.value.trim();
        plan.constellation = Number(constellationInput.value);
        plan.level = Number(levelInput.value);
        plan.talents = getTalentTargets();
        plan.weaponLevel = Number(weaponLevelInput.value);

        const existingIndex = state.plans.findIndex((item) => String(item.id) === String(plan.id));
        if (existingIndex < 0) state.plans.push(plan);
        else state.plans[existingIndex] = plan;
        persistPlans();
        renderPlans();

        closeEditor();
        window.showCyreneToast?.(
            existingIndex < 0
                ? `${plan.name} added to Character Planner.`
                : `${plan.name}'s plan updated.`,
        );
        try {
            await state.databaseSavePromise;
        } catch {
            window.showCyreneToast?.(
                "Plan kept in this browser. Could not sync; try saving again.",
                "warning",
            );
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && state.cardDrag) {
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

    const plannerSelectors = createButtonSelectors(form, editor, editorDialog);

    ctx.plannerSelectors = plannerSelectors;

    window.addEventListener("cyrene-content-preferences-changed", () => {
        if (!page.isConnected) return;
        renderPlans();
        filterPicker();
    });

    renderPlans();

    filterPicker();

    const hydrationPromise = hydratePlansFromDatabase();

    ctx.hydrationPromise = hydrationPromise;

    async function refreshProgression() {
        await hydrationPromise;
        if (state.refreshingProgression || !page.isConnected || !editor.hidden) return;
        state.refreshingProgression = true;
        try {
            goalCostCache.clear();
            filterPicker();
            let changed = false;
            state.plans.forEach((plan) => {
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
                state.plans.map(async (plan) => {
                    if (!accountId || isUnowned(plan)) return;
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
                        if (
                            !character ||
                            getPlan(plan.id) !== plan ||
                            !page.isConnected ||
                            !editor.hidden
                        )
                            return;
                        const talents = getCharacterCombatTalents(character);
                        const levels = talents.map((talent) => Number(talent.level));
                        if (levels.length === 3 && levels.every(Number.isFinite)) {
                            plan.currentTalents = levels;
                            const bonuses = getTalentBonuses(character, talents);
                            plan.talents = plan.talents.map((goal, index) =>
                                Math.min(10 + bonuses[index], Math.max(levels[index], goal)),
                            );
                            changed = true;
                        }
                        if (
                            (plan.weaponSource === "manual" ||
                                (plan.plannedWeapon && !plan.weaponSource)) &&
                            String(plan.plannedWeapon?.id) !== String(character.weapon?.id)
                        )
                            return;
                        const weapon = plannedWeapon(
                            { ...plan, weaponSource: "hoyolab" },
                            character,
                        );
                        if (!weapon) return;
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
                        console.warn(
                            "Could not load the equipped weapon for a planner card.",
                            error,
                        );
                    }
                }),
            );
            if (changed) {
                persistPlans();
                renderPlans();
            }
        } finally {
            state.refreshingProgression = false;
        }
    }

    page.addEventListener("characters-refreshed", () => void refreshProgression());

    void refreshProgression();
}
