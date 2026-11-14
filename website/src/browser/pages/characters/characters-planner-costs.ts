// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// Material costs for the edited plan, the inventory comparison and the total panel.
window.CyrenePlannerCosts = (ctx) => {
    const {
        state,
        makeElement,
        renderGoalCostTiles,
        combineGoalCosts,
        withoutTalentBonuses,
        editor,
        editorDialog,
        form,
        constellationInput,
        levelInput,
        weaponLevelInput,
        craftingInput,
        totalButton,
        totalPanel,
        totalContent,
        accountId,
        goalCostCache,
        pendingGoalCosts,
    } = ctx;
    const getTalentTargets = (...args) => ctx.getTalentTargets(...args);
    const loadCurrentProgression = (...args) => ctx.loadCurrentProgression(...args);

    function combinePlanCosts(costs) {
        return combineGoalCosts(costs, Boolean(state.currentProgression?.weapon));
    }

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
        if (String(plan.id) !== state.editingId) return;
        target.replaceChildren(makeElement("p", "planner-cost-message", "Calculating total..."));
        target.setAttribute("aria-busy", "true");
        if (state.currentProgression) await updateGoalCosts();
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
        const plan = state.editingPlan;

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

    function setGoalCostsMessage(message, loading = false) {
        state.craftingUpdaters = [];
        const costElements = Array.from(form.querySelectorAll("[data-planner-cost]"));
        if (editor.classList.contains("is-total-open")) costElements.push(totalContent);

        costElements.forEach((element) => {
            element.setAttribute("aria-busy", String(loading));
            element.closest(".planner-goal-cost")?.querySelector(".planner-cost-status")?.remove();
            element.replaceChildren(makeElement("p", "planner-cost-message", message));
        });
    }

    function renderGoalCost(element, cost, inventory = null) {
        state.craftingUpdaters.push(
            ...renderGoalCostTiles(element, cost, inventory, {
                isCraftingEnabled: () => craftingInput?.getAttribute("aria-pressed") === "true",
                onRetry() {
                    goalCostCache.clear();
                    if (!state.currentProgression && state.editingPlan)
                        loadCurrentProgression(state.editingPlan, ++state.progressionRequestId);
                    else updateGoalCosts();
                },
            }),
        );
    }

    function loadInventory() {
        if (!accountId) {
            return Promise.resolve(null);
        }

        if (state.inventoryPromise) {
            return state.inventoryPromise;
        }

        state.inventoryPromise = fetch(
            `/api/inventory?account_id=${encodeURIComponent(accountId)}`,
            {
                method: "GET",
                credentials: "same-origin",
                headers: { Accept: "application/json" },
            },
        )
            .then(async (response) => {
                const payload = await response.json();

                if (!response.ok) {
                    throw new Error(payload?.error || "Couldn't retrieve inventory.");
                }

                state.loadedInventory = new Map(
                    (payload?.inventory || []).map((item) => [
                        String(item.id),
                        {
                            amount: Number(item.amount) || 0,
                            rarity: Number(item.rarity) || 0,
                            name: item.name || "",
                        },
                    ]),
                );
                return state.loadedInventory;
            })
            .catch((error) => {
                console.warn("Could not load HoYoLAB inventory for the planner.", error);
                state.loadedInventory = null;
                return null;
            });

        return state.inventoryPromise;
    }

    async function updateGoalCosts() {
        const plan = state.editingPlan;

        if (!plan || !state.currentProgression) {
            return;
        }

        const requestId = ++state.costRequestId;
        setGoalCostsMessage("Calculating required materials…", true);

        const parameters = new URLSearchParams({
            character_name: state.currentProgression.name || plan.name,
            current_level: String(state.currentProgression.level),
            target_level: levelInput.value,
            current_talents: withoutTalentBonuses(
                state.currentProgression.talents,
                state.currentProgression.talentBonuses,
            ).join(","),
            target_talents: withoutTalentBonuses(
                getTalentTargets(),
                state.currentProgression.talentBonuses,
            ).join(","),
            target_weapon_level: weaponLevelInput.value,
        });

        if (state.currentProgression.ascension != null) {
            parameters.set("current_ascension", String(state.currentProgression.ascension));
        }

        if (state.currentProgression.weapon) {
            if (state.currentProgression.weapon.ascension != null) {
                parameters.set(
                    "weapon_ascension",
                    String(state.currentProgression.weapon.ascension),
                );
            }
            parameters.set("weapon_name", state.currentProgression.weapon.name);
            parameters.set("weapon_rarity", String(state.currentProgression.weapon.rarity));
            parameters.set("current_weapon_level", String(state.currentProgression.weapon.level));
        }

        try {
            const requestUrl =
                `/api/characters/${encodeURIComponent(plan.id)}` +
                `/planner-costs?${parameters.toString()}`;
            const inventoryRequest = loadInventory();
            const payload = await loadGoalCostPayload(requestUrl);

            if (
                requestId !== state.costRequestId ||
                editor.hidden ||
                String(plan.id) !== state.editingId
            ) {
                return;
            }

            const renderCosts = (inventory) => {
                state.craftingUpdaters = [];
                form.querySelectorAll("[data-planner-cost]").forEach((element) => {
                    renderGoalCost(
                        element,
                        element.dataset.plannerCost === "weapon" && !state.currentProgression.weapon
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

            renderCosts(state.loadedInventory);

            if (!(state.loadedInventory instanceof Map)) {
                const inventory = await inventoryRequest;

                if (
                    inventory instanceof Map &&
                    requestId === state.costRequestId &&
                    !editor.hidden &&
                    String(plan.id) === state.editingId
                ) {
                    renderCosts(inventory);
                }
            }
        } catch (error) {
            if (requestId !== state.costRequestId || editor.hidden) {
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

    return {
        closeTotalPanel,
        openTotalPanel,
        positionTotalBookmark,
        setGoalCostsMessage,
        updateGoalCosts,
    };
};
