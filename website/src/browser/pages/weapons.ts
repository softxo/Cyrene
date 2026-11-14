interface Window {
    initWeapons?: () => void;
    disposeWeapons?: () => void;
}

(() => {
    type Weapon = {
        id: number;
        name: string;
        icon: string;
        rarity: number;
        type: string;
        level?: number;
        refinement?: number;
        equipped?: string;
        max_level?: number;
        release_version?: string;
        unreleased?: boolean;
        copy_id?: string;
        scan_copy_id?: string;
        character_icon?: string;
        character_rarity?: number;
        tag?: { label: string; kind: string; source: string };
    };
    type WeaponData = {
        owned: Weapon[];
        catalogue: Weapon[];
        owned_error?: string;
        catalogue_error?: string;
    };
    window.initWeapons = () => {
        const page = document.querySelector<HTMLElement>("[data-weapons-page]");
        if (!page || page.dataset.initialised) return;
        window.disposeWeapons?.();
        const lifecycle = new AbortController();
        const notify = (message: string, kind: "success" | "error" = "success") => {
            if (!lifecycle.signal.aborted) window.showCyreneToast?.(message, kind);
        };
        page.dataset.initialised = "true";
        const grid = page.querySelector<HTMLElement>("[data-weapons-grid]");
        if (!grid) return;
        const status = page.querySelector<HTMLElement>("[data-weapons-status]")!;
        const count = page.querySelector<HTMLElement>("[data-weapons-count]")!;
        const search = page.querySelector<HTMLInputElement>("[data-weapons-search]")!;
        const type = page.querySelector<HTMLSelectElement>("[data-weapons-type]")!;
        const rarity = page.querySelector<HTMLSelectElement>("[data-weapons-rarity]")!;
        const tagFilter = page.querySelector<HTMLInputElement>("[data-weapons-tag]")!;
        const refresh = page.querySelector<HTMLButtonElement>("[data-weapons-retry]")!;
        const requestedTab = new URLSearchParams(window.location.search).get("tab");
        let tab: "owned" | "catalogue" | "planner" =
            requestedTab === "catalogue" || requestedTab === "planner" ? requestedTab : "owned";
        window.initWeaponPlanner?.(page, lifecycle.signal);
        let data: WeaponData | null = null;
        let manual: Weapon[] = [];
        let scanned: Weapon[] = [];
        let combinedOwned: Weapon[] = [];
        let scanError = "";
        function mergeOwned() {
            const inventory = scanned.map((weapon) => ({ ...weapon }));
            const unmatched: Weapon[] = [];
            const matched = new Set<number>();
            const normalise = (name: string) =>
                name
                    .normalize("NFKC")
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}]/gu, "");
            const nickname = normalise(page!.dataset.accountNickname || "");
            const liveWeapons = (data?.owned || []).map((weapon) => ({ ...weapon }));
            for (const weapon of [...inventory, ...liveWeapons]) {
                if (nickname && normalise(weapon.equipped || "") === nickname) {
                    weapon.equipped = "Traveler";
                }
            }
            const liveByCharacter = new Map(
                liveWeapons.filter((w) => w.equipped).map((w) => [normalise(w.equipped!), w]),
            );
            for (const weapon of inventory) {
                const equipped = weapon.equipped && liveByCharacter.get(normalise(weapon.equipped));
                if (equipped && equipped.id !== weapon.id) {
                    delete weapon.equipped;
                    delete weapon.character_icon;
                    delete weapon.character_rarity;
                }
            }
            for (const live of liveWeapons) {
                let index = inventory.findIndex(
                    (weapon, i) =>
                        !matched.has(i) &&
                        weapon.id === live.id &&
                        weapon.equipped &&
                        live.equipped &&
                        normalise(weapon.equipped) === normalise(live.equipped),
                );
                if (index < 0)
                    index = inventory.findIndex(
                        (weapon, i) =>
                            !matched.has(i) &&
                            weapon.id === live.id &&
                            weapon.level === live.level &&
                            weapon.refinement === live.refinement &&
                            (!weapon.equipped || !weapon.character_icon),
                    );
                if (index < 0)
                    index = inventory.findIndex(
                        (weapon, i) =>
                            !matched.has(i) &&
                            weapon.id === live.id &&
                            (!weapon.equipped || !weapon.character_icon),
                    );
                if (index < 0) unmatched.push(live);
                else {
                    matched.add(index);
                    inventory[index] = { ...live };
                }
            }
            combinedOwned = [...inventory, ...unmatched];
            publishWeapons();
        }
        function publishWeapons() {
            page!.dispatchEvent(
                new CustomEvent("weapons-data", {
                    detail: {
                        catalogue: data?.catalogue || [],
                        owned: [...combinedOwned, ...manual],
                    },
                }),
            );
        }
        let manualError = "";
        let selectedWeapon: Weapon | null = null;
        const dialog = page.querySelector<HTMLDialogElement>("[data-weapon-dialog]")!;
        const addForm = page.querySelector<HTMLFormElement>("[data-weapon-add-form]")!;
        const deleteDialog = page.querySelector<HTMLDialogElement>("[data-weapon-delete-dialog]")!;
        const deleteConfirm = page.querySelector<HTMLButtonElement>(
            "[data-weapon-delete-confirm]",
        )!;
        const deleteCancel = page.querySelector<HTMLButtonElement>("[data-weapon-delete-cancel]")!;
        let pendingDelete: Weapon | null = null;
        let restoreManualControl: (() => void) | null = null;
        let deleting = false;
        const importDialog = page.querySelector<HTMLDialogElement>("[data-weapon-import-dialog]")!;
        const importButton = page.querySelector<HTMLButtonElement>("[data-weapons-import]")!;
        const importFile = page.querySelector<HTMLInputElement>("[data-weapons-import-file]")!;
        const importConfirm = page.querySelector<HTMLButtonElement>(
            "[data-weapon-import-confirm]",
        )!;
        const importCancel = page.querySelector<HTMLButtonElement>("[data-weapon-import-cancel]")!;
        const importStatus = page.querySelector<HTMLElement>("[data-weapon-import-status]")!;
        let importPayload: unknown = null;
        let importing = false;
        importButton.addEventListener("click", () => {
            importPayload = null;
            importConfirm.disabled = true;
            importStatus.textContent = "";
            page.querySelector<HTMLElement>("[data-weapon-import-summary]")!.hidden = true;
            importDialog.showModal();
        });
        const importChoose = page.querySelector<HTMLButtonElement>("[data-weapon-import-choose]")!;
        importChoose.addEventListener("click", () => importFile.click());
        importCancel.addEventListener("click", () => importDialog.close());
        importDialog.addEventListener("cancel", (event) => {
            if (importing) event.preventDefault();
        });
        importFile.addEventListener("change", async () => {
            const file = importFile.files?.[0];
            importFile.value = "";
            if (!file) return;
            importPayload = null;
            importConfirm.disabled = true;
            importChoose.disabled = true;
            page.querySelector<HTMLElement>("[data-weapon-import-summary]")!.hidden = true;
            importButton.disabled = true;
            importStatus.textContent = "Reading weapon export...";
            try {
                if (file.size > 4 * 1024 * 1024) throw new Error("The weapon export exceeds 4 MB.");
                importPayload = JSON.parse(await file.text());
                const response = await fetch(`/api/weapons/import/preview?${accountQuery}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(importPayload),
                });
                const result = (await response.json()) as {
                    count?: number;
                    uid?: string;
                    detail?: string;
                };
                if (!response.ok)
                    throw new Error(result.detail || "Couldn't read this weapon export.");
                page.querySelector("[data-weapon-import-summary]")!.textContent =
                    `Import ${result.count} weapons for UID ${result.uid}?`;
                page.querySelector<HTMLElement>("[data-weapon-import-summary]")!.hidden = false;
                importConfirm.disabled = false;
                importStatus.textContent = "";
                manualStatus.textContent = "";
                if (!importDialog.open) importDialog.showModal();
                importCancel.focus();
            } catch (error) {
                importPayload = null;
                importStatus.textContent =
                    error instanceof Error ? error.message : "Couldn't read this weapon export.";
                notify(importStatus.textContent, "error");
            } finally {
                importButton.disabled = false;
                importChoose.disabled = false;
            }
        });
        importConfirm.addEventListener("click", async () => {
            if (!importPayload || importing) return;
            importing = true;
            importConfirm.disabled = true;
            importCancel.disabled = true;
            importChoose.disabled = true;
            importStatus.textContent = "Saving inventory...";
            try {
                const response = await fetch(`/api/weapons/import?${accountQuery}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(importPayload),
                });
                const result = (await response.json()) as { weapons?: Weapon[]; detail?: string };
                if (!response.ok)
                    throw new Error(result.detail || "Couldn't save the weapon inventory.");
                scanned = result.weapons!;
                void window.refreshImportDate?.("weapons", page.dataset.accountId!);
                scanError = "";
                mergeOwned();
                cardCaches.owned.clear();
                renderedTab = "";
                importDialog.close();
                notify("Weapon inventory imported.");
                importPayload = null;
                search.value = "";
                page.querySelector<HTMLButtonElement>('[data-weapons-tab="owned"]')!.click();
            } catch (error) {
                importStatus.textContent =
                    error instanceof Error ? error.message : "Couldn't save the weapon inventory.";
                notify(importStatus.textContent, "error");
            } finally {
                importing = false;
                importConfirm.disabled = false;
                importCancel.disabled = false;
                importChoose.disabled = false;
            }
        });
        deleteCancel.addEventListener("click", () => deleteDialog.close());
        deleteDialog.addEventListener("cancel", (event) => {
            if (deleting) event.preventDefault();
        });
        deleteDialog.addEventListener("close", () => {
            restoreManualControl?.();
            restoreManualControl = null;
            pendingDelete = null;
        });
        deleteConfirm.addEventListener("click", async () => {
            if (!(pendingDelete?.copy_id || pendingDelete?.scan_copy_id) || deleting) return;
            deleting = true;
            deleteConfirm.disabled = true;
            deleteCancel.disabled = true;
            const message = page.querySelector<HTMLElement>("[data-weapon-delete-status]")!;
            message.textContent = "Deleting weapon...";
            try {
                const response = await fetch(
                    `/api/weapons/${pendingDelete.scan_copy_id ? "scanned" : "manual"}/${encodeURIComponent(pendingDelete.scan_copy_id || pendingDelete.copy_id!)}?${accountQuery}`,
                    { method: "DELETE" },
                );
                if (!response.ok) throw new Error();
                if (pendingDelete.scan_copy_id) {
                    scanned = scanned.filter(
                        (weapon) => weapon.scan_copy_id !== pendingDelete!.scan_copy_id,
                    );
                    mergeOwned();
                } else
                    manual = manual.filter((weapon) => weapon.copy_id !== pendingDelete!.copy_id);
                manualError = "";
                publishWeapons();
                deleteDialog.close();
                notify("Weapon deleted.");
                render();
            } catch {
                message.textContent = "Couldn't delete this weapon. Please try again.";
                notify(message.textContent, "error");
            } finally {
                deleting = false;
                deleteConfirm.disabled = false;
                deleteCancel.disabled = false;
            }
        });
        const manualStatus = page.querySelector<HTMLElement>("[data-weapons-manual-status]")!;
        const accountQuery = `account_id=${encodeURIComponent(page.dataset.accountId!)}`;
        void window.refreshImportDate?.("weapons", page.dataset.accountId!);
        const resetDialog = page.querySelector<HTMLDialogElement>("[data-weapons-reset-dialog]")!;
        const resetButton = page.querySelector<HTMLButtonElement>("[data-weapons-reset]")!;
        const resetConfirm = page.querySelector<HTMLButtonElement>("[data-weapons-reset-confirm]")!;
        const resetCancel = page.querySelector<HTMLButtonElement>("[data-weapons-reset-cancel]")!;
        const resetStatus = page.querySelector<HTMLElement>("[data-weapons-reset-status]")!;
        let resetting = false;
        page.querySelector("[data-weapons-reset]")!.addEventListener("click", () => {
            resetStatus.textContent = "";
            resetDialog.showModal();
            resetCancel.focus();
        });
        resetCancel.addEventListener("click", () => {
            if (!resetting) resetDialog.close();
        });
        resetDialog.addEventListener("cancel", (event) => {
            if (resetting) event.preventDefault();
        });
        resetConfirm.addEventListener("click", async () => {
            if (resetting) return;
            resetting = true;
            resetConfirm.disabled = resetCancel.disabled = true;
            resetStatus.textContent = "Resetting inventory...";
            try {
                const response = await fetch(`/api/weapons/inventory?${accountQuery}`, {
                    method: "DELETE",
                    signal: lifecycle.signal,
                });
                if (!response.ok) throw new Error("Couldn't reset your inventory. Please retry.");
                manual = [];
                scanned = [];
                manualError = scanError = "";
                mergeOwned();
                cardCaches.owned.clear();
                renderedTab = "";
                search.value = type.value = rarity.value = tagFilter.value = "";
                page.querySelector("#weapons-tag-value")!.textContent = "All tags";
                for (const option of page.querySelectorAll<HTMLElement>(
                    ".weapons-tag-filter [role=option]",
                )) {
                    const active = option.dataset.value === "";
                    option.classList.toggle("selected", active);
                    option.setAttribute("aria-selected", String(active));
                }
                for (const button of page.querySelectorAll<HTMLElement>(
                    "[data-weapons-icon-filter] button",
                )) {
                    const active = button.dataset.value === "";
                    button.classList.toggle("selected", active);
                    button.setAttribute("aria-pressed", String(active));
                }
                render();
                resetDialog.close();
                notify("Weapon inventory reset. HoYoLAB weapons and plans were kept.");
            } catch (error) {
                if (!lifecycle.signal.aborted)
                    resetStatus.textContent =
                        error instanceof Error ? error.message : "Couldn't reset inventory.";
                if (!lifecycle.signal.aborted)
                    notify(resetStatus.textContent || "Couldn't reset inventory.", "error");
            } finally {
                resetting = false;
                resetConfirm.disabled = resetCancel.disabled = false;
            }
        });
        const choicePopup = page.querySelector<HTMLElement>("#weapon-choice-popup")!;
        const choiceGrid = page.querySelector<HTMLElement>("[data-weapon-choice-grid]")!;
        let choiceTrigger: HTMLButtonElement | null = null;
        const closeChoices = () => {
            if (choicePopup.matches(":popover-open")) choicePopup.hidePopover();
            choiceTrigger?.setAttribute("aria-expanded", "false");
            choiceTrigger = null;
        };
        for (const trigger of page.querySelectorAll<HTMLButtonElement>("[data-weapon-choice]")) {
            let pressedWhileOpen = false;
            trigger.addEventListener("pointerdown", () => {
                pressedWhileOpen =
                    choiceTrigger === trigger && choicePopup.matches(":popover-open");
            });
            trigger.addEventListener("click", () => {
                if (
                    pressedWhileOpen ||
                    (choiceTrigger === trigger && choicePopup.matches(":popover-open"))
                ) {
                    pressedWhileOpen = false;
                    closeChoices();
                    return;
                }
                closeChoices();
                const field = trigger.dataset.weaponChoice!;
                const input = addForm.elements.namedItem(field) as HTMLInputElement;
                const maximum = field === "refinement" ? 5 : selectedWeapon!.rarity <= 2 ? 70 : 90;
                choiceGrid.replaceChildren();
                choicePopup.setAttribute("aria-label", `Choose weapon ${field}`);
                const values =
                    field === "refinement"
                        ? [1, 2, 3, 4, 5]
                        : [1, 20, 40, 50, 60, 70, 80, 90].filter((value) => value <= maximum);
                for (const value of values) {
                    const option = text(
                        "button",
                        field === "refinement" ? `R${value}` : `Lv. ${value}`,
                        "planner-choice-option",
                    ) as HTMLButtonElement;
                    option.type = "button";
                    const active = Number(input.value) === value;
                    option.classList.toggle("is-selected", active);
                    option.setAttribute("aria-pressed", String(active));
                    option.addEventListener("click", () => {
                        input.value = String(value);
                        trigger.querySelector(".planner-choice-value")!.textContent =
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
                const active =
                    choiceGrid.querySelector<HTMLButtonElement>(".is-selected") ||
                    choiceGrid.querySelector<HTMLButtonElement>("button")!;
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
        for (const modal of [dialog, deleteDialog, importDialog, resetDialog]) {
            let backdropPress = false;
            const outside = (event: PointerEvent | MouseEvent) => {
                const rect = modal.getBoundingClientRect();
                return (
                    event.clientX < rect.left ||
                    event.clientX > rect.right ||
                    event.clientY < rect.top ||
                    event.clientY > rect.bottom
                );
            };
            modal.addEventListener("pointerdown", (event) => {
                backdropPress = event.target === modal && outside(event);
            });
            modal.addEventListener("click", (event) => {
                if (
                    backdropPress &&
                    event.target === modal &&
                    outside(event) &&
                    !(modal === deleteDialog && deleting) &&
                    !(modal === importDialog && importing) &&
                    !(modal === resetDialog && resetting)
                )
                    modal.close();
                backdropPress = false;
            });
        }
        window.addEventListener("resize", closeChoices, { signal: lifecycle.signal });
        const cardCaches = {
            owned: new Map<Weapon, HTMLElement>(),
            catalogue: new Map<Weapon, HTMLElement>(),
        };
        let renderedTab = "";
        let renderedSource: Weapon[] = [];
        window.disposeWeapons = () => {
            lifecycle.abort();
            closeChoices();
            for (const modal of [dialog, deleteDialog, importDialog, resetDialog]) modal.close();
            cardCaches.owned.clear();
            cardCaches.catalogue.clear();
            window.disposeWeapons = undefined;
        };
        let loading = false;
        let error = "";
        const text = (tag: string, value: string, className = "") => {
            const el = document.createElement(tag);
            el.textContent = value;
            el.className = className;
            return el;
        };
        function render() {
            importButton.hidden = resetButton.hidden = tab !== "owned";
            const planning = tab === "planner";
            page!.querySelector<HTMLElement>("#weapons-results")!.hidden = planning;
            page!.querySelector<HTMLElement>("#weapons-planner")!.hidden = !planning;
            page!.querySelector<HTMLElement>(".weapons-toolbar")!.hidden = planning;
            page!.querySelector<HTMLElement>(".weapons-summary-row")!.hidden = planning;
            if (tab === "planner") return;
            const help = page!.querySelector<HTMLElement>(".weapons-help")!;
            help.hidden = tab !== "owned";
            if (help.hidden) {
                const popup = help.querySelector<HTMLElement>("[popover]")!;
                if (popup.matches(":popover-open")) popup.hidePopover();
                help.querySelector("button")!.setAttribute("aria-expanded", "false");
            }
            if (loading) {
                count.textContent = "Loading weapons...";
                status.hidden = false;
                status.textContent = "Loading weapons from HoYoLAB…";
                return;
            }
            manualStatus.textContent = [manualError, scanError].filter(Boolean).join(" ");
            const source = (
                tab === "owned" ? [...combinedOwned, ...manual] : [...(data?.catalogue || [])]
            ).sort(
                (a, b) =>
                    (tab === "catalogue"
                        ? Number(Boolean(b.unreleased)) - Number(Boolean(a.unreleased))
                        : 0) ||
                    b.rarity - a.rarity ||
                    (tab === "owned" ? (b.level ?? 0) - (a.level ?? 0) : 0) ||
                    (b.release_version || "0").localeCompare(a.release_version || "0", undefined, {
                        numeric: true,
                    }) ||
                    a.name.localeCompare(b.name),
            );
            const query = search.value.trim().toLocaleLowerCase();
            const rows = source.filter(
                (w) =>
                    (!w.unreleased || document.documentElement.dataset.showUnreleased === "true") &&
                    (w.name.toLocaleLowerCase().includes(query) ||
                        (w.tag?.kind === "signature" &&
                            w.tag.label.toLocaleLowerCase().includes(query))) &&
                    (!type.value || w.type === type.value) &&
                    (!tagFilter.value ||
                        (tagFilter.value === "signature"
                            ? w.tag?.kind === "signature"
                            : w.tag?.source === tagFilter.value)) &&
                    (!rarity.value || w.rarity === Number(rarity.value)),
            );
            const syncError = error || data?.[`${tab}_error`];
            const equippedCount = rows.filter((w) => Boolean(w.equipped)).length;
            const manualCount = rows.filter((w) => Boolean(w.copy_id)).length;
            const inventoryCount = rows.filter(
                (w) => Boolean(w.scan_copy_id) && !w.equipped,
            ).length;
            count.replaceChildren();
            const divider = () => {
                const marker = text("span", "|", "characters-count-divider");
                marker.setAttribute("aria-hidden", "true");
                return marker;
            };
            if (tab === "owned") {
                count.append(text("strong", String(equippedCount)), " equipped weapons");
                if (inventoryCount)
                    count.append(
                        " ",
                        divider(),
                        " ",
                        text("strong", String(inventoryCount)),
                        " unequipped",
                    );
                if (manualCount)
                    count.append(
                        " ",
                        divider(),
                        " ",
                        text("strong", String(manualCount)),
                        " added manually",
                    );
            } else count.append(text("strong", String(rows.length)), " weapons");
            status.hidden = !syncError && rows.length > 0;
            status.textContent = syncError
                ? `${syncError}${tab === "owned" && rows.length ? " Saved inventory is shown below." : ""}`
                : source.length
                  ? "No weapons match your filters."
                  : "No weapons yet. Add a copy from Catalogue.";
            const cache = cardCaches[tab];
            const visible = new Set(rows);
            const rebuild =
                renderedTab !== tab ||
                source.length !== renderedSource.length ||
                source.some((weapon, index) => weapon !== renderedSource[index]);
            if (!rebuild) {
                for (const weapon of source) cache.get(weapon)!.hidden = !visible.has(weapon);
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
                try {
                    const url = new URL(weapon.icon);
                    if (url.protocol === "https:") img.src = url.href;
                } catch {}
                img.alt = "";
                img.hidden = !img.hasAttribute("src");
                img.addEventListener(
                    "error",
                    () => {
                        img.hidden = true;
                    },
                    { once: true },
                );
                img.loading = "lazy";
                art.append(img);
                if (weapon.unreleased) {
                    art.append(
                        text("span", "Unreleased", "cyrene-unreleased-badge weapon-unreleased"),
                    );
                }
                const body = document.createElement("div");
                body.className = "weapon-body";
                body.append(text("p", weapon.type, "weapon-type"), text("h2", weapon.name));
                const tag =
                    weapon.tag || data?.catalogue.find((item) => item.id === weapon.id)?.tag;
                const pill = text("span", tag?.label || "Unknown", "weapon-tag");
                pill.dataset.kind = tag?.kind || "source";
                pill.dataset.source = tag?.source || tag?.label || "";
                if (tag?.kind === "signature") pill.title = `Acquisition: ${tag.source}`;
                pill.title =
                    tag?.kind === "signature"
                        ? `${tag.label} \u00b7 Acquisition: ${tag.source}`
                        : pill.textContent!;
                body.append(pill);
                art.append(
                    text(
                        "span",
                        "\u2605".repeat(Math.max(1, Math.min(5, weapon.rarity))),
                        "weapon-badge weapon-stars",
                    ),
                );
                if (tab === "owned") {
                    const refinement = text(
                        "span",
                        `R${weapon.refinement}`,
                        "weapon-badge weapon-refinement",
                    );
                    refinement.title = `Refinement ${weapon.refinement}`;
                    refinement.classList.toggle("is-max", weapon.refinement === 5);
                    art.append(
                        refinement,
                        text("span", `Lv. ${weapon.level}`, "weapon-badge weapon-level"),
                    );
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
                        } else character.textContent = weapon.equipped;
                        art.append(character);
                    }
                    if (weapon.copy_id || weapon.scan_copy_id) {
                        const control = document.createElement("div");
                        control.className = "weapon-manual-control";
                        control.dataset.origin = weapon.scan_copy_id ? "imported" : "manual";
                        const optionsLabel = weapon.scan_copy_id
                            ? "Imported weapon options"
                            : "Manually added weapon options";
                        const marker = document.createElement("button");
                        marker.className = "weapon-manual-trigger";
                        marker.type = "button";
                        marker.append(
                            text("span", weapon.scan_copy_id ? "I" : "M", "weapon-manual-letter"),
                            text("span", "Delete", "weapon-manual-delete-label"),
                        );
                        marker.setAttribute("aria-label", optionsLabel);
                        marker.setAttribute("aria-expanded", "false");
                        control.append(marker);
                        let suppressFocus = false;
                        const setOpen = (open: boolean) => {
                            control.classList.toggle("is-open", open);
                            marker.setAttribute("aria-expanded", String(open));
                            marker.setAttribute("aria-label", open ? "Delete" : optionsLabel);
                        };
                        marker.addEventListener("pointerenter", (event) => {
                            if (event.pointerType !== "touch") setOpen(true);
                        });
                        marker.addEventListener("pointerleave", () => setOpen(false));
                        marker.addEventListener("focus", () => {
                            if (!suppressFocus) setOpen(true);
                        });
                        marker.addEventListener("blur", () => setOpen(false));
                        marker.addEventListener("keydown", (event) => {
                            if (event.key === "Escape") setOpen(false);
                        });
                        marker.addEventListener("click", () => {
                            if (!control.classList.contains("is-open")) {
                                setOpen(true);
                                return;
                            }
                            setOpen(false);
                            pendingDelete = weapon;
                            restoreManualControl = () => {
                                if (!marker.isConnected) return;
                                suppressFocus = true;
                                marker.focus({ preventScroll: true });
                                setOpen(false);
                                suppressFocus = false;
                            };
                            deleteDialog.dataset.rarity = String(weapon.rarity);
                            page!.querySelector("[data-weapon-delete-name]")!.textContent =
                                `Delete this ${weapon.scan_copy_id ? "imported" : "manually added"} copy of ${weapon.name}?`;
                            page!.querySelector("[data-weapon-delete-status]")!.textContent = "";
                            deleteDialog.showModal();
                            deleteCancel.focus();
                        });
                        art.append(control);
                    }
                } else {
                    const add = text(
                        "button",
                        "Add to Owned",
                        "cyrene-button characters-reset-filters weapon-card-action",
                    ) as HTMLButtonElement;
                    add.type = "button";
                    add.addEventListener("click", () => {
                        selectedWeapon = weapon;
                        addForm.reset();
                        (addForm.elements.namedItem("level") as HTMLInputElement).value = "1";
                        (addForm.elements.namedItem("refinement") as HTMLInputElement).value = "1";
                        closeChoices();
                        dialog.dataset.rarity = String(weapon.rarity);
                        const icon =
                            page!.querySelector<HTMLImageElement>("[data-weapon-add-icon]")!;
                        icon.removeAttribute("src");
                        if (weapon.icon.startsWith("https://")) icon.src = weapon.icon;
                        icon.alt = weapon.name;
                        page!.querySelector("#weapon-add-level-value")!.textContent = "Lv. 1";
                        page!.querySelector("#weapon-add-refinement-value")!.textContent = "R1";
                        page!.querySelector("[data-weapon-add-name]")!.textContent = weapon.name;
                        page!.querySelector("[data-weapon-save-status]")!.textContent = "";
                        dialog.showModal();
                    });
                    body.append(add);
                }
                card.append(art, body);
                cache.set(weapon, card);
                fragment.append(card);
            }
            for (const weapon of cache.keys()) if (!source.includes(weapon)) cache.delete(weapon);
            grid!.replaceChildren(fragment);
            renderedTab = tab;
            renderedSource = source;
        }
        async function load(notifyResult = false, background = false) {
            if (loading) return;
            loading = true;
            error = "";
            refresh.disabled = true;
            resetButton.disabled = true;
            importButton.disabled = true;
            if (!background) render();
            try {
                const [synced, saved, scan] = await Promise.allSettled([
                    fetch(`/api/weapons?${accountQuery}`, {
                        signal: lifecycle.signal,
                        headers: background ? { "X-Cyrene-Background": "1" } : {},
                    }).then(async (response) => {
                        if (!response.ok) throw new Error();
                        return (await response.json()) as WeaponData;
                    }),
                    fetch(`/api/weapons/manual?${accountQuery}`, {
                        signal: lifecycle.signal,
                        headers: background ? { "X-Cyrene-Background": "1" } : {},
                    }).then(async (response) => {
                        if (!response.ok) throw new Error();
                        return (await response.json()) as {
                            weapons: Weapon[];
                            scan_id?: string | null;
                        };
                    }),
                    fetch(`/api/weapons/scanned?${accountQuery}`, {
                        signal: lifecycle.signal,
                        headers: background ? { "X-Cyrene-Background": "1" } : {},
                    }).then(async (response) => {
                        if (!response.ok) throw new Error();
                        return (await response.json()) as {
                            weapons: Weapon[];
                            scan_id?: string | null;
                        };
                    }),
                ]);
                if (lifecycle.signal.aborted) return;
                cardCaches.owned.clear();
                cardCaches.catalogue.clear();
                renderedTab = "";
                if (synced.status === "fulfilled") {
                    const next = synced.value;
                    data =
                        background && data
                            ? {
                                  ...next,
                                  owned: next.owned_error ? data.owned : next.owned,
                                  catalogue: next.catalogue_error ? data.catalogue : next.catalogue,
                              }
                            : next;
                } else {
                    if (!background) data = null;
                    error = "Couldn't sync weapons from HoYoLAB.";
                }
                if (saved.status === "fulfilled") {
                    manual = saved.value.weapons;
                    manualError = "";
                } else
                    manualError =
                        "Couldn't load manually added weapons. Please refresh to try again.";
                if (scan.status === "fulfilled") {
                    scanned = scan.value.weapons;
                    scanError = "";
                } else
                    scanError =
                        "Couldn't load saved scanned inventory. Please refresh to try again.";
                mergeOwned();
                if (notifyResult) {
                    const problem =
                        error ||
                        manualError ||
                        scanError ||
                        data?.owned_error ||
                        data?.catalogue_error;
                    notify(
                        problem
                            ? "Some weapon data couldn't be refreshed. Please try again."
                            : "Weapons refreshed.",
                        problem ? "error" : "success",
                    );
                }
            } finally {
                loading = false;
                refresh.disabled = false;
                resetButton.disabled = false;
                importButton.disabled = false;
                if (!lifecycle.signal.aborted) render();
            }
        }
        page.querySelector("[data-weapon-cancel]")!.addEventListener("click", () => dialog.close());
        addForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!selectedWeapon || !addForm.reportValidity()) return;
            const submit = addForm.querySelector<HTMLButtonElement>('[type="submit"]')!;
            submit.disabled = true;
            const saveStatus = page.querySelector<HTMLElement>("[data-weapon-save-status]")!;
            saveStatus.textContent = "Saving weapon...";
            try {
                const response = await fetch(`/api/weapons/manual?${accountQuery}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ...selectedWeapon,
                        level: Number(
                            (addForm.elements.namedItem("level") as HTMLInputElement).value,
                        ),
                        refinement: Number(
                            (addForm.elements.namedItem("refinement") as HTMLInputElement).value,
                        ),
                    }),
                });
                if (!response.ok) throw new Error();
                const saved = (await response.json()) as { weapon: Weapon };
                manual.push(saved.weapon);
                notify("Weapon added to Owned.");
                publishWeapons();
                dialog.close();
                page.querySelector<HTMLButtonElement>('[data-weapons-tab="owned"]')!.click();
                search.value = "";
                type.value = "";
                rarity.value = "";
                tagFilter.value = "";
                page.querySelector("#weapons-tag-value")!.textContent = "All tags";
                for (const group of page.querySelectorAll<HTMLElement>(
                    "[data-weapons-icon-filter]",
                )) {
                    for (const button of group.querySelectorAll<HTMLButtonElement>("button")) {
                        const active = button.dataset.value === "";
                        button.classList.toggle("selected", active);
                        button.setAttribute("aria-pressed", String(active));
                    }
                }
                render();
            } catch {
                saveStatus.textContent = "Couldn't save this weapon. Please try again.";
                notify(saveStatus.textContent, "error");
            } finally {
                submit.disabled = false;
            }
        });
        const tabs = [...page.querySelectorAll<HTMLButtonElement>("[data-weapons-tab]")];
        for (const button of tabs) {
            button.addEventListener("click", () => {
                tab = button.dataset.weaponsTab as typeof tab;
                const url = new URL(window.location.href);
                if (tab === "owned") url.searchParams.delete("tab");
                else url.searchParams.set("tab", tab);
                history.replaceState(history.state, "", url);
                const tabInput = page.querySelector<HTMLInputElement>("[data-weapons-tab-input]");
                if (tabInput) tabInput.value = tab;
                for (const item of tabs) {
                    item.setAttribute("aria-selected", String(item === button));
                    item.classList.toggle("active", item === button);
                    item.tabIndex = item === button ? 0 : -1;
                }
                if (tab !== "planner")
                    page.querySelector("#weapons-results")!.setAttribute(
                        "aria-labelledby",
                        button.id,
                    );
                render();
            });
            button.addEventListener("keydown", (event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next =
                    event.key === "Home"
                        ? tabs[0]
                        : event.key === "End"
                          ? tabs[tabs.length - 1]
                          : tabs[
                                (tabs.indexOf(button) +
                                    (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                                    tabs.length
                            ];
                next.focus();
                next.click();
            });
        }
        tabs.find((button) => button.dataset.weaponsTab === tab)?.click();
        for (const select of page.querySelectorAll<HTMLElement>("[data-weapons-select]")) {
            const trigger = select.querySelector<HTMLButtonElement>(".custom-select-button")!;
            const options = [...select.querySelectorAll<HTMLButtonElement>("[role=option]")];
            const input = select.querySelector<HTMLInputElement>("input")!;
            const close = () => {
                select.classList.remove("open");
                trigger.setAttribute("aria-expanded", "false");
            };
            trigger.addEventListener("click", () => {
                const opening = !select.classList.contains("open");
                for (const other of page.querySelectorAll<HTMLElement>("[data-weapons-select]")) {
                    other.classList.remove("open");
                    other
                        .querySelector(".custom-select-button")!
                        .setAttribute("aria-expanded", "false");
                }
                select.classList.toggle("open", opening);
                trigger.setAttribute("aria-expanded", String(opening));
            });
            for (const option of options) {
                option.addEventListener("click", () => {
                    input.value = option.dataset.value!;
                    select.querySelector(".custom-select-value")!.textContent =
                        option.textContent!.trim();
                    for (const item of options) {
                        item.classList.toggle("selected", item === option);
                        item.setAttribute("aria-selected", String(item === option));
                    }
                    close();
                    trigger.focus();
                    if (input.hasAttribute("data-weapons-account")) input.form!.requestSubmit();
                    else render();
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
                    const index = options.indexOf(document.activeElement as HTMLButtonElement);
                    options[
                        (index +
                            (event.key === "ArrowDown" ? 1 : options.length - 1) +
                            options.length) %
                            options.length
                    ]?.focus();
                }
            });
            select.addEventListener("focusout", (event) => {
                if (!select.contains(event.relatedTarget as Node | null)) close();
            });
        }
        document.addEventListener(
            "click",
            (event) => {
                for (const select of page.querySelectorAll<HTMLElement>("[data-weapons-select]")) {
                    if (!select.contains(event.target as Node)) {
                        select.classList.remove("open");
                        select
                            .querySelector(".custom-select-button")!
                            .setAttribute("aria-expanded", "false");
                    }
                }
            },
            { signal: lifecycle.signal },
        );
        for (const group of page.querySelectorAll<HTMLElement>("[data-weapons-icon-filter]")) {
            const input = group.dataset.weaponsIconFilter === "type" ? type : rarity;
            for (const button of group.querySelectorAll<HTMLButtonElement>("button")) {
                button.addEventListener("click", () => {
                    input.value = button.dataset.value!;
                    for (const item of group.querySelectorAll<HTMLButtonElement>("button")) {
                        item.classList.toggle("selected", item === button);
                        item.setAttribute("aria-pressed", String(item === button));
                    }
                    render();
                });
            }
        }
        search.addEventListener("input", render);
        window.addEventListener("cyrene-content-preferences-changed", render, {
            signal: lifecycle.signal,
        });
        type.addEventListener("change", render);
        rarity.addEventListener("change", render);
        refresh.addEventListener("click", () => void load(true));
        let lastRefresh = Date.now();
        const autoRefresh = () => {
            if (
                document.hidden ||
                !page.isConnected ||
                loading ||
                page.querySelector("dialog[open]") ||
                Date.now() - lastRefresh < 120_000
            )
                return;
            lastRefresh = Date.now();
            void load(false, true);
        };
        const refreshTimer = window.setInterval(autoRefresh, 120_000);
        document.addEventListener("visibilitychange", autoRefresh, { signal: lifecycle.signal });
        window.addEventListener("focus", autoRefresh, { signal: lifecycle.signal });
        lifecycle.signal.addEventListener("abort", () => window.clearInterval(refreshTimer), {
            once: true,
        });
        void load();
    };
})();
