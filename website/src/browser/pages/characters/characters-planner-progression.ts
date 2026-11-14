// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Current and goal progression in the plan editor: levels, talents and tabs.
window.CyrenePlannerProgression = (ctx) => {
    const {
        state,
        unownedCharacter,
        getTalentBonuses,
        editor,
        form,
        constellationInput,
        levelInput,
        weaponLevelInput,
        currentLevelElement,
        currentWeaponNameElement,
        currentWeaponIcon,
        currentWeaponLevelElement,
        currentWeaponLevelInput,
        progressionTabs,
        progressionPanels,
        accountId,
        normaliseNumber,
        normaliseTalents,
    } = ctx;
    const isUnowned = (...args) => ctx.isUnowned(...args);
    const plannedWeapon = (...args) => ctx.plannedWeapon(...args);
    const setGoalCostsMessage = (...args) => ctx.setGoalCostsMessage(...args);
    const updateGoalCosts = (...args) => ctx.updateGoalCosts(...args);

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

        ctx.plannerSelectors.sync();
    }

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

    function setCurrentProgressionLoading() {
        state.currentProgression = null;

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
        state.currentProgression = null;
        const manualWeapon =
            state.editingPlan?.weaponSource === "manual" && state.editingPlan?.plannedWeapon;

        if (currentLevelElement) {
            currentLevelElement.textContent = "Unavailable";
        }

        if (currentWeaponNameElement) {
            currentWeaponNameElement.textContent = "Weapon data unavailable";
        }

        if (manualWeapon) {
            setCurrentWeaponLevelMode(
                state.editingPlan.currentWeaponLevel ?? state.editingPlan.plannedWeapon.level ?? 1,
                true,
                state.editingPlan.currentWeaponRarity ??
                    state.editingPlan.plannedWeapon.rarity ??
                    5,
            );
        } else if (currentWeaponLevelElement) {
            currentWeaponLevelElement.textContent = "Unavailable";
            currentWeaponLevelInput.disabled = true;
            const trigger = ctx.plannerSelectors.getTrigger(currentWeaponLevelInput);
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

        ctx.plannerSelectors.sync();
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

        const trigger = ctx.plannerSelectors.getTrigger(currentWeaponLevelInput);
        if (trigger) {
            trigger.disabled = !editable;
            trigger.classList.toggle("is-readonly", !editable);
            trigger.setAttribute("aria-disabled", String(!editable));
            trigger.tabIndex = editable ? 0 : -1;
        }

        ctx.plannerSelectors.sync();
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

            if (requestId !== state.progressionRequestId || editor.hidden) {
                return;
            }

            if (currentLevelElement) {
                currentLevelElement.textContent =
                    character.level != null ? `Lv. ${character.level}` : "Unavailable";
            }

            const weapon = plannedWeapon(plan, character);
            if (
                !isUnowned(plan) &&
                character.weapon &&
                String(weapon?.id) === String(character.weapon.id)
            ) {
                plan.weaponSource = "hoyolab";
            }
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
                const trigger = ctx.plannerSelectors.getTrigger(currentWeaponLevelInput);
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
            ctx.plannerSelectors.sync();

            if (
                Number.isFinite(Number(character.level)) &&
                currentTalentLevels.length === 3 &&
                currentTalentLevels.every(Number.isFinite)
            ) {
                state.currentProgression = {
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
            if (requestId !== state.progressionRequestId || editor.hidden) {
                return;
            }

            console.error("Could not load current character progression.", error);

            setCurrentProgressionUnavailable();
            setGoalCostsMessage(
                "Current progression is unavailable, so costs " + "cannot be calculated.",
            );
        }
    }

    return {
        activateProgressionTab,
        getTalentTargets,
        loadCurrentProgression,
        setCurrentWeaponLevelMode,
        setLevelLimits,
        setTalentLimits,
        setTalentTargets,
        setWeaponLevelLimits,
    };
};
