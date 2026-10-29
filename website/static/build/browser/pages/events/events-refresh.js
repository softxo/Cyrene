// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
// =========================================================
// EVENTS — FLICKER-FREE AUTOMATIC REFRESH
// =========================================================
window.refreshEvents = async function refreshEvents() {
    if (window.eventsRefreshing || document.querySelector('.event-checkmark[data-saving="true"]')) {
        return;
    }
    const currentPage = document.querySelector(".events-page");
    if (!currentPage) {
        return;
    }
    // Never refresh while the user is editing or rearranging events.
    const customModal = currentPage.querySelector("[data-custom-modal]");
    if (customModal && !customModal.hidden) {
        return;
    }
    if (currentPage.querySelector(".custom-select.open, .events-custom-dropdown.open") ||
        currentPage.querySelector(".events-custom-card.is-dragging") ||
        window.eventsRefreshingOrder) {
        return;
    }
    const activityRevision = window.eventsActivityRevision || 0;
    window.eventsRefreshing = true;
    try {
        const isOverview = currentPage.dataset.overview === "true";
        const accountId = currentPage.dataset.accountId || "";
        const params = new URLSearchParams();
        // Preserve the currently selected account tab.
        const activeAccountTab = currentPage.querySelector(".events-account-tab.active");
        if (activeAccountTab) {
            params.set("tab", activeAccountTab.dataset.accountTab);
        }
        if (isOverview) {
            params.set("overview", "true");
        }
        if (accountId) {
            params.set("account_id", accountId);
        }
        const response = await fetch(`/events/refresh?${params.toString()}`, {
            headers: {
                "X-Requested-With": "XMLHttpRequest",
            },
        });
        if (!response.ok) {
            return;
        }
        const html = await response.text();
        const parser = new DOMParser();
        const refreshedDocument = parser.parseFromString(html, "text/html");
        const refreshedPage = refreshedDocument.querySelector(".events-page");
        if (activityRevision !== (window.eventsActivityRevision || 0) ||
            !refreshedPage ||
            document.querySelector('.event-checkmark[data-saving="true"]')) {
            return;
        }
        // A new server template can arrive while this tab still has older CSS.
        // Load the matching stylesheet before inserting any new card markup.
        const refreshedStyle = refreshedDocument.querySelector('link[data-page-style="/events"]');
        const currentStyles = [...document.querySelectorAll('link[data-page-style="/events"]')];
        if (refreshedStyle) {
            const href = new URL(refreshedStyle.getAttribute("href"), window.location.origin).href;
            if (!currentStyles.some((link) => link.href === href)) {
                const link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = href;
                link.dataset.pageStyle = "/events";
                try {
                    await new Promise((resolve, reject) => {
                        link.addEventListener("load", resolve, { once: true });
                        link.addEventListener("error", reject, { once: true });
                        document.head.appendChild(link);
                    });
                }
                catch (error) {
                    link.remove();
                    throw error;
                }
                // Do not insert stale data if the user navigated or checked an event while CSS loaded.
                if (!currentPage.isConnected || activityRevision !== (window.eventsActivityRevision || 0)) {
                    link.remove();
                    return;
                }
                currentStyles.forEach((old) => old.remove());
            }
        }
        // -------------------------------------------------
        // DOM SYNCHRONISATION
        //
        // Keep existing elements wherever possible.
        // Change text and attributes only when necessary.
        // -------------------------------------------------
        const preservedClasses = new Set(["active", "collapsed", "open", "is-dragging"]);
        function getNodeKey(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return null;
            }
            if (node.id) {
                return `id:${node.id}`;
            }
            const eventType = node.dataset.eventType;
            if (eventType) {
                return `event:${eventType}`;
            }
            const activityType = node.dataset.activityType;
            const activityAccount = node.dataset.accountId;
            if (activityType && activityAccount) {
                return `activity:${activityType}:${activityAccount}:${node.dataset.eventKey || ""}`;
            }
            const overviewPanel = node.dataset.overviewPanel;
            if (overviewPanel) {
                return `overview:${overviewPanel}`;
            }
            const resinKind = node.dataset.resinKind;
            if (resinKind) {
                return `resin:${resinKind}`;
            }
            const limitedEventId = node.dataset.limitedEventId;
            if (limitedEventId) {
                return `limited-event:${limitedEventId}`;
            }
            const customAccountGroup = node.matches("[data-custom-account-group]");
            if (customAccountGroup) {
                return `custom-account:${node.dataset.accountId}`;
            }
            return null;
        }
        function syncAttributes(current, refreshed) {
            const isFeaturedCard = current.matches(".event-featured-card");
            const wasDetailsOpen = current instanceof HTMLDetailsElement && current.open;
            const wasCollapsed = isFeaturedCard && current.classList.contains("collapsed");
            const previousClasses = new Set(Array.from(current.classList).filter((className) => preservedClasses.has(className)));
            // Remove attributes that no longer exist.
            for (const attribute of Array.from(current.attributes)) {
                if (!refreshed.hasAttribute(attribute.name)) {
                    current.removeAttribute(attribute.name);
                }
            }
            // Apply only changed attributes.
            for (const attribute of Array.from(refreshed.attributes)) {
                if (current.getAttribute(attribute.name) !== attribute.value) {
                    current.setAttribute(attribute.name, attribute.value);
                }
            }
            // Preserve the user's current UI state.
            if (current instanceof HTMLElement && refreshed instanceof HTMLElement) {
                for (const className of previousClasses) {
                    current.classList.add(className);
                }
            }
            if (current instanceof HTMLDetailsElement) {
                current.open = wasDetailsOpen;
            }
            // Preserve expanded/collapsed state and open controls.
            if (current.matches(".event-featured-card")) {
                current.classList.toggle("collapsed", wasCollapsed);
                const toggle = current.querySelector(".event-featured-toggle");
                if (toggle) {
                    toggle.setAttribute("aria-expanded", String(!current.classList.contains("collapsed")));
                }
            }
            if (current.matches(".event-featured-toggle")) {
                const card = current.closest(".event-featured-card");
                if (card) {
                    current.setAttribute("aria-expanded", String(!card.classList.contains("collapsed")));
                }
            }
        }
        function patchNode(current, refreshed) {
            // Different node types cannot be synchronised in place.
            if (current.nodeType !== refreshed.nodeType) {
                const replacement = refreshed.cloneNode(true);
                current.replaceWith(replacement);
                return replacement;
            }
            // Text and comment nodes: change only when necessary.
            if (current.nodeType === Node.TEXT_NODE || current.nodeType === Node.COMMENT_NODE) {
                if (current.nodeValue !== refreshed.nodeValue) {
                    current.nodeValue = refreshed.nodeValue;
                }
                return current;
            }
            // Different element types require a local replacement.
            if (current.nodeName !== refreshed.nodeName) {
                const replacement = refreshed.cloneNode(true);
                current.replaceWith(replacement);
                return replacement;
            }
            // Category controls are client-owned: preserve their open popover,
            // generated toggles and anchor coordinates during background refresh.
            if (current instanceof HTMLElement && current.matches(".events-limited-filter")) {
                return current;
            }
            syncAttributes(current, refreshed);
            // Preserve the contents and live state of form controls.
            if (current instanceof HTMLInputElement ||
                current instanceof HTMLTextAreaElement ||
                current instanceof HTMLSelectElement) {
                return current;
            }
            // Match children by stable keys first, then position.
            const oldChildren = Array.from(current.childNodes);
            const newChildren = Array.from(refreshed.childNodes);
            const keyedChildren = new Map();
            for (const child of oldChildren) {
                const key = getNodeKey(child);
                if (key) {
                    keyedChildren.set(key, child);
                }
            }
            let position = 0;
            for (const newChild of newChildren) {
                const key = getNodeKey(newChild);
                const matchingChild = key ? keyedChildren.get(key) : null;
                if (matchingChild && matchingChild.parentNode === current) {
                    patchNode(matchingChild, newChild);
                    position = Math.max(position, oldChildren.indexOf(matchingChild) + 1);
                    continue;
                }
                const candidate = oldChildren[position];
                if (candidate &&
                    !getNodeKey(candidate) &&
                    !key &&
                    candidate.parentNode === current) {
                    patchNode(candidate, newChild);
                    position += 1;
                    continue;
                }
                const newElement = newChild.cloneNode(true);
                if (candidate) {
                    current.insertBefore(newElement, candidate);
                }
                else {
                    current.appendChild(newElement);
                }
                position += 1;
            }
            // Remove only children absent from the refreshed response.
            // Custom Events are deliberately outside the refreshed roots.
            const retainedKeys = new Set(newChildren.map(getNodeKey).filter(Boolean));
            const retainedUnkeyedCount = newChildren.filter((child) => !getNodeKey(child)).length;
            let unkeyedSeen = 0;
            for (const child of Array.from(current.childNodes)) {
                const key = getNodeKey(child);
                if (key) {
                    if (!retainedKeys.has(key)) {
                        child.remove();
                    }
                    continue;
                }
                if (unkeyedSeen >= retainedUnkeyedCount) {
                    child.remove();
                }
                else {
                    unkeyedSeen += 1;
                }
            }
            return current;
        }
        function refreshInPlace(selector) {
            const current = currentPage.querySelector(selector);
            const refreshed = refreshedPage.querySelector(selector);
            if (!current || !refreshed) {
                return;
            }
            patchNode(current, refreshed);
        }
        // -------------------------------------------------
        // ACCOUNT LAYOUT
        // -------------------------------------------------
        if (!isOverview) {
            refreshInPlace(".events-featured");
            refreshInPlace(".events-list");
            refreshInPlace(".events-wishes");
            refreshInPlace(".events-limited");
        }
        // -------------------------------------------------
        // OVERVIEW LAYOUT
        // -------------------------------------------------
        if (isOverview) {
            for (const panel of ["daily", "resin", "trounce", "endgame", "wishes", "events"]) {
                refreshInPlace(`.events-overview-panel[data-overview-panel="${panel}"]`);
            }
        }
        // -------------------------------------------------
        // REINITIALISE REQUIRED BEHAVIOUR
        // -------------------------------------------------
        if (window.initialiseAccountTabs) {
            // A refresh can finish after the user changes tabs. Restore the
            // latest client-side choice instead of stale response visibility.
            window.initialiseAccountTabs();
        }
        if (window.initialiseActivityCheckmarks) {
            window.initialiseActivityCheckmarks();
        }
        if (window.updateEventTimeLeft) {
            window.updateEventTimeLeft();
        }
        if (window.updateResinTimers) {
            window.updateResinTimers();
        }
    }
    catch (error) {
        console.error("Failed to refresh Events:", error);
    }
    finally {
        window.eventsRefreshing = false;
    }
};
