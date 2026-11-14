// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Planned weapon choice: the weapon picker dialog and syncing the equipped weapon.
window.CyrenePlannerWeapons = (ctx) => {
    const {
        state,
        makeElement,
        makeWeaponCard,
        editor,
        weaponLevelInput,
        accountId,
        pickerButtons,
        weaponPicker,
        chooseWeaponButton,
        syncWeaponButton,
        weaponStatus,
        weaponSearch,
        weaponRarityFilter,
        weaponPickerStatus,
        weaponGrid,
        weaponRetry,
        normaliseNumber,
    } = ctx;
    const loadCurrentProgression = (...args) => ctx.loadCurrentProgression(...args);

    function isUnowned(plan) {
        return (
            pickerButtons.find(
                (button) => String(button.dataset.plannerCharacterId) === String(plan.id),
            )?.dataset.plannerCharacterOwnership === "unowned"
        );
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
        const liveWeapon = !isUnowned(plan) && character?.weapon;
        const followsEquippedWeapon =
            plan.weaponSource !== "manual" ||
            (liveWeapon && String(plan.plannedWeapon?.id) === String(liveWeapon.id));
        const equipped = followsEquippedWeapon && liveWeapon;
        const manualWeapon = !equipped && plan.weaponSource === "manual";
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
                  level: manualWeapon
                      ? normaliseNumber(plan.currentWeaponLevel, Number(weapon.level) || 1, 1, 90)
                      : Number(weapon.level) || 1,
                  ascension:
                      weapon.ascension ??
                      (Number(manualWeapon ? plan.currentWeaponLevel : weapon.level || 1) === 1
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
        const plan = state.editingPlan;
        if (!plan) return;
        state.weaponSyncRequestId++;
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
        loadCurrentProgression(plan, ++state.progressionRequestId);
    }

    function renderWeaponChoices() {
        const plan = state.editingPlan;
        if (!plan) return;
        const type = characterWeaponType(plan);
        const query = weaponSearch.value.trim().toLocaleLowerCase();
        const availableWeapons = state.weaponCatalogue.filter(
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
            const selected =
                String(plan.plannedWeapon?.id) === String(weapon.id) ||
                plan.plannedWeapon?.name === weapon.name;
            weaponGrid.append(makeWeaponCard(weapon, selected, () => selectWeapon(weapon)));
        }
    }

    async function loadWeaponChoices(plan) {
        weaponGrid.replaceChildren();
        weaponRetry.hidden = true;
        weaponPickerStatus.textContent = "Loading weapons...";
        try {
            state.weaponCataloguePromise ??= fetch(
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
                    state.weaponCataloguePromise = null;
                    throw error;
                });
            const weapons = await state.weaponCataloguePromise;
            if (state.editingPlan !== plan || !weaponPicker.open) return;
            state.weaponCatalogue = weapons;
            renderWeaponChoices();
        } catch (error) {
            if (state.editingPlan !== plan || !weaponPicker.open) return;
            weaponPickerStatus.textContent = error.message || "Couldn't load weapons.";
            weaponRetry.hidden = false;
        }
    }

    chooseWeaponButton.addEventListener("click", () => {
        if (!state.editingPlan) return;
        ctx.plannerSelectors.close();
        weaponSearch.value = "";
        weaponRarityFilter.value = "";
        syncWeaponRarity();
        closeWeaponRarity();
        weaponPicker.querySelector("[data-planner-weapon-picker-description]").textContent =
            `Choose a weapon for ${state.editingPlan.name}.`;
        weaponPicker.showModal();
        weaponSearch.focus();
        loadWeaponChoices(state.editingPlan);
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

    weaponRetry.addEventListener("click", () => loadWeaponChoices(state.editingPlan));

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
        const plan = state.editingPlan;
        if (!plan || isUnowned(plan)) return;
        const requestId = ++state.weaponSyncRequestId;
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
            if (
                state.editingPlan !== plan ||
                requestId !== state.weaponSyncRequestId ||
                editor.hidden
            )
                return;
            plan.weaponSource = "hoyolab";
            plan.plannedWeapon = plannedWeapon(plan, character);
            plan.weaponLevel = Math.max(
                Number(plan.weaponLevel) || 1,
                Number(character.weapon.level),
            );
            weaponLevelInput.value = String(plan.weaponLevel);
            await loadCurrentProgression(plan, ++state.progressionRequestId, character);
        } catch (error) {
            if (state.editingPlan === plan && requestId === state.weaponSyncRequestId)
                weaponStatus.textContent =
                    error.message || "Couldn't sync the equipped weapon. Try again.";
        } finally {
            if (state.editingPlan === plan && requestId === state.weaponSyncRequestId) {
                syncWeaponButton.disabled = false;
                syncWeaponButton.textContent = "Sync from HoYoLAB";
            }
        }
    });

    return {
        closeWeaponPicker,
        isUnowned,
        plannedWeapon,
    };
};
