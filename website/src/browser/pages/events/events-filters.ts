(() => {
    if (document.documentElement.dataset.limitedFiltersInitialised) return;
    document.documentElement.dataset.limitedFiltersInitialised = "true";
    const key = "cyrene-limited-hidden-categories-v1";
    const collapsedKey = "cyrene-limited-collapsed-accounts-v1";
    let collapsed = new Set<string>();
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(collapsedKey) || "[]");
        if (Array.isArray(saved))
            collapsed = new Set(
                saved.filter((value): value is string => typeof value === "string"),
            );
    } catch {
        /* Keep account expansion preferences in memory if storage is unavailable. */
    }
    const initialisedGroups = new WeakSet<HTMLDetailsElement>();
    const restoreAccountGroups = () => {
        document
            .querySelectorAll<HTMLDetailsElement>("details[data-limited-account-group]")
            .forEach((group) => {
                if (initialisedGroups.has(group)) return;
                const uid = group.dataset.accountUid;
                if (!uid) return;
                initialisedGroups.add(group);
                group.open = !collapsed.has(uid);
                group.addEventListener("toggle", () => {
                    if (!group.isConnected) return;
                    if (group.open) collapsed.delete(uid);
                    else collapsed.add(uid);
                    try {
                        localStorage.setItem(collapsedKey, JSON.stringify([...collapsed]));
                    } catch {
                        /* Keep the preference for this visit. */
                    }
                });
            });
    };
    let disabled = new Set<string>();
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(key) || "[]");
        if (Array.isArray(saved))
            disabled = new Set(saved.filter((value): value is string => typeof value === "string"));
    } catch {
        /* Storage can be unavailable; filtering still works for this visit. */
    }

    const apply = () => {
        // CSS covers incoming cards before the DOM observer runs, including
        // refreshed markup that has not yet received its hidden attribute.
        let visibilityStyle = document.querySelector<HTMLStyleElement>(
            "#limited-event-category-visibility",
        );
        if (!visibilityStyle) {
            visibilityStyle = document.createElement("style");
            visibilityStyle.id = "limited-event-category-visibility";
            document.head.append(visibilityStyle);
        }
        const rules = [...disabled]
            .map(
                (category) =>
                    `.events-page [data-limited-category="${CSS.escape(category)}"] { display: none !important; }`,
            )
            .join("\n");
        if (visibilityStyle.textContent !== rules) visibilityStyle.textContent = rules;
        restoreAccountGroups();
        document.querySelectorAll<HTMLElement>("[data-limited-category]").forEach((card) => {
            const hidden = disabled.has(card.dataset.limitedCategory || "Other Events");
            if (card.hidden !== hidden) card.hidden = hidden;
        });
        document
            .querySelectorAll<HTMLElement>(
                ".events-limited-list, [data-limited-account-group] .events-custom-list",
            )
            .forEach((list) => {
                const cards = [...list.querySelectorAll<HTMLElement>("[data-limited-category]")];
                let empty = list.querySelector<HTMLElement>("[data-limited-filter-empty]");
                if (!cards.length) return;
                if (!empty) {
                    empty = document.createElement("p");
                    empty.dataset.limitedFilterEmpty = "true";
                    empty.className = "events-limited-filter-empty";
                    empty.textContent = "No events match your selected categories.";
                    list.append(empty);
                }
                const hidden = cards.some((card) => !card.hidden);
                if (empty.hidden !== hidden) empty.hidden = hidden;
            });
        document.querySelectorAll<HTMLElement>("[data-limited-account-group]").forEach((group) => {
            const cards = [
                ...group.querySelectorAll<HTMLElement>("[data-limited-category]"),
            ].filter((card) => !card.hidden);
            const completed = cards.filter((card) => card.classList.contains("completed")).length;
            const count = group.querySelector<HTMLElement>("[data-limited-account-count]");
            const text = `${completed}/${cards.length} complete`;
            if (count && count.textContent !== text) count.textContent = text;
            count?.classList.toggle(
                "event-completion-pill",
                cards.length > 0 && completed === cards.length,
            );
        });
        document
            .querySelectorAll<HTMLInputElement>("[data-limited-filter-category]")
            .forEach((input) => {
                input.checked = !disabled.has(input.dataset.limitedFilterCategory || "");
            });
    };

    const positionOpenPopups = () => {
        document
            .querySelectorAll<HTMLElement>(".events-limited-filter-popup:popover-open")
            .forEach((popup) => {
                const button = popup.parentElement?.querySelector<HTMLElement>(
                    "[data-limited-filter-button]",
                );
                if (!button || !button.getClientRects().length) {
                    popup.hidePopover();
                    return;
                }
                const rect = button.getBoundingClientRect();
                popup.style.left = `${Math.max(8, Math.min(rect.right - popup.offsetWidth, window.innerWidth - popup.offsetWidth - 8))}px`;
                popup.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - popup.offsetHeight - 8))}px`;
            });
    };
    window.addEventListener("resize", positionOpenPopups);
    window.addEventListener("scroll", positionOpenPopups, true);
    window.addEventListener("focus", positionOpenPopups);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) positionOpenPopups();
    });

    let dismissingButton: HTMLButtonElement | null = null;
    // Native popovers light-dismiss before click fires. Remember their state
    // at pointerdown so clicking the trigger cannot immediately reopen them.
    document.addEventListener(
        "pointerdown",
        (event) => {
            const button = (event.target as Element).closest<HTMLButtonElement>(
                "[data-limited-filter-button]",
            );
            const popup = button?.parentElement?.querySelector<HTMLElement>("[popover]");
            dismissingButton = popup?.matches(":popover-open") ? button : null;
        },
        true,
    );

    document.addEventListener("click", (event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>(
            "[data-limited-filter-button]",
        );
        if (!button) return;
        const wasOpen = dismissingButton === button;
        dismissingButton = null;
        const popup = button.parentElement?.querySelector<HTMLElement>("[popover]");
        if (!popup) return;
        if (wasOpen || popup.matches(":popover-open")) {
            if (popup.matches(":popover-open")) popup.hidePopover();
            return;
        }
        const options = popup.querySelector<HTMLElement>("[data-limited-filter-options]")!;
        options.replaceChildren();
        const categories = new Set(["Quest", "World Exploration", "Daily", "TCG", "Other Events"]);
        document
            .querySelectorAll<HTMLElement>("[data-limited-category]")
            .forEach((card) => categories.add(card.dataset.limitedCategory!));
        for (const category of categories) {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "checkbox";
            input.dataset.limitedFilterCategory = category;
            input.checked = !disabled.has(category);
            label.append(
                input,
                document.createTextNode(category === "Quest" ? "Quests" : category),
            );
            options.append(label);
        }
        popup.ontoggle = () =>
            button.setAttribute("aria-expanded", String(popup.matches(":popover-open")));
        popup.showPopover();
        positionOpenPopups();
    });
    document.addEventListener("change", (event) => {
        const input = event.target as HTMLInputElement;
        const category = input.dataset.limitedFilterCategory;
        if (!category) return;
        if (input.checked) disabled.delete(category);
        else disabled.add(category);
        try {
            localStorage.setItem(key, JSON.stringify([...disabled]));
        } catch {
            /* Keep session selection. */
        }
        apply();
    });
    new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("storage", (event) => {
        if (event.key !== key) return;
        try {
            const saved: unknown = JSON.parse(event.newValue || "[]");
            if (Array.isArray(saved))
                disabled = new Set(
                    saved.filter((value): value is string => typeof value === "string"),
                );
        } catch {
            return;
        }
        apply();
    });
    apply();
})();
