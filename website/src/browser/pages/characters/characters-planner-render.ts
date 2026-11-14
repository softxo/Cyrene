// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
(() => {
    const UNREPORTED_INVENTORY_IDS = new Set(["104001", "104002", "104011", "104012"]);

    function createButtonSelectors(form, editor, editorDialog) {
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
            const isCurrentWeaponLevel = select.matches(
                "[data-planner-current-weapon-level-input]",
            );

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
            const isCurrentWeaponLevel = select.matches(
                "[data-planner-current-weapon-level-input]",
            );
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

    function makeWeaponCard(weapon, selected, onSelect) {
        const card = makeElement("button", "weapon-card");
        card.type = "button";
        card.dataset.rarity = String(weapon.rarity);
        card.dataset.weaponId = String(weapon.id);
        card.setAttribute("aria-label", weapon.name);
        card.setAttribute("aria-pressed", String(selected));
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
        for (let index = 0; index < Math.max(1, Math.min(5, Number(weapon.rarity) || 1)); index++) {
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
        const pill = makeElement("span", "weapon-tag", tag?.label || "Unknown");
        pill.dataset.kind = tag?.kind || "source";
        pill.dataset.source = tag?.source || tag?.label || "";
        if (tag?.kind === "signature") pill.title = `${tag.label} - Acquisition: ${tag.source}`;
        body.append(pill);
        card.append(art, body);
        card.addEventListener("click", onSelect);
        return card;
    }

    function renderGoalCost(element, cost, inventory, { isCraftingEnabled, onRetry }) {
        const updaters = [];
        element.replaceChildren();
        element.setAttribute("aria-busy", "false");
        const section = element.closest(".planner-goal-cost");
        section?.querySelector(".planner-cost-status")?.remove();

        if (cost?.status === "not_planned") {
            element.append(makeElement("p", "planner-cost-message", cost.message));
            return updaters;
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
                retry.addEventListener("click", onRetry);
                element.append(retry);
            }
            return updaters;
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
            return updaters;
        }

        if (cost.preview)
            element.append(
                makeElement(
                    "p",
                    "planner-cost-message",
                    "Preview materials: unreleased data; Gachabase. Requirements may change.",
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

                const craftingEnabled = isCraftingEnabled();
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

            updaters.push(updateCraftingDisplay);
            updateCraftingDisplay();
        });

        if (cost.message) {
            element.append(makeElement("p", "planner-cost-note", cost.message));
        }

        return updaters;
    }

    window.CyrenePlannerRender = {
        createButtonSelectors,
        makeElement,
        fitAmountText,
        makeArrow,
        makeProgressionValues,
        makeWeaponCard,
        renderGoalCost,
    };
})();
