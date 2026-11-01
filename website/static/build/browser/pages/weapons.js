(() => {
    window.initWeapons = () => {
        const page = document.querySelector("[data-weapons-page]");
        if (!page || page.dataset.initialised)
            return;
        window.disposeWeapons?.();
        const lifecycle = new AbortController();
        page.dataset.initialised = "true";
        const grid = page.querySelector("[data-weapons-grid]");
        if (!grid)
            return;
        const status = page.querySelector("[data-weapons-status]");
        const count = page.querySelector("[data-weapons-count]");
        const search = page.querySelector("[data-weapons-search]");
        const type = page.querySelector("[data-weapons-type]");
        const rarity = page.querySelector("[data-weapons-rarity]");
        const refresh = page.querySelector("[data-weapons-retry]");
        let tab = "owned";
        let data = null;
        let manual = [];
        let scanned = [];
        let combinedOwned = [];
        let scanError = "";
        function mergeOwned() {
            const inventory = scanned.map((weapon) => ({ ...weapon }));
            const unmatched = [];
            const matched = new Set();
            const normalise = (name) => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
            const nickname = normalise(page.dataset.accountNickname || "");
            const liveWeapons = (data?.owned || []).map((weapon) => ({ ...weapon }));
            for (const weapon of [...inventory, ...liveWeapons]) {
                if (nickname && normalise(weapon.equipped || "") === nickname) {
                    weapon.equipped = "Traveler";
                }
            }
            const liveByCharacter = new Map(liveWeapons.filter(w => w.equipped).map(w => [normalise(w.equipped), w]));
            for (const weapon of inventory) {
                const equipped = weapon.equipped && liveByCharacter.get(normalise(weapon.equipped));
                if (equipped && equipped.id !== weapon.id) {
                    delete weapon.equipped;
                    delete weapon.character_icon;
                    delete weapon.character_rarity;
                }
            }
            for (const live of liveWeapons) {
                let index = inventory.findIndex((weapon, i) => !matched.has(i) &&
                    weapon.id === live.id &&
                    weapon.equipped &&
                    live.equipped &&
                    normalise(weapon.equipped) === normalise(live.equipped));
                if (index < 0)
                    index = inventory.findIndex((weapon, i) => !matched.has(i) &&
                        weapon.id === live.id &&
                        weapon.level === live.level &&
                        weapon.refinement === live.refinement &&
                        (!weapon.equipped || !weapon.character_icon));
                if (index < 0)
                    index = inventory.findIndex((weapon, i) => !matched.has(i) && weapon.id === live.id && (!weapon.equipped || !weapon.character_icon));
                if (index < 0)
                    unmatched.push(live);
                else {
                    matched.add(index);
                    inventory[index] = { ...inventory[index], ...live };
                }
            }
            combinedOwned = [...inventory, ...unmatched];
        }
        let manualError = "";
        let selectedWeapon = null;
        const dialog = page.querySelector("[data-weapon-dialog]");
        const addForm = page.querySelector("[data-weapon-add-form]");
        const deleteDialog = page.querySelector("[data-weapon-delete-dialog]");
        const deleteConfirm = page.querySelector("[data-weapon-delete-confirm]");
        const deleteCancel = page.querySelector("[data-weapon-delete-cancel]");
        let pendingDelete = null;
        let restoreManualControl = null;
        let deleting = false;
        const importDialog = page.querySelector("[data-weapon-import-dialog]");
        const importButton = page.querySelector("[data-weapons-import]");
        const importFile = page.querySelector("[data-weapons-import-file]");
        const importConfirm = page.querySelector("[data-weapon-import-confirm]");
        const importCancel = page.querySelector("[data-weapon-import-cancel]");
        const importStatus = page.querySelector("[data-weapon-import-status]");
        let importPayload = null;
        let importing = false;
        importButton.addEventListener("click", () => importFile.click());
        importCancel.addEventListener("click", () => importDialog.close());
        importDialog.addEventListener("cancel", (event) => {
            if (importing)
                event.preventDefault();
        });
        importFile.addEventListener("change", async () => {
            const file = importFile.files?.[0];
            importFile.value = "";
            if (!file)
                return;
            importButton.disabled = true;
            manualStatus.textContent = "Reading weapon export...";
            try {
                if (file.size > 4 * 1024 * 1024)
                    throw new Error("The weapon export exceeds 4 MB.");
                importPayload = JSON.parse(await file.text());
                const response = await fetch(`/api/weapons/import/preview?${accountQuery}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(importPayload),
                });
                const result = (await response.json());
                if (!response.ok)
                    throw new Error(result.detail || "Couldn't read this weapon export.");
                page.querySelector("[data-weapon-import-summary]").textContent =
                    `Import ${result.count} weapons for UID ${result.uid}?`;
                importStatus.textContent = "";
                manualStatus.textContent = "";
                importDialog.showModal();
                importCancel.focus();
            }
            catch (error) {
                manualStatus.textContent =
                    error instanceof Error ? error.message : "Couldn't read this weapon export.";
            }
            finally {
                importButton.disabled = false;
            }
        });
        importConfirm.addEventListener("click", async () => {
            if (!importPayload || importing)
                return;
            importing = true;
            importConfirm.disabled = true;
            importCancel.disabled = true;
            importStatus.textContent = "Saving inventory...";
            try {
                const response = await fetch(`/api/weapons/import?${accountQuery}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(importPayload),
                });
                const result = (await response.json());
                if (!response.ok)
                    throw new Error(result.detail || "Couldn't save the weapon inventory.");
                scanned = result.weapons;
                scanError = "";
                mergeOwned();
                cardCaches.owned.clear();
                renderedTab = "";
                importDialog.close();
                importPayload = null;
                search.value = "";
                page.querySelector('[data-weapons-tab="owned"]').click();
            }
            catch (error) {
                importStatus.textContent =
                    error instanceof Error ? error.message : "Couldn't save the weapon inventory.";
            }
            finally {
                importing = false;
                importConfirm.disabled = false;
                importCancel.disabled = false;
            }
        });
        deleteCancel.addEventListener("click", () => deleteDialog.close());
        deleteDialog.addEventListener("cancel", (event) => {
            if (deleting)
                event.preventDefault();
        });
        deleteDialog.addEventListener("close", () => {
            restoreManualControl?.();
            restoreManualControl = null;
            pendingDelete = null;
        });
        deleteConfirm.addEventListener("click", async () => {
            if (!(pendingDelete?.copy_id || pendingDelete?.scan_copy_id) || deleting)
                return;
            deleting = true;
            deleteConfirm.disabled = true;
            deleteCancel.disabled = true;
            const message = page.querySelector("[data-weapon-delete-status]");
            message.textContent = "Deleting weapon...";
            try {
                const response = await fetch(`/api/weapons/${pendingDelete.scan_copy_id ? "scanned" : "manual"}/${encodeURIComponent(pendingDelete.scan_copy_id || pendingDelete.copy_id)}?${accountQuery}`, { method: "DELETE" });
                if (!response.ok)
                    throw new Error();
                if (pendingDelete.scan_copy_id) {
                    scanned = scanned.filter((weapon) => weapon.scan_copy_id !== pendingDelete.scan_copy_id);
                    mergeOwned();
                }
                else
                    manual = manual.filter((weapon) => weapon.copy_id !== pendingDelete.copy_id);
                manualError = "";
                deleteDialog.close();
                render();
            }
            catch {
                message.textContent = "Couldn't delete this weapon. Please try again.";
            }
            finally {
                deleting = false;
                deleteConfirm.disabled = false;
                deleteCancel.disabled = false;
            }
        });
        const manualStatus = page.querySelector("[data-weapons-manual-status]");
        const accountQuery = `account_id=${encodeURIComponent(page.dataset.accountId)}`;
        const choicePopup = page.querySelector("#weapon-choice-popup");
        const choiceGrid = page.querySelector("[data-weapon-choice-grid]");
        let choiceTrigger = null;
        const closeChoices = () => {
            if (choicePopup.matches(":popover-open"))
                choicePopup.hidePopover();
            choiceTrigger?.setAttribute("aria-expanded", "false");
            choiceTrigger = null;
        };
        for (const trigger of page.querySelectorAll("[data-weapon-choice]")) {
            let pressedWhileOpen = false;
            trigger.addEventListener("pointerdown", () => {
                pressedWhileOpen =
                    choiceTrigger === trigger && choicePopup.matches(":popover-open");
            });
            trigger.addEventListener("click", () => {
                if (pressedWhileOpen ||
                    (choiceTrigger === trigger && choicePopup.matches(":popover-open"))) {
                    pressedWhileOpen = false;
                    closeChoices();
                    return;
                }
                closeChoices();
                const field = trigger.dataset.weaponChoice;
                const input = addForm.elements.namedItem(field);
                const maximum = field === "refinement" ? 5 : selectedWeapon.rarity <= 2 ? 70 : 90;
                choiceGrid.replaceChildren();
                choicePopup.setAttribute("aria-label", `Choose weapon ${field}`);
                const values = field === "refinement"
                    ? [1, 2, 3, 4, 5]
                    : [1, 20, 40, 50, 60, 70, 80, 90].filter((value) => value <= maximum);
                for (const value of values) {
                    const option = text("button", field === "refinement" ? `R${value}` : `Lv. ${value}`, "planner-choice-option");
                    option.type = "button";
                    const active = Number(input.value) === value;
                    option.classList.toggle("is-selected", active);
                    option.setAttribute("aria-pressed", String(active));
                    option.addEventListener("click", () => {
                        input.value = String(value);
                        trigger.querySelector(".planner-choice-value").textContent =
                            option.textContent;
                        closeChoices();
                        trigger.focus();
                    });
                    choiceGrid.append(option);
                }
                choiceTrigger = trigger;
                trigger.setAttribute("aria-expanded", "true");
                choicePopup.showPopover();
                const rect = trigger.getBoundingClientRect();
                const width = Math.min(260, window.innerWidth - 24);
                choicePopup.style.width = `${width}px`;
                choicePopup.style.left = `${Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12))}px`;
                const height = choicePopup.offsetHeight;
                choicePopup.style.top = `${Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - height - 12))}px`;
                const active = choiceGrid.querySelector(".is-selected") ||
                    choiceGrid.querySelector("button");
                active.scrollIntoView({ block: "nearest" });
                active.focus({ preventScroll: true });
            });
        }
        choicePopup.addEventListener("toggle", () => {
            if (!choicePopup.matches(":popover-open")) {
                choiceTrigger?.setAttribute("aria-expanded", "false");
                choiceTrigger = null;
            }
        });
        dialog.addEventListener("close", closeChoices);
        for (const modal of [dialog, deleteDialog, importDialog]) {
            let backdropPress = false;
            const outside = (event) => {
                const rect = modal.getBoundingClientRect();
                return (event.clientX < rect.left ||
                    event.clientX > rect.right ||
                    event.clientY < rect.top ||
                    event.clientY > rect.bottom);
            };
            modal.addEventListener("pointerdown", (event) => {
                backdropPress = event.target === modal && outside(event);
            });
            modal.addEventListener("click", (event) => {
                if (backdropPress &&
                    event.target === modal &&
                    outside(event) &&
                    !(modal === deleteDialog && deleting) &&
                    !(modal === importDialog && importing))
                    modal.close();
                backdropPress = false;
            });
        }
        window.addEventListener("resize", closeChoices, { signal: lifecycle.signal });
        const cardCaches = {
            owned: new Map(),
            catalogue: new Map(),
        };
        let renderedTab = "";
        let renderedSource = [];
        window.disposeWeapons = () => {
            lifecycle.abort();
            closeChoices();
            cardCaches.owned.clear();
            cardCaches.catalogue.clear();
            window.disposeWeapons = undefined;
        };
        let loading = false;
        let error = "";
        const text = (tag, value, className = "") => {
            const el = document.createElement(tag);
            el.textContent = value;
            el.className = className;
            return el;
        };
        function render() {
            const help = page.querySelector(".weapons-help");
            help.hidden = tab !== "owned";
            if (help.hidden) {
                const popup = help.querySelector("[popover]");
                if (popup.matches(":popover-open"))
                    popup.hidePopover();
                help.querySelector("button").setAttribute("aria-expanded", "false");
            }
            if (loading) {
                count.textContent = "Loading weapons...";
                status.hidden = false;
                status.textContent = "Loading weapons from HoYoLAB…";
                return;
            }
            manualStatus.textContent = [manualError, scanError].filter(Boolean).join(" ");
            const source = (tab === "owned" ? [...combinedOwned, ...manual] : [...(data?.catalogue || [])]).sort((a, b) => b.rarity - a.rarity ||
                (tab === "owned" ? (b.level ?? 0) - (a.level ?? 0) : 0) ||
                (b.release_version || "0").localeCompare(a.release_version || "0", undefined, {
                    numeric: true,
                }) ||
                a.name.localeCompare(b.name));
            const query = search.value.trim().toLocaleLowerCase();
            const rows = source.filter((w) => (w.name.toLocaleLowerCase().includes(query) ||
                (w.tag?.kind === "signature" &&
                    w.tag.label.toLocaleLowerCase().includes(query))) &&
                (!type.value || w.type === type.value) &&
                (!rarity.value || w.rarity === Number(rarity.value)));
            const syncError = error || data?.[`${tab}_error`];
            const equippedCount = rows.filter((w) => Boolean(w.equipped)).length;
            const manualCount = rows.filter((w) => Boolean(w.copy_id)).length;
            const inventoryCount = rows.filter((w) => Boolean(w.scan_copy_id) && !w.equipped).length;
            count.textContent =
                tab === "owned"
                    ? `${equippedCount} equipped weapons${inventoryCount ? ` \u00b7 ${inventoryCount} unequipped` : ""}${manualCount ? ` \u00b7 ${manualCount} added manually` : ""}`
                    : `${rows.length} weapons`;
            status.hidden = !syncError && rows.length > 0;
            status.textContent = syncError
                ? `${syncError}${tab === "owned" && rows.length ? " Saved inventory is shown below." : ""}`
                : source.length
                    ? "No weapons match your filters."
                    : "No weapons yet. Add a copy from Catalogue.";
            const cache = cardCaches[tab];
            const visible = new Set(rows);
            const rebuild = renderedTab !== tab ||
                source.length !== renderedSource.length ||
                source.some((weapon, index) => weapon !== renderedSource[index]);
            if (!rebuild) {
                for (const weapon of source)
                    cache.get(weapon).hidden = !visible.has(weapon);
                return;
            }
            const fragment = document.createDocumentFragment();
            for (const weapon of source) {
                const cached = cache.get(weapon);
                if (cached) {
                    cached.hidden = !visible.has(weapon);
                    fragment.append(cached);
                    continue;
                }
                const card = document.createElement("article");
                card.className = "weapon-card";
                card.dataset.rarity = String(weapon.rarity);
                card.hidden = !visible.has(weapon);
                const art = document.createElement("div");
                art.className = "weapon-art";
                const img = document.createElement("img");
                // Remote catalogue URLs are used only as HTTPS images.
                try {
                    const url = new URL(weapon.icon);
                    if (url.protocol === "https:")
                        img.src = url.href;
                }
                catch {
                    /* Missing artwork keeps its frame. */
                }
                img.alt = "";
                img.hidden = !img.hasAttribute("src");
                img.addEventListener("error", () => {
                    img.hidden = true;
                }, { once: true });
                img.loading = "lazy";
                art.append(img);
                const body = document.createElement("div");
                body.className = "weapon-body";
                body.append(text("p", weapon.type, "weapon-type"), text("h2", weapon.name));
                const tag = weapon.tag || data?.catalogue.find((item) => item.id === weapon.id)?.tag;
                const pill = text("span", tag?.label || "Source unavailable", "weapon-tag");
                pill.dataset.kind = tag?.kind || "source";
                pill.dataset.source = tag?.source || tag?.label || "";
                if (tag?.kind === "signature")
                    pill.title = `Acquisition: ${tag.source}`;
                pill.title =
                    tag?.kind === "signature"
                        ? `${tag.label} \u00b7 Acquisition: ${tag.source}`
                        : pill.textContent;
                body.append(pill);
                art.append(text("span", "\u2605".repeat(Math.max(1, Math.min(5, weapon.rarity))), "weapon-badge weapon-stars"));
                if (tab === "owned") {
                    const refinement = text("span", `R${weapon.refinement}`, "weapon-badge weapon-refinement");
                    refinement.title = `Refinement ${weapon.refinement}`;
                    refinement.classList.toggle("is-max", weapon.refinement === 5);
                    art.append(refinement, text("span", `Lv. ${weapon.level}`, "weapon-badge weapon-level"));
                    if (weapon.equipped) {
                        const character = text("span", "", "weapon-badge weapon-character");
                        character.dataset.rarity = String(weapon.character_rarity || 4);
                        character.title = weapon.equipped;
                        character.setAttribute("aria-label", `Equipped by ${weapon.equipped}`);
                        if (weapon.character_icon?.startsWith("https://")) {
                            const portrait = document.createElement("img");
                            portrait.src = weapon.character_icon;
                            portrait.alt = weapon.equipped;
                            character.append(portrait);
                        }
                        else
                            character.textContent = weapon.equipped;
                        art.append(character);
                    }
                    if (weapon.copy_id || weapon.scan_copy_id) {
                        const control = document.createElement("div");
                        control.className = "weapon-manual-control";
                        control.dataset.origin = weapon.scan_copy_id ? "imported" : "manual";
                        const optionsLabel = weapon.scan_copy_id ? "Imported weapon options" : "Manually added weapon options";
                        const marker = document.createElement("button");
                        marker.className = "weapon-manual-trigger";
                        marker.type = "button";
                        marker.append(text("span", weapon.scan_copy_id ? "I" : "M", "weapon-manual-letter"), text("span", "Delete", "weapon-manual-delete-label"));
                        marker.setAttribute("aria-label", optionsLabel);
                        marker.setAttribute("aria-expanded", "false");
                        control.append(marker);
                        let suppressFocus = false;
                        const setOpen = (open) => {
                            control.classList.toggle("is-open", open);
                            marker.setAttribute("aria-expanded", String(open));
                            marker.setAttribute("aria-label", open ? "Delete" : optionsLabel);
                        };
                        marker.addEventListener("pointerenter", (event) => {
                            if (event.pointerType !== "touch")
                                setOpen(true);
                        });
                        marker.addEventListener("pointerleave", () => setOpen(false));
                        marker.addEventListener("focus", () => {
                            if (!suppressFocus)
                                setOpen(true);
                        });
                        marker.addEventListener("blur", () => setOpen(false));
                        marker.addEventListener("keydown", (event) => {
                            if (event.key === "Escape")
                                setOpen(false);
                        });
                        marker.addEventListener("click", () => {
                            if (!control.classList.contains("is-open")) {
                                setOpen(true);
                                return;
                            }
                            setOpen(false);
                            pendingDelete = weapon;
                            restoreManualControl = () => {
                                if (!marker.isConnected)
                                    return;
                                suppressFocus = true;
                                marker.focus({ preventScroll: true });
                                setOpen(false);
                                suppressFocus = false;
                            };
                            deleteDialog.dataset.rarity = String(weapon.rarity);
                            page.querySelector("[data-weapon-delete-name]").textContent =
                                `Delete this ${weapon.scan_copy_id ? "imported" : "manually added"} copy of ${weapon.name}?`;
                            page.querySelector("[data-weapon-delete-status]").textContent = "";
                            deleteDialog.showModal();
                            deleteCancel.focus();
                        });
                        art.append(control);
                    }
                }
                else {
                    const add = text("button", "Add to Owned", "characters-reset-filters weapon-card-action");
                    add.type = "button";
                    add.addEventListener("click", () => {
                        selectedWeapon = weapon;
                        addForm.reset();
                        addForm.elements.namedItem("level").value = "1";
                        addForm.elements.namedItem("refinement").value = "1";
                        closeChoices();
                        dialog.dataset.rarity = String(weapon.rarity);
                        const icon = page.querySelector("[data-weapon-add-icon]");
                        icon.removeAttribute("src");
                        if (weapon.icon.startsWith("https://"))
                            icon.src = weapon.icon;
                        icon.alt = weapon.name;
                        page.querySelector("#weapon-add-level-value").textContent = "Lv. 1";
                        page.querySelector("#weapon-add-refinement-value").textContent = "R1";
                        page.querySelector("[data-weapon-add-name]").textContent = weapon.name;
                        page.querySelector("[data-weapon-save-status]").textContent = "";
                        dialog.showModal();
                    });
                    body.append(add);
                }
                card.append(art, body);
                cache.set(weapon, card);
                fragment.append(card);
            }
            for (const weapon of cache.keys())
                if (!source.includes(weapon))
                    cache.delete(weapon);
            grid.replaceChildren(fragment);
            renderedTab = tab;
            renderedSource = source;
        }
        async function load() {
            if (loading)
                return;
            loading = true;
            error = "";
            refresh.disabled = true;
            render();
            try {
                const [synced, saved, scan] = await Promise.allSettled([
                    fetch(`/api/weapons?${accountQuery}`, { signal: lifecycle.signal }).then(async (response) => {
                        if (!response.ok)
                            throw new Error();
                        return (await response.json());
                    }),
                    fetch(`/api/weapons/manual?${accountQuery}`, { signal: lifecycle.signal }).then(async (response) => {
                        if (!response.ok)
                            throw new Error();
                        return (await response.json());
                    }),
                    fetch(`/api/weapons/scanned?${accountQuery}`, {
                        signal: lifecycle.signal,
                    }).then(async (response) => {
                        if (!response.ok)
                            throw new Error();
                        return (await response.json());
                    }),
                ]);
                if (lifecycle.signal.aborted)
                    return;
                cardCaches.owned.clear();
                cardCaches.catalogue.clear();
                renderedTab = "";
                if (synced.status === "fulfilled")
                    data = synced.value;
                else {
                    data = null;
                    error = "Couldn't sync weapons from HoYoLAB.";
                }
                if (saved.status === "fulfilled") {
                    manual = saved.value.weapons;
                    manualError = "";
                }
                else
                    manualError =
                        "Couldn't load manually added weapons. Please refresh to try again.";
                if (scan.status === "fulfilled") {
                    scanned = scan.value.weapons;
                    scanError = "";
                }
                else
                    scanError =
                        "Couldn't load saved scanned inventory. Please refresh to try again.";
                mergeOwned();
            }
            finally {
                loading = false;
                refresh.disabled = false;
                if (!lifecycle.signal.aborted)
                    render();
            }
        }
        page.querySelector("[data-weapon-cancel]").addEventListener("click", () => dialog.close());
        addForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!selectedWeapon || !addForm.reportValidity())
                return;
            const submit = addForm.querySelector('[type="submit"]');
            submit.disabled = true;
            const saveStatus = page.querySelector("[data-weapon-save-status]");
            saveStatus.textContent = "Saving weapon...";
            try {
                const response = await fetch(`/api/weapons/manual?${accountQuery}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ...selectedWeapon,
                        level: Number(addForm.elements.namedItem("level").value),
                        refinement: Number(addForm.elements.namedItem("refinement").value),
                    }),
                });
                if (!response.ok)
                    throw new Error();
                const saved = (await response.json());
                manual.push(saved.weapon);
                dialog.close();
                page.querySelector('[data-weapons-tab="owned"]').click();
                search.value = "";
                type.value = "";
                rarity.value = "";
                for (const group of page.querySelectorAll("[data-weapons-icon-filter]")) {
                    for (const button of group.querySelectorAll("button")) {
                        const active = button.dataset.value === "";
                        button.classList.toggle("selected", active);
                        button.setAttribute("aria-pressed", String(active));
                    }
                }
                render();
            }
            catch {
                saveStatus.textContent = "Couldn't save this weapon. Please try again.";
            }
            finally {
                submit.disabled = false;
            }
        });
        const tabs = [...page.querySelectorAll("[data-weapons-tab]")];
        for (const button of tabs) {
            button.addEventListener("click", () => {
                tab = button.dataset.weaponsTab;
                for (const item of tabs) {
                    item.setAttribute("aria-selected", String(item === button));
                    item.classList.toggle("active", item === button);
                    item.tabIndex = item === button ? 0 : -1;
                }
                page.querySelector("[role=tabpanel]").setAttribute("aria-labelledby", button.id);
                render();
            });
            button.addEventListener("keydown", (event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                    return;
                event.preventDefault();
                const next = event.key === "Home"
                    ? tabs[0]
                    : event.key === "End"
                        ? tabs[1]
                        : tabs.find((item) => item !== button);
                next.focus();
                next.click();
            });
        }
        for (const select of page.querySelectorAll("[data-weapons-select]")) {
            const trigger = select.querySelector(".custom-select-button");
            const options = [...select.querySelectorAll("[role=option]")];
            const input = select.querySelector("input");
            const close = () => {
                select.classList.remove("open");
                trigger.setAttribute("aria-expanded", "false");
            };
            trigger.addEventListener("click", () => {
                const opening = !select.classList.contains("open");
                for (const other of page.querySelectorAll("[data-weapons-select]")) {
                    other.classList.remove("open");
                    other
                        .querySelector(".custom-select-button")
                        .setAttribute("aria-expanded", "false");
                }
                select.classList.toggle("open", opening);
                trigger.setAttribute("aria-expanded", String(opening));
            });
            for (const option of options) {
                option.addEventListener("click", () => {
                    input.value = option.dataset.value;
                    select.querySelector(".custom-select-value").textContent =
                        option.textContent.trim();
                    for (const item of options) {
                        item.classList.toggle("selected", item === option);
                        item.setAttribute("aria-selected", String(item === option));
                    }
                    close();
                    trigger.focus();
                    if (input.hasAttribute("data-weapons-account"))
                        input.form.requestSubmit();
                    else
                        render();
                });
            }
            select.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                    close();
                    trigger.focus();
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    select.classList.add("open");
                    trigger.setAttribute("aria-expanded", "true");
                    const index = options.indexOf(document.activeElement);
                    options[(index +
                        (event.key === "ArrowDown" ? 1 : options.length - 1) +
                        options.length) %
                        options.length]?.focus();
                }
            });
            select.addEventListener("focusout", (event) => {
                if (!select.contains(event.relatedTarget))
                    close();
            });
        }
        document.addEventListener("click", (event) => {
            for (const select of page.querySelectorAll("[data-weapons-select]")) {
                if (!select.contains(event.target)) {
                    select.classList.remove("open");
                    select
                        .querySelector(".custom-select-button")
                        .setAttribute("aria-expanded", "false");
                }
            }
        }, { signal: lifecycle.signal });
        for (const group of page.querySelectorAll("[data-weapons-icon-filter]")) {
            const input = group.dataset.weaponsIconFilter === "type" ? type : rarity;
            for (const button of group.querySelectorAll("button")) {
                button.addEventListener("click", () => {
                    input.value = button.dataset.value;
                    for (const item of group.querySelectorAll("button")) {
                        item.classList.toggle("selected", item === button);
                        item.setAttribute("aria-pressed", String(item === button));
                    }
                    render();
                });
            }
        }
        search.addEventListener("input", render);
        type.addEventListener("change", render);
        rarity.addEventListener("change", render);
        refresh.addEventListener("click", () => void load());
        void load();
    };
})();
