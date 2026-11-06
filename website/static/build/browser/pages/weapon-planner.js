(() => {
    const element = (tag, text = "", className = "") => {
        const node = document.createElement(tag);
        node.textContent = text;
        node.className = className;
        return node;
    };
    const artwork = (url) => {
        const img = element("img");
        if (url?.startsWith("https://") || url?.startsWith("/static/images/"))
            img.src = url;
        img.hidden = !img.hasAttribute("src");
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", () => (img.hidden = true), { once: true });
        return img;
    };
    window.initWeaponPlanner = (page, signal) => {
        const find = (selector) => page.querySelector(selector);
        const query = `account_id=${encodeURIComponent(page.dataset.accountId)}`;
        const picker = find("[data-wp-picker]");
        const editor = find("[data-wp-editor]");
        const editorLayout = find("[data-wp-editor-layout]");
        const editorPanel = find("[data-wp-editor-panel]");
        const totalToggle = find("[data-wp-total-toggle]");
        const totalPanel = find("[data-wp-total-panel]");
        const deleteDialog = find("[data-wp-delete-dialog]");
        const choices = find("#wp-choice-popup");
        const search = find("[data-wp-search]");
        const status = find("[data-wp-status]");
        const add = find("[data-wp-add]");
        const save = find("[data-wp-save]");
        let plans = [];
        let catalogue = [];
        let owned = [];
        let draft = null;
        let pendingDeleteKey = null;
        let ready = false;
        let busy = false;
        let revision = 0;
        let inventory = null;
        let craftingEnabled = false;
        let lastCosts = null;
        let activeChoice = null;
        const costCache = new Map();
        const pending = new Map();
        async function request(url, init) {
            const response = await fetch(url, { ...init, signal });
            const body = await response.json();
            if (!response.ok)
                throw new Error(body.detail || body.error || "Couldn't save your weapon plans. Please retry.");
            return body;
        }
        const failed = (error) => error instanceof Error ? error.message : "Please try again.";
        const notify = (message, kind = "success") => {
            if (!signal.aborted)
                window.showCyreneToast?.(message, kind);
        };
        const visible = (weapon) => !weapon.unreleased || document.documentElement.dataset.showUnreleased === "true";
        const canRefine = (weapon) => weapon.rarity >= 3 && ![11416, 15415].includes(weapon.id);
        function closeChoices() {
            if (choices.matches(":popover-open"))
                choices.hidePopover();
            activeChoice?.setAttribute("aria-expanded", "false");
            activeChoice = null;
        }
        function closeTotal() {
            editorLayout.classList.remove("is-total-open");
            totalPanel.hidden = true;
            totalPanel.setAttribute("aria-hidden", "true");
            totalToggle.setAttribute("aria-expanded", "false");
        }
        function positionTotal() {
            if (!editor.open)
                return;
            const rect = editorPanel.getBoundingClientRect();
            const left = (innerWidth - rect.width) / 2;
            const right = left + rect.width;
            const trigger = editorPanel.querySelector("[data-wp-panel]:not([hidden]) .planner-choice-trigger:not([hidden]), [data-wp-panel]:not([hidden]) [data-wp-readonly]:not([hidden])");
            const tabs = editorPanel.querySelector(".weapon-plan-tabs");
            const tabsRect = tabs?.getBoundingClientRect();
            const top = tabsRect
                ? tabsRect.top + (tabsRect.height - totalToggle.offsetHeight) / 2
                : (trigger?.getBoundingClientRect().top ?? rect.top + 92);
            const bookmarkLeft = Math.min(right - 1, innerWidth - 78);
            totalToggle.style.left = `${bookmarkLeft}px`;
            totalToggle.style.top = `${top}px`;
            const panelWidth = Math.min(390, innerWidth - 24);
            const shift = Math.min(Math.max(0, left - 12), Math.max(panelWidth / 2, right + panelWidth - innerWidth + 12));
            const panelHeight = Math.max(280, rect.height - 72);
            const panelTop = Math.max(12, rect.top + (rect.height - panelHeight) / 2);
            const panelLeft = Math.min(right - shift, innerWidth - panelWidth - 12);
            editorLayout.style.setProperty("--planner-total-shift", `${shift}px`);
            editorLayout.style.setProperty("--planner-total-width", `${panelWidth}px`);
            editorLayout.style.setProperty("--planner-total-bookmark-x", `${panelLeft - bookmarkLeft}px`);
            editorLayout.style.setProperty("--planner-total-bookmark-y", `${panelTop - top}px`);
            Object.assign(totalPanel.style, {
                left: `${panelLeft}px`,
                top: `${panelTop + panelHeight / 2}px`,
                width: `${panelWidth}px`,
                height: `${panelHeight}px`,
            });
        }
        totalToggle.addEventListener("click", () => {
            if (editorLayout.classList.contains("is-total-open")) {
                closeTotal();
                return;
            }
            totalPanel.hidden = false;
            totalPanel.setAttribute("aria-hidden", "false");
            totalToggle.setAttribute("aria-expanded", "true");
            positionTotal();
            editorLayout.classList.add("is-total-open");
        });
        const totalObserver = new ResizeObserver(() => {
            requestAnimationFrame(positionTotal);
        });
        totalObserver.observe(editorPanel);
        const totalTabs = editorPanel.querySelector(".weapon-plan-tabs");
        if (totalTabs)
            totalObserver.observe(totalTabs);
        editorLayout.addEventListener("scroll", positionTotal, { signal, passive: true });
        editorLayout.addEventListener("focusin", () => requestAnimationFrame(positionTotal), {
            signal,
        });
        window.addEventListener("resize", positionTotal, { signal });
        window.addEventListener("scroll", positionTotal, { signal, passive: true });
        for (const dialog of [picker, editor, deleteDialog]) {
            dialog
                .querySelectorAll("[data-wp-close]")
                .forEach((button) => button.addEventListener("click", () => dialog.close()));
            let pressedOutside = false;
            const outside = (event) => {
                const rect = (dialog === editor ? editorPanel : dialog).getBoundingClientRect();
                return (event.clientX < rect.left ||
                    event.clientX > rect.right ||
                    event.clientY < rect.top ||
                    event.clientY > rect.bottom);
            };
            dialog.addEventListener("pointerdown", (event) => (pressedOutside =
                (event.target === dialog || event.target === editorLayout) &&
                    outside(event)));
            dialog.addEventListener("click", (event) => {
                if (pressedOutside &&
                    (event.target === dialog || event.target === editorLayout) &&
                    outside(event) &&
                    !busy)
                    dialog.close();
                pressedOutside = false;
            });
            dialog.addEventListener("cancel", (event) => {
                if (busy)
                    event.preventDefault();
            });
        }
        editor.addEventListener("close", () => {
            revision++;
            closeChoices();
            closeTotal();
            totalToggle.style.removeProperty("left");
            totalToggle.style.removeProperty("top");
        });
        signal.addEventListener("abort", () => {
            revision++;
            closeChoices();
            [picker, editor, deleteDialog].forEach((dialog) => dialog.close());
            totalObserver.disconnect();
            clearDrag();
        }, { once: true });
        let cardDrag = null;
        function clearDrag() {
            const drag = cardDrag;
            cardDrag = null;
            if (!drag)
                return null;
            clearTimeout(drag.timer);
            drag.preview?.remove();
            drag.card.classList.remove("is-dragging");
            if (drag.card.hasPointerCapture(drag.pointerId))
                drag.card.releasePointerCapture(drag.pointerId);
            return drag;
        }
        async function reorder(ids, focus) {
            const visibleIds = new Set(ids);
            const byKey = new Map(plans.map((plan) => [plan.key, plan]));
            let index = 0;
            const next = plans.map((plan) => visibleIds.has(plan.key) ? byKey.get(ids[index++]) : plan);
            if (next.every((plan, position) => plan.key === plans[position].key))
                return;
            try {
                if (await persist(next)) {
                    notify("Weapon plans reordered.");
                    if (focus)
                        find(`[data-plan-id="${CSS.escape(focus)}"]`).focus();
                }
            }
            catch (error) {
                if (!signal.aborted) {
                    renderPlans();
                    notify(`Couldn't reorder weapon plans. ${failed(error)}`, "error");
                }
            }
        }
        function finishDrag(commit = false) {
            const drag = clearDrag();
            if (!drag?.active || signal.aborted)
                return;
            if (commit) {
                const ids = [
                    ...find("[data-wp-plans]").querySelectorAll("[data-plan-id]"),
                ].map((card) => card.dataset.planId);
                void reorder(ids);
            }
            else
                renderPlans();
        }
        document.addEventListener("pointerup", (event) => {
            if (cardDrag?.pointerId === event.pointerId)
                finishDrag(true);
        }, { signal });
        document.addEventListener("pointercancel", (event) => {
            if (cardDrag?.pointerId === event.pointerId)
                finishDrag();
        }, { signal });
        window.addEventListener("blur", () => finishDrag(), { signal });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && cardDrag)
                finishDrag();
        }, { signal });
        function enableReordering(card, plan) {
            card.addEventListener("pointerdown", (event) => {
                if (busy ||
                    event.button !== 0 ||
                    !event.isPrimary ||
                    event.target.closest("button,a,input,select,textarea"))
                    return;
                finishDrag();
                const drag = {
                    card,
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    active: false,
                    timer: 0,
                };
                cardDrag = drag;
                drag.timer = window.setTimeout(() => {
                    if (cardDrag !== drag || !card.isConnected)
                        return;
                    const rect = card.getBoundingClientRect();
                    drag.active = true;
                    drag.left = rect.left;
                    drag.top = rect.top;
                    drag.preview = card.cloneNode(true);
                    drag.preview.classList.add("planner-card-drag-preview");
                    drag.preview.setAttribute("aria-hidden", "true");
                    drag.preview.inert = true;
                    Object.assign(drag.preview.style, {
                        width: `${rect.width}px`,
                        height: `${rect.height}px`,
                        left: `${rect.left}px`,
                        top: `${rect.top}px`,
                    });
                    document.body.append(drag.preview);
                    card.classList.add("is-dragging");
                    card.setPointerCapture(event.pointerId);
                    window.getSelection()?.removeAllRanges();
                }, 250);
            });
            card.addEventListener("touchmove", (event) => {
                if (cardDrag?.active)
                    event.preventDefault();
            }, { passive: false });
            card.addEventListener("dragstart", (event) => event.preventDefault());
            card.addEventListener("pointermove", (event) => {
                const drag = cardDrag;
                if (!drag || drag.card !== card || drag.pointerId !== event.pointerId)
                    return;
                if (!drag.active) {
                    if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8)
                        finishDrag();
                    return;
                }
                event.preventDefault();
                Object.assign(drag.preview.style, {
                    left: `${drag.left + event.clientX - drag.x}px`,
                    top: `${drag.top + event.clientY - drag.y}px`,
                });
                const grid = find("[data-wp-plans]");
                const target = document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest(".weapon-plan-card");
                if (!target || target === card || target.parentElement !== grid)
                    return;
                const cards = [...grid.children];
                grid.insertBefore(card, cards.indexOf(card) < cards.indexOf(target) ? target.nextSibling : target);
                card.setPointerCapture(event.pointerId);
            });
            card.addEventListener("keydown", (event) => {
                if (event.target !== card || busy)
                    return;
                if (event.altKey &&
                    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
                    event.preventDefault();
                    const ids = [
                        ...find("[data-wp-plans]").querySelectorAll("[data-plan-id]"),
                    ].map((node) => node.dataset.planId);
                    const index = ids.indexOf(plan.key);
                    const next = index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1);
                    if (next < 0 || next >= ids.length)
                        return;
                    [ids[index], ids[next]] = [ids[next], ids[index]];
                    void reorder(ids, plan.key);
                }
                else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openEditor(plan, true);
                }
                else if (event.key === "Delete") {
                    event.preventDefault();
                    openDelete(plan);
                }
            });
        }
        function synchroniseProgression(plan) {
            if (plan.source === "manual" || plan.source === "unowned")
                return;
            const candidates = owned.filter((weapon) => weapon.id === plan.weapon.id && !weapon.copy_id && !weapon.scan_copy_id);
            const live = candidates.find((weapon) => weapon.equipped === plan.equippedCharacter) ||
                (owned.filter((weapon) => weapon.id === plan.weapon.id).length === 1
                    ? candidates[0]
                    : undefined);
            if (!live)
                return;
            plan.source = "hoyolab";
            plan.weapon = { ...live };
            plan.currentLevel = live.level || plan.currentLevel;
            plan.currentRefinement = live.refinement || plan.currentRefinement;
            plan.targetLevel = Math.max(plan.currentLevel, plan.targetLevel);
            plan.targetRefinement = Math.max(plan.currentRefinement, plan.targetRefinement);
            plan.equippedCharacter = live.equipped || "";
            plan.ascension = live.ascension ?? plan.ascension;
        }
        function renderPlans() {
            if (!ready) {
                find("[data-wp-empty]").hidden = true;
                find("[data-wp-plans]").hidden = true;
                return;
            }
            plans.forEach(synchroniseProgression);
            clearDrag();
            const grid = find("[data-wp-plans]");
            grid.replaceChildren();
            for (const plan of plans) {
                if (!visible(plan.weapon))
                    continue;
                const card = element("article", "", "planner-character-card weapon-plan-card");
                card.tabIndex = 0;
                card.dataset.planId = plan.key;
                card.setAttribute("aria-label", `${plan.weapon.name} plan. Hold to drag, or use Alt and arrow keys to reorder.`);
                card.dataset.rarity = String(plan.weapon.rarity);
                const art = element("div", "", "planner-card-portrait");
                art.append(artwork(plan.weapon.icon));
                const identity = element("div", "", "planner-card-identity");
                identity.append(element("h3", plan.weapon.name));
                art.append(identity);
                if (plan.weapon.unreleased)
                    art.append(element("span", "Unreleased", "cyrene-unreleased-badge weapon-unreleased"));
                const body = element("div", "", "planner-card-content");
                const heading = element("div", "", "weapon-plan-card-heading");
                const actions = element("div", "", "planner-card-actions");
                const edit = element("button", "", "planner-card-edit");
                edit.type = "button";
                edit.setAttribute("aria-label", `Edit ${plan.weapon.name}'s plan`);
                edit.title = `Edit ${plan.weapon.name}'s plan`;
                edit.append(element("span", "", "cyrene-edit"));
                edit.addEventListener("click", () => openEditor(plan, true));
                const remove = element("button", "", "planner-card-remove");
                remove.type = "button";
                remove.setAttribute("aria-label", `Delete ${plan.weapon.name}'s plan`);
                remove.title = `Delete ${plan.weapon.name}'s plan`;
                remove.append(element("span", "", "cyrene-close"));
                remove.addEventListener("click", () => openDelete(plan));
                actions.append(edit, remove);
                heading.append(element("span", plan.weapon.type), actions);
                body.append(heading);
                for (const [label, current, goal, prefix] of [
                    ["Level", plan.currentLevel, plan.targetLevel, "Lv. "],
                    ["Refinements", plan.currentRefinement, plan.targetRefinement, "R"],
                ]) {
                    const row = element("div", "", "planner-card-goals");
                    const field = element("div", "", "planner-card-goal");
                    const values = element("div", "", "planner-card-level-values");
                    values.classList.toggle("has-goal", current !== goal);
                    values.append(element("strong", `${prefix}${current}`));
                    if (current !== goal) {
                        const arrow = element("span", "", "cyrene-arrow");
                        arrow.setAttribute("aria-hidden", "true");
                        values.append(arrow, element("strong", `${prefix}${goal}`));
                    }
                    field.append(element("span", label), values);
                    row.append(field);
                    body.append(row);
                }
                card.append(art, body);
                enableReordering(card, plan);
                grid.append(card);
            }
            status.textContent = plans.length
                ? `${plans.length} saved weapon plans`
                : "No weapon plans yet. Add a weapon to get started.";
            const hasPlans = plans.some((plan) => visible(plan.weapon));
            find("[data-wp-empty]").hidden = !ready || hasPlans;
            grid.hidden = !hasPlans;
            status.hidden = ready;
        }
        async function hydrate() {
            ready = false;
            add.disabled = true;
            status.classList.add("planner-loading");
            status.textContent = "Loading your plans\u2026";
            status.hidden = false;
            find("[data-wp-retry]").hidden = true;
            try {
                const result = await request(`/api/weapons/plans?${query}`);
                if (signal.aborted)
                    return;
                plans = result.plans;
                ready = true;
                add.disabled = false;
                status.classList.remove("planner-loading");
                renderPlans();
            }
            catch (error) {
                if (signal.aborted)
                    return;
                status.classList.remove("planner-loading");
                status.textContent = `Couldn't load saved weapon plans. ${failed(error)}`;
                find("[data-wp-retry]").hidden = false;
            }
        }
        const pickerFilters = { type: "", rarity: "", tag: "", ownership: "all" };
        function progressionPill(weapon) {
            const pill = element("span", "", "weapon-progression-pill");
            pill.append(element("span", `Lv. ${weapon.level || 1}`), element("span", `R${weapon.refinement || 1}`));
            if (weapon.equipped) {
                const character = element("span", "", "weapon-progression-character");
                if (weapon.character_icon)
                    character.append(artwork(weapon.character_icon));
                character.append(element("span", weapon.equipped));
                pill.append(character);
            }
            return pill;
        }
        function renderPicker() {
            const term = search.value.trim().toLocaleLowerCase();
            const matches = (weapon) => visible(weapon) &&
                (!pickerFilters.type || weapon.type === pickerFilters.type) &&
                (!pickerFilters.rarity || weapon.rarity === Number(pickerFilters.rarity)) &&
                (!pickerFilters.tag ||
                    (pickerFilters.tag === "signature"
                        ? weapon.tag?.kind === "signature"
                        : weapon.tag?.source === pickerFilters.tag)) &&
                `${weapon.name} ${weapon.tag?.label || ""} ${weapon.type}`
                    .toLocaleLowerCase()
                    .includes(term);
            const grid = find("[data-wp-picker-grid]");
            grid.replaceChildren();
            let shown = 0;
            const ownedIds = new Set(owned.map((weapon) => weapon.id));
            const unowned = catalogue.filter((weapon) => !ownedIds.has(weapon.id));
            for (const [title, source] of [
                ["Owned copies", owned],
                ["Not owned", unowned],
            ]) {
                if ((pickerFilters.ownership === "owned" && title !== "Owned copies") ||
                    (pickerFilters.ownership === "unowned" && title === "Owned copies"))
                    continue;
                const rows = source.filter(matches);
                if (!rows.length)
                    continue;
                for (const weapon of rows) {
                    shown++;
                    const card = element("button", "", "planner-picker-character weapon-plan-picker-card");
                    card.type = "button";
                    card.dataset.rarity = String(weapon.rarity);
                    card.dataset.plannerCharacterRarity = String(weapon.rarity);
                    card.dataset.ownership = title === "Owned copies" ? "owned" : "unowned";
                    const art = element("span", "", "planner-picker-portrait");
                    art.append(artwork(weapon.icon));
                    const rarity = element("span", String(weapon.rarity), "planner-picker-rarity");
                    const star = element("span", "", "weapon-rarity-star");
                    star.dataset.rarity = String(weapon.rarity);
                    rarity.append(star);
                    art.append(rarity);
                    if (weapon.unreleased)
                        art.append(element("span", "Unreleased", "cyrene-unreleased-badge weapon-unreleased"));
                    const body = element("span", "", "planner-picker-character-info");
                    body.append(element("h3", weapon.name));
                    if (title === "Owned copies")
                        body.append(progressionPill(weapon));
                    else
                        body.append(element("span", "Not owned", "character-unowned-status"));
                    if (weapon.tag) {
                        const tag = element("span", weapon.tag.label, "weapon-tag");
                        tag.dataset.kind = weapon.tag.kind;
                        tag.dataset.source = weapon.tag.source;
                        body.append(tag);
                    }
                    card.append(art, body);
                    card.addEventListener("click", () => {
                        picker.close();
                        const currentLevel = title === "Owned copies" ? weapon.level || 1 : 1;
                        const currentRefinement = canRefine(weapon) && title === "Owned copies"
                            ? weapon.refinement || 1
                            : 1;
                        openEditor({
                            key: crypto.randomUUID(),
                            weapon: {
                                ...weapon,
                                level: currentLevel,
                                refinement: currentRefinement,
                            },
                            currentLevel,
                            targetLevel: currentLevel,
                            currentRefinement,
                            targetRefinement: currentRefinement,
                            ascension: weapon.ascension ?? null,
                            source: title !== "Owned copies"
                                ? "unowned"
                                : weapon.copy_id
                                    ? "manual"
                                    : weapon.scan_copy_id
                                        ? "imported"
                                        : "hoyolab",
                            equippedCharacter: weapon.equipped || "",
                        }, false);
                    });
                    grid.append(card);
                }
            }
            const summary = find("[data-wp-picker-count]");
            const base = pickerFilters.ownership === "owned"
                ? owned
                : pickerFilters.ownership === "unowned"
                    ? unowned
                    : [...owned, ...unowned];
            summary.replaceChildren("Showing ", element("strong", String(shown)), " of ", element("strong", String(base.filter(visible).length)), " weapons ", element("span", "|", "characters-count-divider"), " ", element("strong", String(owned.filter(visible).length)), " owned ", element("span", "|", "characters-count-divider"), " ", element("strong", String([...owned, ...unowned].filter(visible).length)), " Total");
            find("[data-wp-picker-empty]").hidden = shown !== 0;
        }
        add.addEventListener("click", () => {
            search.value = "";
            renderPicker();
            picker.showModal();
            search.focus();
        });
        for (const group of picker.querySelectorAll("[data-wp-filter]")) {
            group.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
                pickerFilters[group.dataset.wpFilter] =
                    button.dataset.value;
                group.querySelectorAll("button").forEach((option) => {
                    option.classList.toggle("selected", option === button);
                    option.setAttribute("aria-pressed", String(option === button));
                });
                renderPicker();
            }));
        }
        function setPickerSelect(key, value) {
            pickerFilters[key] = value;
            const control = picker.querySelector(`[data-wp-select="${key}"]`);
            control.querySelectorAll("[role=option]").forEach((option) => {
                const selected = option.dataset.value === value;
                option.classList.toggle("selected", selected);
                option.setAttribute("aria-selected", String(selected));
                if (selected)
                    control.querySelector(".custom-select-value").textContent = option.textContent;
            });
            control.classList.remove("open");
            control.querySelector(".custom-select-button").setAttribute("aria-expanded", "false");
        }
        picker.querySelectorAll("[data-wp-select]").forEach((control) => {
            control.querySelectorAll("[role=option]").forEach((option) => option.addEventListener("click", () => {
                setPickerSelect(control.dataset.wpSelect, option.dataset.value);
                renderPicker();
                control.querySelector(".custom-select-button").focus();
            }));
            control.addEventListener("keydown", (event) => {
                if (!["ArrowDown", "ArrowUp"].includes(event.key))
                    return;
                const options = [...control.querySelectorAll("[role=option]")];
                const index = options.indexOf(document.activeElement);
                if (index < 0)
                    return;
                event.preventDefault();
                options[(index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length].focus();
            });
        });
        find("[data-wp-filter-reset]").addEventListener("click", () => {
            pickerFilters.type = pickerFilters.rarity = "";
            setPickerSelect("tag", "");
            setPickerSelect("ownership", "all");
            search.value = "";
            picker.querySelectorAll("[data-wp-filter] button").forEach((button) => {
                const active = button.dataset.value === "";
                button.classList.toggle("selected", active);
                button.setAttribute("aria-pressed", String(active));
            });
            renderPicker();
        });
        search.addEventListener("input", renderPicker);
        find("[data-wp-first]").addEventListener("click", () => add.click());
        page.addEventListener("weapons-data", (event) => {
            const detail = event
                .detail;
            catalogue = detail.catalogue;
            owned = detail.owned;
            if (ready)
                renderPlans();
            if (picker.open)
                renderPicker();
        }, { signal });
        window.addEventListener("cyrene-content-preferences-changed", () => {
            if (ready)
                renderPlans();
            if (picker.open)
                renderPicker();
        }, { signal });
        function selectTab(name) {
            for (const tab of editor.querySelectorAll("[data-wp-tab]")) {
                const active = tab.dataset.wpTab === name;
                tab.classList.toggle("active", active);
                tab.classList.toggle("is-active", active);
                tab.setAttribute("aria-selected", String(active));
                tab.tabIndex = active ? 0 : -1;
            }
            for (const panel of editor.querySelectorAll("[data-wp-panel]"))
                panel.hidden = panel.dataset.wpPanel !== name;
            requestAnimationFrame(positionTotal);
        }
        const tabs = [...editor.querySelectorAll("[data-wp-tab]")];
        tabs.forEach((tab, index) => {
            tab.addEventListener("click", () => selectTab(tab.dataset.wpTab));
            tab.addEventListener("keydown", (event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                    return;
                event.preventDefault();
                const target = tabs[event.key === "Home"
                    ? 0
                    : event.key === "End"
                        ? tabs.length - 1
                        : (index + 1) % tabs.length];
                target.click();
                target.focus();
            });
        });
        function updateFields() {
            if (!draft)
                return;
            for (const button of editor.querySelectorAll("[data-wp-choice]")) {
                const field = button.dataset.wpChoice;
                button.querySelector("span").textContent =
                    `${field.includes("Level") ? "Lv. " : "R"}${draft[field]}`;
                const options = progressionOptions(field);
                const fixed = (field.startsWith("current") && draft.source === "hoyolab") ||
                    (field.includes("Refinement") && !canRefine(draft.weapon)) ||
                    (options.length <= 1 && options[0] === draft[field]);
                button.hidden = fixed;
                button.disabled = fixed;
                const readonly = find(`[data-wp-readonly="${field}"]`);
                readonly.hidden = !fixed;
                readonly.textContent = button.querySelector("span").textContent;
            }
            find("[data-wp-progression]").textContent =
                `Lv. ${draft.currentLevel} → ${draft.targetLevel} · R${draft.currentRefinement} → R${draft.targetRefinement}`;
        }
        function openEditor(plan, _existing) {
            if (busy)
                return;
            synchroniseProgression(plan);
            draft = structuredClone(plan);
            const live = owned.find((weapon) => weapon.id === plan.weapon.id &&
                !weapon.copy_id &&
                !weapon.scan_copy_id &&
                (plan.equippedCharacter
                    ? weapon.equipped === plan.equippedCharacter
                    : weapon.level === plan.currentLevel &&
                        weapon.refinement === plan.currentRefinement));
            if (plan.source === "hoyolab" || (!plan.source && live)) {
                draft.source = "hoyolab";
                if (live) {
                    draft.currentLevel = live.level || draft.currentLevel;
                    draft.currentRefinement = live.refinement || draft.currentRefinement;
                    draft.targetLevel = Math.max(draft.currentLevel, draft.targetLevel);
                    draft.targetRefinement = Math.max(draft.currentRefinement, draft.targetRefinement);
                    draft.equippedCharacter = live.equipped || "";
                    draft.ascension = live.ascension ?? draft.ascension;
                }
            }
            editor.dataset.rarity = String(plan.weapon.rarity);
            find("#wp-editor-title").textContent = plan.weapon.name;
            const icon = find("[data-wp-icon]");
            icon.removeAttribute("src");
            if (plan.weapon.icon.startsWith("https://"))
                icon.src = plan.weapon.icon;
            find("[data-wp-save-status]").textContent = "";
            updateFields();
            selectTab("level");
            editor.showModal();
            positionTotal();
            requestAnimationFrame(() => {
                positionTotal();
                requestAnimationFrame(positionTotal);
            });
            window.setTimeout(positionTotal, 180);
            void updateCosts();
        }
        function progressionOptions(field) {
            if (!draft)
                return [];
            const level = field.includes("Level");
            const min = level ? draft.currentLevel : draft.currentRefinement;
            const max = level ? (draft.weapon.rarity <= 2 ? 70 : 90) : 5;
            return (level ? [1, 20, 40, 50, 60, 70, 80, 90] : [1, 2, 3, 4, 5]).filter((value) => value >= min && value <= max);
        }
        for (const button of editor.querySelectorAll("[data-wp-choice]")) {
            let pressedWhileOpen = false;
            button.addEventListener("pointerdown", () => {
                pressedWhileOpen = activeChoice === button && choices.matches(":popover-open");
            });
            button.addEventListener("click", () => {
                if (!draft)
                    return;
                if (pressedWhileOpen ||
                    (activeChoice === button && choices.matches(":popover-open"))) {
                    pressedWhileOpen = false;
                    closeChoices();
                    return;
                }
                closeChoices();
                const field = button.dataset.wpChoice;
                const level = field.includes("Level");
                const grid = find("[data-wp-choices]");
                grid.replaceChildren();
                for (const value of progressionOptions(field)) {
                    const option = element("button", `${level ? "Lv. " : "R"}${value}`, "planner-choice-option");
                    option.type = "button";
                    option.classList.toggle("selected", value === draft[field]);
                    option.setAttribute("aria-pressed", String(value === draft[field]));
                    option.addEventListener("click", () => {
                        if (!draft)
                            return;
                        draft[field] = value;
                        draft.targetLevel = Math.max(draft.currentLevel, draft.targetLevel);
                        draft.targetRefinement = Math.max(draft.currentRefinement, draft.targetRefinement);
                        if (field === "currentLevel")
                            draft.ascension = null;
                        updateFields();
                        closeChoices();
                        button.focus();
                        void updateCosts();
                    });
                    grid.append(option);
                }
                activeChoice = button;
                button.setAttribute("aria-expanded", "true");
                choices.showPopover();
                const rect = button.getBoundingClientRect();
                const width = Math.min(310, innerWidth - 24);
                choices.style.width = `${width}px`;
                choices.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
                const height = Math.min(300, choices.scrollHeight, innerHeight - 24);
                choices.style.top = `${rect.bottom + height + 12 <= innerHeight ? rect.bottom + 6 : Math.max(12, rect.top - height - 6)}px`;
                grid.querySelector(".selected")?.focus();
            });
        }
        choices.addEventListener("toggle", () => {
            if (!choices.matches(":popover-open")) {
                activeChoice?.setAttribute("aria-expanded", "false");
                activeChoice = null;
            }
        });
        window.addEventListener("resize", closeChoices, { signal });
        async function costs(plan) {
            const key = JSON.stringify(plan);
            if (costCache.has(key))
                return costCache.get(key);
            if (pending.has(key))
                return pending.get(key);
            const work = request(`/api/weapons/planner-costs?${query}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: key,
            })
                .then((result) => {
                if (Object.values(result.costs).every((cost) => ["ok", "complete"].includes(cost.status)))
                    costCache.set(key, result.costs);
                return result.costs;
            })
                .finally(() => pending.delete(key));
            pending.set(key, work);
            return work;
        }
        function combine(sections) {
            const items = new Map();
            for (const cost of sections) {
                for (const item of cost.items) {
                    const key = String(item.id);
                    const previous = items.get(key);
                    items.set(key, { ...item, amount: item.amount + (previous?.amount || 0) });
                }
            }
            const incomplete = sections.some((cost) => !["ok", "complete"].includes(cost.status));
            return {
                status: incomplete ? "unavailable" : items.size ? "ok" : "complete",
                items: [...items.values()],
                message: incomplete
                    ? "Some costs are unavailable. This total is incomplete; retry to load all materials."
                    : undefined,
                preview: sections.some((cost) => cost.preview),
            };
        }
        function renderCost(container, cost, retry) {
            container.replaceChildren();
            const section = container.closest(".planner-goal-cost");
            section?.querySelector(".planner-cost-status")?.remove();
            if (["ok", "complete"].includes(cost.status)) {
                const status = element("span", cost.status === "complete" ? "Done" : "Required", "planner-cost-status");
                status.classList.toggle("is-complete", cost.status === "complete");
                if (cost.status === "complete")
                    status.prepend(element("span", "", "cyrene-check"));
                section?.querySelector("h3")?.append(status);
            }
            const compact = window.CyrenePlannerMaterials.compact;
            const crafting = inventory
                ? window.CyrenePlannerMaterials.craftingPlan(cost.items, inventory)
                : new Map();
            if (cost.preview)
                container.append(element("p", "Preview materials — subject to change.", "planner-cost-message"));
            if (cost.message)
                container.append(element("p", cost.message, "planner-cost-message"));
            if (!cost.items.length && cost.status === "complete" && !cost.message)
                container.append(element("p", "Goal reached. No materials needed.", "planner-cost-message"));
            const grid = element("div", "", "planner-cost-grid");
            for (const item of cost.items) {
                const entry = element("article", "", "planner-cost-entry");
                const tile = element("button", "", "planner-cost-tile");
                tile.type = "button";
                tile.dataset.rarity = String(item.rarity || 1);
                const art = element("span", "", "planner-cost-artwork");
                const fallback = element("span", item.name, "planner-cost-fallback");
                const icon = artwork(item.icon);
                icon.addEventListener("load", () => (fallback.hidden = true));
                art.append(fallback, icon);
                const quantity = element("span", "", "planner-cost-quantity");
                quantity.append(element("span", `×${compact(item.amount)}`, "planner-cost-required"));
                const tooltip = element("span", "", "planner-cost-tooltip");
                tooltip.append(element("strong", item.name), element("span", `Required: ${item.amount.toLocaleString("en-GB")}`));
                const held = inventory?.get(String(item.id));
                if (inventory &&
                    (held !== undefined ||
                        (!item.inventory_unavailable &&
                            !String(item.id).startsWith("weapon:") &&
                            !["104001", "104002", "104011", "104012"].includes(String(item.id))))) {
                    const craftResult = craftingEnabled ? crafting.get(String(item.id)) : undefined;
                    const effective = craftResult ? craftResult.after : held || 0;
                    const remaining = Math.max(0, item.amount - effective);
                    const ownedBadge = element("span", compact(held || 0), "planner-cost-owned");
                    entry.append(ownedBadge);
                    quantity.classList.add(remaining
                        ? "is-short"
                        : (held || 0) >= item.amount
                            ? "is-enough"
                            : "is-craft-enough");
                    if (craftResult) {
                        tile.classList.add(craftResult.enough ? "is-craft-enough" : "is-craft-short");
                        if (craftResult.after !== craftResult.before) {
                            ownedBadge.textContent = `${compact(craftResult.before)} → ${compact(craftResult.after)}`;
                            ownedBadge.classList.add(craftResult.after > craftResult.before
                                ? "is-craft-gain"
                                : "is-craft-spent");
                        }
                    }
                    quantity.append(element("span", `(${compact(remaining)})`, "planner-cost-remaining"));
                    tooltip.append(element("span", `Owned: ${(held || 0).toLocaleString("en-GB")} · Remaining: ${remaining.toLocaleString("en-GB")}${craftResult ? " after crafting" : ""}`));
                }
                else if (inventory) {
                    entry.append(element("span", "—", "planner-cost-owned"));
                    quantity.append(element("span", "(—)", "planner-cost-remaining"));
                }
                tile.setAttribute("aria-label", `${item.name}. Required: ${item.amount.toLocaleString("en-GB")}`);
                tile.append(art, quantity);
                entry.append(tile, tooltip);
                const positionTooltip = () => {
                    const bounds = (entry.closest("[data-wp-total-panel]") || editorPanel).getBoundingClientRect();
                    const anchor = entry.getBoundingClientRect();
                    tooltip.style.maxWidth = `${Math.min(240, bounds.width - 48)}px`;
                    const width = tooltip.getBoundingClientRect().width;
                    tooltip.style.left = `${Math.max(bounds.left + 12, Math.min(anchor.left, bounds.right - width - 12)) - anchor.left}px`;
                };
                entry.addEventListener("pointerenter", positionTooltip);
                entry.addEventListener("focusin", positionTooltip);
                grid.append(entry);
            }
            if (cost.items.length)
                container.append(grid);
            requestAnimationFrame(() => {
                container
                    .querySelectorAll(".planner-cost-quantity, .planner-cost-owned")
                    .forEach((label) => {
                    let size = label.classList.contains("planner-cost-owned") ? 10.88 : 12;
                    label.style.fontSize = `${size}px`;
                    while (size > 9 && label.scrollWidth > label.clientWidth) {
                        size -= 0.5;
                        label.style.fontSize = `${size}px`;
                    }
                });
                positionTotal();
            });
            if (!["ok", "complete"].includes(cost.status) && retry) {
                const button = element("button", "Retry costs", "cyrene-button");
                button.type = "button";
                button.addEventListener("click", retry);
                container.append(button);
            }
        }
        async function updateCosts() {
            if (!draft)
                return;
            lastCosts = null;
            const current = ++revision;
            const containers = [
                find('[data-wp-cost="level"]'),
                find('[data-wp-cost="refinements"]'),
                find("[data-wp-editor-total]"),
            ];
            containers.forEach((container) => container.replaceChildren(element("p", "Loading materials...", "weapons-note")));
            try {
                const result = await costs(structuredClone(draft));
                if (signal.aborted || current !== revision || !editor.open)
                    return;
                lastCosts = result;
                renderCost(containers[0], result.level, () => void updateCosts());
                renderCost(containers[1], result.refinements, () => void updateCosts());
                renderCost(containers[2], combine(Object.values(result)), () => void updateCosts());
            }
            catch (error) {
                if (signal.aborted || current !== revision)
                    return;
                containers.forEach((container) => renderCost(container, { status: "unavailable", items: [], message: failed(error) }, () => void updateCosts()));
            }
        }
        find("[data-wp-crafting]").addEventListener("click", (event) => {
            craftingEnabled = !craftingEnabled;
            event.currentTarget.setAttribute("aria-pressed", String(craftingEnabled));
            if (!lastCosts)
                return;
            renderCost(find('[data-wp-cost="level"]'), lastCosts.level, () => void updateCosts());
            renderCost(find('[data-wp-cost="refinements"]'), lastCosts.refinements, () => void updateCosts());
            renderCost(find("[data-wp-editor-total]"), combine(Object.values(lastCosts)), () => void updateCosts());
        });
        async function persist(next) {
            if (!ready || busy)
                return false;
            busy = true;
            save.disabled = true;
            try {
                const result = await request(`/api/weapons/plans?${query}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ plans: next }),
                });
                if (signal.aborted)
                    return false;
                plans = result.plans;
                renderPlans();
                return true;
            }
            finally {
                busy = false;
                save.disabled = false;
            }
        }
        save.addEventListener("click", async () => {
            if (!draft || busy)
                return;
            const message = find("[data-wp-save-status]");
            message.textContent = "Saving plan...";
            try {
                if (await persist(plans.some((plan) => plan.key === draft.key)
                    ? plans.map((plan) => plan.key === draft.key ? structuredClone(draft) : plan)
                    : [...plans, structuredClone(draft)])) {
                    editor.close();
                    notify("Weapon plan saved.");
                }
            }
            catch (error) {
                if (!signal.aborted) {
                    message.textContent = failed(error);
                    notify(failed(error), "error");
                }
            }
        });
        function openDelete(plan) {
            if (busy)
                return;
            pendingDeleteKey = plan.key;
            find("[data-wp-delete-name]").textContent =
                `Delete the plan for ${plan.weapon.name}? Your weapon inventory is kept.`;
            find("[data-wp-delete-status]").textContent = "";
            deleteDialog.showModal();
            find("[data-wp-delete-cancel]").focus();
        }
        find("[data-wp-delete-cancel]").addEventListener("click", () => {
            if (!busy)
                deleteDialog.close();
        });
        find("[data-wp-delete-confirm]").addEventListener("click", async (event) => {
            if (!pendingDeleteKey || busy)
                return;
            const button = event.currentTarget;
            button.disabled = true;
            try {
                if (await persist(plans.filter((plan) => plan.key !== pendingDeleteKey))) {
                    deleteDialog.close();
                    pendingDeleteKey = null;
                    notify("Weapon plan deleted.");
                }
            }
            catch (error) {
                if (!signal.aborted)
                    find("[data-wp-delete-status]").textContent = failed(error);
                notify(failed(error), "error");
            }
            finally {
                button.disabled = false;
            }
        });
        find("[data-wp-retry]").addEventListener("click", () => void hydrate());
        void request(`/api/inventory?${query}`)
            .then((result) => {
            inventory = new Map(result.inventory.map((item) => [String(item.id), item.amount]));
            if (editor.open)
                void updateCosts();
        })
            .catch(() => {
            /* Required costs remain useful when inventory is unavailable. */
        });
        void hydrate();
    };
})();
