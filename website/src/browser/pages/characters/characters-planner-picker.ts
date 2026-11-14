// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Character picker: ownership filter, search, adding and removing planned characters.
window.CyrenePlannerPicker = (ctx) => {
    const {
        state,
        page,
        picker,
        pickerDialog,
        pickerSearch,
        pickerEmpty,
        pickerButtons,
        pickerFilters,
        pickerCount,
        normaliseNumber,
        normaliseOptionalNumber,
        persistPlans,
        getPlan,
        showModal,
        hideModal,
        openEditor,
    } = ctx;
    const renderPlans = (...args) => ctx.renderPlans(...args);
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
        await ctx.hydrationPromise;
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
        await ctx.hydrationPromise;
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
        await ctx.hydrationPromise;
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

        state.plans = state.plans.filter((item) => String(item.id) !== String(id));

        persistPlans();
        renderPlans();
        window.showCyreneToast?.(`${plan.name} removed from Character Planner.`);
        try {
            await state.databaseSavePromise;
        } catch {
            window.showCyreneToast?.(
                `${plan.name} removed in this browser. Sync failed; reload to retry.`,
                "warning",
            );
        }
    }

    return {
        addCharacter,
        closePicker,
        filterPicker,
        openPicker,
        removePlan,
        setOwnership,
    };
};
