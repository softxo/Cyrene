/* =========================================================
   CHARACTERS — PROGRESSION PLANNER
   ========================================================= */

function initCharacterPlanner() {
    const page = document.querySelector(".characters-page");

    if (!page || page.dataset.plannerInitialised === "true") {
        return;
    }

    const picker = page.querySelector("[data-planner-picker]");
    const pickerDialog = picker?.querySelector(
        ".planner-picker-dialog"
    );
    const pickerSearch = page.querySelector(
        "[data-planner-character-search]"
    );
    const pickerGrid = page.querySelector(
        "[data-planner-picker-grid]"
    );
    const pickerEmpty = page.querySelector(
        "[data-planner-picker-empty]"
    );

    const editor = page.querySelector("[data-planner-editor]");
    const editorDialog = editor?.querySelector(
        ".planner-editor-dialog"
    );
    const form = page.querySelector("[data-planner-form]");

    const plannerGrid = page.querySelector("[data-planner-grid]");
    const emptyState = page.querySelector("[data-planner-empty]");

    if (
        !picker ||
        !pickerDialog ||
        !pickerSearch ||
        !pickerGrid ||
        !pickerEmpty ||
        !editor ||
        !editorDialog ||
        !form ||
        !plannerGrid ||
        !emptyState
    ) {
        console.error(
            "Character Planner could not initialise: required HTML elements are missing."
        );
        return;
    }

    page.dataset.plannerInitialised = "true";

    const STORAGE_KEY = "cyrene-character-plans";
    const pickerButtons = Array.from(
        pickerGrid.querySelectorAll("[data-planner-character-id]")
    );

    const editorIcon = page.querySelector(
        "[data-planner-editor-icon]"
    );
    const editorTitle = page.querySelector(
        "#planner-editor-title"
    );
    const editorSubtitle = page.querySelector(
        "[data-planner-editor-subtitle]"
    );
    const notesInput = page.querySelector("[data-planner-notes]");
    const constellationInput = page.querySelector(
        "[data-planner-constellation]"
    );
    const levelInput = page.querySelector("[data-planner-level]");
    const weaponLevelInput = page.querySelector(
        "[data-planner-weapon-level]"
    );
    const costElement = page.querySelector("[data-planner-cost]");

    let plans = loadPlans();
    let editingId = null;
    let previouslyFocused = null;

    function loadPlans() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            const parsed = stored ? JSON.parse(stored) : [];

            return Array.isArray(parsed)
                ? parsed.filter(plan =>
                    plan &&
                    plan.id !== undefined &&
                    plan.name &&
                    plan.icon
                )
                : [];
        } catch (error) {
            console.warn("Could not load saved character plans.", error);
            return [];
        }
    }

    function persistPlans() {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(plans)
            );
            return true;
        } catch (error) {
            console.error("Could not save character plans.", error);
            return false;
        }
    }

    function makeElement(tag, className, text = "") {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        element.textContent = text;
        return element;
    }

    function getPlan(id) {
        return plans.find(plan => String(plan.id) === String(id));
    }

    function getTalentTargets() {
        return [1, 2, 3].map(index => {
            const input = form.querySelector(
                `[data-planner-talent="${index}"]`
            );

            return Number(input?.value || 10);
        });
    }

    function setTalentTargets(values) {
        [1, 2, 3].forEach(index => {
            const input = form.querySelector(
                `[data-planner-talent="${index}"]`
            );

            if (input) {
                input.value = String(values?.[index - 1] ?? 10);
            }
        });
    }

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
                `Lv. ${plan.level} · C${plan.constellation}`
            );

            const talents = makeElement(
                "p",
                "",
                `Talents ${plan.talents.join(" / ")}`
            );

            const weapon = makeElement(
                "p",
                "",
                `Weapon Lv. ${plan.weaponLevel}`
            );

            const actions = makeElement("div", "planner-card-actions");

            const editButton = makeElement("button", "", "Edit plan");
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
            card.append(image, name, summary, talents, weapon, actions);

            if (plan.notes?.trim()) {
                const notes = makeElement(
                    "p",
                    "planner-card-notes",
                    plan.notes
                );
                card.insertBefore(notes, actions);
            }

            plannerGrid.append(card);
        });
    }

    function filterPicker() {
        const query = pickerSearch.value.trim().toLocaleLowerCase();
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

    function openPicker() {
        pickerSearch.value = "";
        filterPicker();

        showModal(picker, pickerDialog);
        pickerSearch.focus();
    }

    function closePicker() {
        hideModal(picker);
    }

    function openEditor(id) {
        const plan = getPlan(id);

        if (!plan) {
            return;
        }

        editingId = String(plan.id);

        editorTitle.textContent = plan.name;
        editorSubtitle.textContent =
            `${plan.element || "Unknown element"} · ${plan.rarity || "?"}-star character`;

        if (editorIcon) {
            editorIcon.src = plan.icon;
            editorIcon.alt = plan.name;
        }

        notesInput.value = plan.notes || "";
        constellationInput.value = String(plan.constellation ?? 0);
        levelInput.value = String(plan.level ?? 90);
        weaponLevelInput.value = String(plan.weaponLevel ?? 90);
        setTalentTargets(plan.talents);

        if (costElement) {
            costElement.replaceChildren(
                makeElement(
                    "p",
                    "",
                    "Material calculations aren't connected yet. Your selected targets will be saved with this plan."
                )
            );
        }

        showModal(editor, editorDialog);
    }

    function closeEditor() {
        hideModal(editor);
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
                name: button.dataset.plannerCharacterName || "Unknown character",
                element: button.dataset.plannerCharacterElement || "",
                rarity: Number(button.dataset.plannerCharacterRarity) || 0,
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

    page.querySelectorAll("[data-planner-add]").forEach(button => {
        button.addEventListener("click", openPicker);
    });

    pickerButtons.forEach(button => {
        button.addEventListener("click", () => addCharacter(button));
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

    renderPlans();
    filterPicker();
}