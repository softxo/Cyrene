// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Planner cards: rendering saved plans and drag-to-reorder.
window.CyrenePlannerCards = (ctx) => {
    const {
        state,
        makeElement,
        makeArrow,
        makeProgressionValues,
        safeCharacterIcon,
        elementIcons,
        page,
        plannerGrid,
        emptyState,
        pickerButtons,
        persistPlans,
        openEditor,
    } = ctx;
    const removePlan = (...args) => ctx.removePlan(...args);

    function finishCardDrag(commit = false) {
        const drag = state.cardDrag;
        if (!drag) return;
        state.cardDrag = null;
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
            const byId = new Map(state.plans.map((plan) => [String(plan.id), plan]));
            const visible = new Set(ids);
            let index = 0;
            state.plans = state.plans.map((plan) =>
                visible.has(String(plan.id)) ? byId.get(ids[index++]) : plan,
            );
            persistPlans();
        } else {
            renderPlans();
        }
    }

    document.addEventListener("pointerup", (event) => {
        if (state.cardDrag?.pointerId === event.pointerId) finishCardDrag(true);
    });

    document.addEventListener("pointercancel", (event) => {
        if (state.cardDrag?.pointerId === event.pointerId) finishCardDrag();
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
            state.cardDrag = drag;
            drag.timer = window.setTimeout(() => {
                if (state.cardDrag !== drag || !card.isConnected) return;
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
                if (state.cardDrag?.active) event.preventDefault();
            },
            { passive: false },
        );
        card.addEventListener("dragstart", (event) => event.preventDefault());
        card.addEventListener("pointermove", (event) => {
            const drag = state.cardDrag;
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
            if (state.cardDrag?.card === card) finishCardDrag(true);
        });
        card.addEventListener("pointercancel", () => {
            if (state.cardDrag?.card === card) finishCardDrag();
        });
        card.addEventListener("keydown", (event) => {
            if (
                event.target !== card ||
                !event.altKey ||
                !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
            )
                return;
            event.preventDefault();
            const index = state.plans.findIndex((plan) => String(plan.id) === card.dataset.planId);
            const next = index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
            if (next < 0 || next >= state.plans.length) return;
            [state.plans[index], state.plans[next]] = [state.plans[next], state.plans[index]];
            persistPlans();
            renderPlans();
            plannerGrid.querySelector(`[data-plan-id="${card.dataset.planId}"]`)?.focus();
        });
    }

    function renderPlans() {
        const visiblePlans = state.plans.filter(
            (plan) =>
                document.documentElement.dataset.showUnreleased === "true" ||
                pickerButtons.find(
                    (button) => String(button.dataset.plannerCharacterId) === String(plan.id),
                )?.dataset.unreleased !== "true",
        );
        const hasPlans = visiblePlans.length > 0;

        emptyState.hidden = state.plansLoading || hasPlans;
        const loadingStatus = page.querySelector("[data-planner-loading]");
        if (loadingStatus) loadingStatus.hidden = !state.plansLoading || hasPlans;
        plannerGrid.hidden = !hasPlans;

        const currentLevels = new Map(
            pickerButtons.map((button) => [
                String(button.dataset.plannerCharacterId),
                Number(button.dataset.plannerCharacterLevel) || null,
            ]),
        );
        const renderSignature = JSON.stringify([
            visiblePlans,
            [...currentLevels],
            pickerButtons.map((button) => button.dataset.unreleased),
        ]);
        if (renderSignature === state.lastRenderSignature && plannerGrid.childElementCount > 0)
            return;
        state.lastRenderSignature = renderSignature;

        finishCardDrag();
        plannerGrid.replaceChildren();

        visiblePlans.forEach((plan) => {
            const card = makeElement("article", "planner-character-card");
            const image = document.createElement("img");
            const iconUrl = safeCharacterIcon(plan.icon);
            if (iconUrl) image.src = iconUrl;
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
            const elementIcon = document.createElement("img");
            const elementIconUrl = Object.hasOwn(elementIcons, plan.element)
                ? elementIcons[plan.element]
                : "";
            if (elementIconUrl) elementIcon.src = elementIconUrl;
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

    return {
        finishCardDrag,
        renderPlans,
    };
};
