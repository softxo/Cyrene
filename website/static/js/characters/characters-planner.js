
/* =========================================================
   CHARACTERS — PROGRESSION PLANNER
   ========================================================= */

function initCharacterPlanner() {
    const page = document.querySelector(".characters-page");

    if (
        !page ||
        page.dataset.plannerInitialised === "true"
    ) {
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
            "the picker, editor, or planner grid is missing."
        );
        return;
    }

    const pickerDialog = picker.querySelector(".planner-picker-dialog");
    const pickerSearch = picker.querySelector(
        "[data-planner-character-search]"
    );
    const pickerGrid = picker.querySelector("[data-planner-picker-grid]");
    const pickerEmpty = picker.querySelector("[data-planner-picker-empty]");

    const editorDialog = editor.querySelector(".planner-editor-dialog");
    const form = editor.querySelector("[data-planner-form]");

    if (
        !pickerDialog ||
        !pickerSearch ||
        !pickerGrid ||
        !pickerEmpty ||
        !editorDialog ||
        !form
    ) {
        console.error(
            "Character Planner could not initialise: " +
            "required modal elements are missing."
        );
        return;
    }

    const notesInput = form.querySelector("[data-planner-notes]");
    const constellationInput = form.querySelector(
        "[data-planner-constellation]"
    );
    const levelInput = form.querySelector("[data-planner-level]");
    const weaponLevelInput = form.querySelector(
        "[data-planner-weapon-level]"
    );

    const editorIcon = editor.querySelector("[data-planner-editor-icon]");
    const editorTitle = editor.querySelector("#planner-editor-title");
    const editorSubtitle = editor.querySelector(
        "[data-planner-editor-subtitle]"
    );

    const currentLevelElement = editor.querySelector(
        "[data-planner-current-level]"
    );
    const currentWeaponNameElement = editor.querySelector(
        "[data-planner-current-weapon-name]"
    );
    const currentWeaponLevelElement = editor.querySelector(
        "[data-planner-current-weapon-level]"
    );

    const progressionTabs = Array.from(
        form.querySelectorAll("[data-planner-tab]")
    );
    const progressionPanels = Array.from(
        form.querySelectorAll("[data-planner-panel]")
    );
    const talentTabs = Array.from(
        form.querySelectorAll("[data-planner-talent-tab]")
    );
    const talentPanels = Array.from(
        form.querySelectorAll("[data-planner-talent-panel]")
    );

    if (
        !notesInput ||
        !constellationInput ||
        !levelInput ||
        !weaponLevelInput
    ) {
        console.error(
            "Character Planner could not initialise: " +
            "one or more plan fields are missing."
        );
        return;
    }

    page.dataset.plannerInitialised = "true";

    /* =====================================================
       CONFIGURATION AND STATE
       ===================================================== */

    const STORAGE_KEY = "cyrene-character-plans";
    const accountId = picker.dataset.accountId || "";

    const pickerButtons = Array.from(
        pickerGrid.querySelectorAll("[data-planner-character-id]")
    );

    let plans = loadPlans();
    let editingId = null;
    let previouslyFocused = null;
    let progressionRequestId = 0;

    /* =====================================================
       SAVED PLANS
       ===================================================== */

    function loadPlans() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            const parsed = stored ? JSON.parse(stored) : [];

            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .filter(plan =>
                    plan &&
                    plan.id !== undefined &&
                    plan.name &&
                    plan.icon
                )
                .map(plan => ({
                    ...plan,
                    constellation: normaliseNumber(
                        plan.constellation,
                        0,
                        0,
                        6
                    ),
                    level: normaliseNumber(
                        plan.level,
                        90,
                        1,
                        90
                    ),
                    talents: normaliseTalents(plan.talents),
                    weaponLevel: normaliseNumber(
                        plan.weaponLevel,
                        90,
                        1,
                        90
                    ),
                    notes: typeof plan.notes === "string"
                        ? plan.notes
                        : ""
                }));
        } catch (error) {
            console.warn(
                "Could not load saved character plans.",
                error
            );
            return [];
        }
    }

    function normaliseNumber(value, fallback, min, max) {
        const number = Number(value);

        if (!Number.isFinite(number)) {
            return fallback;
        }

        return Math.min(max, Math.max(min, number));
    }

    function normaliseTalents(values) {
        return [0, 1, 2].map(index =>
            normaliseNumber(values?.[index], 10, 1, 10)
        );
    }

    function persistPlans() {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(plans)
            );
            return true;
        } catch (error) {
            console.error(
                "Could not save character plans.",
                error
            );
            return false;
        }
    }

    function getPlan(id) {
        return plans.find(
            plan => String(plan.id) === String(id)
        );
    }

    function makeElement(tag, className, text = "") {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        element.textContent = text;
        return element;
    }

    /* =====================================================
       TARGET TALENT FIELDS
       ===================================================== */

    function getTalentTargets() {
        return [1, 2, 3].map(index => {
            const input = form.querySelector(
                `[data-planner-talent="${index}"]`
            );

            return Number(input?.value || 10);
        });
    }

    function setTalentTargets(values) {
        const targets = normaliseTalents(values);

        [1, 2, 3].forEach(index => {
            const input = form.querySelector(
                `[data-planner-talent="${index}"]`
            );

            if (input) {
                input.value = String(targets[index - 1]);
            }
        });
    }

    /* =====================================================
       PLAN CARD RENDERING
       ===================================================== */

    function renderPlans() {
        plannerGrid.replaceChildren();

        const hasPlans = plans.length > 0;

        emptyState.hidden = hasPlans;
        plannerGrid.hidden = !hasPlans;

        plans.forEach(plan => {
            const card = makeElement(
                "article",
                "planner-character-card"
            );

            const image = makeElement("img");
            image.src = plan.icon;
            image.alt = plan.name;
            image.loading = "lazy";

            const name = makeElement("h3", "", plan.name);

            const summary = makeElement(
                "p",
                "",
                `Target Lv. ${plan.level} · C${plan.constellation}`
            );

            const talents = makeElement(
                "p",
                "",
                `Target talents ${plan.talents.join(" / ")}`
            );

            const weapon = makeElement(
                "p",
                "",
                `Target weapon Lv. ${plan.weaponLevel}`
            );

            const actions = makeElement(
                "div",
                "planner-card-actions"
            );

            const editButton = makeElement(
                "button",
                "",
                "Edit plan"
            );
            editButton.type = "button";
            editButton.addEventListener("click", () => {
                openEditor(plan.id);
            });

            const removeButton = makeElement(
                "button",
                "",
                "Remove"
            );
            removeButton.type = "button";
            removeButton.addEventListener("click", () => {
                removePlan(plan.id);
            });

            actions.append(editButton, removeButton);
            card.append(
                image,
                name,
                summary,
                talents,
                weapon
            );

            if (plan.notes.trim()) {
                const notes = makeElement(
                    "p",
                    "planner-card-notes",
                    plan.notes
                );

                card.append(notes);
            }

            card.append(actions);
            plannerGrid.append(card);
        });
    }

    /* =====================================================
       CHARACTER PICKER
       ===================================================== */

    function filterPicker() {
        const query = pickerSearch.value
            .trim()
            .toLocaleLowerCase();

        let visibleCount = 0;

        pickerButtons.forEach(button => {
            const name = (
                button.dataset.plannerCharacterName || ""
            ).toLocaleLowerCase();

            const matches = name.includes(query);

            button.hidden = !matches;

            if (matches) {
                visibleCount++;
            }
        });

        pickerEmpty.hidden = visibleCount !== 0;
    }

    function openPicker() {
        pickerSearch.value = "";
        filterPicker();

        showModal(picker, pickerDialog);
        pickerSearch.focus();
    }

    function closePicker() {
        hideModal(picker);
    }

    function addCharacter(button) {
        const id = button.dataset.plannerCharacterId;

        if (!id) {
            return;
        }

        let plan = getPlan(id);

        if (!plan) {
            plan = {
                id,
                name: button.dataset.plannerCharacterName ||
                    "Unknown character",
                element: button.dataset.plannerCharacterElement || "",
                rarity: Number(
                    button.dataset.plannerCharacterRarity
                ) || 0,
                icon: button.dataset.plannerCharacterIcon || "",
                notes: "",
                constellation: 0,
                level: 90,
                talents: [10, 10, 10],
                weaponLevel: 90
            };

            plans.push(plan);
            persistPlans();
            renderPlans();
        }

        closePicker();
        openEditor(plan.id);
    }

    function removePlan(id) {
        const plan = getPlan(id);

        if (!plan) {
            return;
        }

        const confirmed = window.confirm(
            `Remove ${plan.name} from your Character Planner?`
        );

        if (!confirmed) {
            return;
        }

        plans = plans.filter(
            item => String(item.id) !== String(id)
        );

        persistPlans();
        renderPlans();
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
        progressionRequestId++;
        hideModal(editor);
    }

    /* =====================================================
       PROGRESSION TABS
       ===================================================== */

    function activateProgressionTab(name) {
        progressionTabs.forEach(tab => {
            const active = tab.dataset.plannerTab === name;

            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
        });

        progressionPanels.forEach(panel => {
            panel.hidden = panel.dataset.plannerPanel !== name;
        });
    }

    function activateTalentTab(index) {
        const selected = String(index);

        talentTabs.forEach(tab => {
            const active =
                tab.dataset.plannerTalentTab === selected;

            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
        });

        talentPanels.forEach(panel => {
            panel.hidden =
                panel.dataset.plannerTalentPanel !== selected;
        });
    }

    progressionTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            activateProgressionTab(tab.dataset.plannerTab);
        });
    });

    talentTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            activateTalentTab(tab.dataset.plannerTalentTab);
        });
    });

    /* =====================================================
       CURRENT PROGRESSION
       ===================================================== */

    function setCurrentProgressionLoading() {
        if (currentLevelElement) {
            currentLevelElement.textContent = "Loading…";
        }

        if (currentWeaponNameElement) {
            currentWeaponNameElement.textContent =
                "Loading equipped weapon…";
        }

        if (currentWeaponLevelElement) {
            currentWeaponLevelElement.textContent = "Loading…";
        }

        [1, 2, 3].forEach(index => {
            const element = form.querySelector(
                `[data-planner-current-talent="${index}"]`
            );

            if (element) {
                element.textContent = "Loading…";
            }
        });
    }

    function setCurrentProgressionUnavailable() {
        if (currentLevelElement) {
            currentLevelElement.textContent = "Unavailable";
        }

        if (currentWeaponNameElement) {
            currentWeaponNameElement.textContent =
                "Weapon data unavailable";
        }

        if (currentWeaponLevelElement) {
            currentWeaponLevelElement.textContent = "Unavailable";
        }

        [1, 2, 3].forEach(index => {
            const element = form.querySelector(
                `[data-planner-current-talent="${index}"]`
            );

            if (element) {
                element.textContent = "Unavailable";
            }
        });
    }

    async function loadCurrentProgression(plan, requestId) {
        if (!accountId) {
            setCurrentProgressionUnavailable();
            return;
        }

        setCurrentProgressionLoading();

        try {
            const query = `?account_id=${encodeURIComponent(accountId)}`;

            const response = await fetch(
                `/api/characters/${encodeURIComponent(plan.id)}/showcase${query}`,
                {
                    method: "GET",
                    credentials: "same-origin",
                    headers: {
                        Accept: "application/json"
                    }
                }
            );

            let payload;

            try {
                payload = await response.json();
            } catch {
                throw new Error(
                    "The server returned an invalid response."
                );
            }

            if (!response.ok) {
                throw new Error(
                    payload?.error ||
                    "Couldn't load current progression."
                );
            }

            const character = payload?.data?.characters?.[0];

            if (!character) {
                throw new Error(
                    "No detailed character data was returned."
                );
            }

            // Ignore old responses after switching characters or closing.
            if (
                requestId !== progressionRequestId ||
                editor.hidden
            ) {
                return;
            }

            if (currentLevelElement) {
                currentLevelElement.textContent =
                    character.level != null
                        ? `Lv. ${character.level}`
                        : "Unavailable";
            }

            const weapon = character.weapon;

            if (currentWeaponNameElement) {
                currentWeaponNameElement.textContent =
                    weapon?.name || "Weapon data unavailable";
            }

            if (currentWeaponLevelElement) {
                currentWeaponLevelElement.textContent =
                    weapon?.level != null
                        ? `Lv. ${weapon.level}`
                        : "Unavailable";
            }

            /*
             * Keep the same talent selection rule as the showcase.
             * The order is the order returned by the detailed API.
             */
            const talents = Array.isArray(character.skills)
                ? character.skills
                    .filter(skill => Number(skill.skill_type) === 1)
                    .slice(0, 3)
                : [];

            [1, 2, 3].forEach(index => {
                const element = form.querySelector(
                    `[data-planner-current-talent="${index}"]`
                );

                const talent = talents[index - 1];

                if (element) {
                    element.textContent =
                        talent?.level != null
                            ? `Lv. ${talent.level}`
                            : "Unavailable";
                }
            });
        } catch (error) {
            if (
                requestId !== progressionRequestId ||
                editor.hidden
            ) {
                return;
            }

            console.error(
                "Could not load current character progression.",
                error
            );

            setCurrentProgressionUnavailable();
        }
    }

    /* =====================================================
       GOAL COST PLACEHOLDERS
       ===================================================== */

    function resetGoalCosts() {
        const costElements = Array.from(
            form.querySelectorAll("[data-planner-cost]")
        );

        costElements.forEach(element => {
            element.replaceChildren(
                makeElement(
                    "p",
                    "",
                    "Material calculations aren't connected yet. " +
                    "Your selected target will be saved with this plan."
                )
            );
        });
    }

    /* =====================================================
       OPEN AND SAVE EDITOR
       ===================================================== */

    function openEditor(id) {
        const plan = getPlan(id);

        if (!plan) {
            return;
        }

        editingId = String(plan.id);

        editorTitle.textContent = plan.name;

        editorSubtitle.textContent =
            `${plan.element || "Unknown element"} · ` +
            `${plan.rarity || "?"}-star character`;

        if (editorIcon) {
            editorIcon.src = plan.icon;
            editorIcon.alt = plan.name;
        }

        notesInput.value = plan.notes || "";
        constellationInput.value = String(
            plan.constellation ?? 0
        );
        levelInput.value = String(plan.level ?? 90);
        weaponLevelInput.value = String(
            plan.weaponLevel ?? 90
        );

        setTalentTargets(plan.talents);

        resetGoalCosts();
        activateProgressionTab("level");
        activateTalentTab(1);

        showModal(editor, editorDialog);

        const requestId = ++progressionRequestId;
        loadCurrentProgression(plan, requestId);
    }

    /* =====================================================
       EVENT LISTENERS
       ===================================================== */

    page.querySelectorAll("[data-planner-add]").forEach(button => {
        button.addEventListener("click", openPicker);
    });

    pickerButtons.forEach(button => {
        button.addEventListener("click", () => {
            addCharacter(button);
        });
    });

    pickerSearch.addEventListener("input", filterPicker);

    picker.querySelectorAll("[data-planner-picker-close]").forEach(
        button => {
            button.addEventListener("click", closePicker);
        }
    );

    editor.querySelectorAll("[data-planner-editor-close]").forEach(
        button => {
            button.addEventListener("click", closeEditor);
        }
    );

    form.addEventListener("submit", event => {
        event.preventDefault();

        const plan = getPlan(editingId);

        if (!plan) {
            return;
        }

        plan.notes = notesInput.value.trim();
        plan.constellation = Number(constellationInput.value);
        plan.level = Number(levelInput.value);
        plan.talents = getTalentTargets();
        plan.weaponLevel = Number(weaponLevelInput.value);

        persistPlans();
        renderPlans();
        closeEditor();
    });

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") {
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

    renderPlans();
    filterPicker();
}