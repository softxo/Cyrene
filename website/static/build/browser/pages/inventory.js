// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
function initInventory() {
    initInventoryAccountDropdown();
    loadInventory();
}
async function loadInventory() {
    const loading = document.querySelector("[data-inventory-loading]");
    const grid = document.querySelector("[data-inventory-grid]");
    if (!loading || !grid || loading.dataset.loading === "true") {
        initInventorySearch();
        return;
    }
    const accountId = loading.dataset.accountId;
    if (!accountId) {
        return;
    }
    loading.dataset.loading = "true";
    try {
        const response = await fetch(`/api/inventory?account_id=${encodeURIComponent(accountId)}`);
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload?.error || "Couldn't retrieve inventory.");
        }
        const inventory = payload?.inventory || [];
        loading.remove();
        if (!inventory.length) {
            const message = document.createElement("section");
            message.className = "inventory-message";
            const title = document.createElement("h2");
            title.textContent = "No materials found";
            const description = document.createElement("p");
            description.textContent =
                "HoYoLAB did not return any calculator-supported materials for this account.";
            message.append(title, description);
            grid.replaceWith(message);
            return;
        }
        const fragment = document.createDocumentFragment();
        for (const item of inventory) {
            const card = document.createElement("article");
            card.className = `inventory-card rarity-${Number(item.rarity) || 0}`;
            card.dataset.inventoryItem = "";
            card.dataset.inventoryRarity = String(Number(item.rarity) || 0);
            card.dataset.inventoryKind = item.kind || "Other materials";
            card.dataset.inventoryName = String(item.name || "").toLowerCase();
            const iconWrap = document.createElement("div");
            iconWrap.className = "inventory-icon-wrap";
            if (item.icon) {
                const icon = document.createElement("img");
                icon.src = item.icon;
                icon.alt = "";
                icon.className = "inventory-icon";
                icon.loading = "lazy";
                iconWrap.append(icon);
            }
            const details = document.createElement("div");
            details.className = "inventory-card-details";
            const name = document.createElement("h2");
            name.textContent = item.name || "Unknown material";
            details.append(name);
            const amount = document.createElement("strong");
            amount.className = "inventory-amount";
            amount.textContent = Number(item.amount || 0).toLocaleString();
            card.append(iconWrap, details, amount);
            fragment.append(card);
        }
        grid.append(fragment);
        grid.hidden = false;
        document.querySelector(".inventory-toolbar")?.removeAttribute("hidden");
        document.querySelector("[data-inventory-note]")?.removeAttribute("hidden");
        const count = document.querySelector("[data-inventory-count]");
        if (count) {
            count.textContent = String(inventory.length);
        }
        initInventorySearch();
    }
    catch (error) {
        loading.classList.add("inventory-message-error");
        loading.removeAttribute("data-inventory-loading");
        loading.replaceChildren();
        const title = document.createElement("h2");
        title.textContent = "Unable to load inventory";
        const description = document.createElement("p");
        description.textContent = error.message;
        loading.append(title, description);
    }
}
function initInventoryAccountDropdown() {
    const form = document.querySelector("[data-inventory-account-form]");
    if (!form || form.dataset.initialised === "true") {
        return;
    }
    const select = form.querySelector(".inventory-account-select");
    const button = select?.querySelector(".custom-select-button");
    const value = select?.querySelector(".custom-select-value");
    const input = select?.querySelector('input[name="account_id"]');
    const options = select?.querySelectorAll(".custom-select-option");
    if (!select || !button || !value || !input || !options) {
        return;
    }
    form.dataset.initialised = "true";
    const close = () => {
        select.classList.remove("open");
        button.setAttribute("aria-expanded", "false");
    };
    button.addEventListener("click", (event) => {
        event.preventDefault();
        const shouldOpen = !select.classList.contains("open");
        close();
        if (shouldOpen) {
            select.classList.add("open");
            button.setAttribute("aria-expanded", "true");
        }
    });
    options.forEach((option) => {
        option.addEventListener("click", () => {
            if (!option.dataset.value) {
                return;
            }
            input.value = option.dataset.value;
            value.textContent = option.textContent.trim();
            close();
            form.requestSubmit();
        });
    });
    document.addEventListener("click", (event) => {
        if (!select.contains(event.target)) {
            close();
        }
    });
    button.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            close();
        }
    });
}
function initInventorySearch() {
    const search = document.querySelector("[data-inventory-search]");
    const items = document.querySelectorAll("[data-inventory-item]");
    const count = document.querySelector("[data-inventory-count]");
    const empty = document.querySelector("[data-inventory-empty]");
    if (!search || !items.length || search.dataset.initialised === "true") {
        return;
    }
    search.dataset.initialised = "true";
    const rarity = document.querySelector("[data-inventory-rarity]");
    const kind = document.querySelector("[data-inventory-kind]");
    const reset = document.querySelector("[data-inventory-reset]");
    const syncSelect = (select) => {
        const root = select.closest(".custom-select");
        root.querySelectorAll(".custom-select-option").forEach((option) => {
            const selected = option.dataset.value === select.value;
            option.classList.toggle("selected", selected);
            option.setAttribute("aria-selected", String(selected));
            if (selected)
                root.querySelector(".custom-select-value").textContent = option.textContent;
        });
    };
    const addOptions = (select, values, label) => {
        const root = select.closest(".custom-select");
        const trigger = root.querySelector(".custom-select-button");
        const menu = root.querySelector(".custom-select-menu");
        const close = () => {
            root.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
        };
        ["", ...values].forEach((value) => {
            const option = document.createElement("button");
            option.type = "button";
            option.className = "custom-select-option";
            option.setAttribute("role", "option");
            option.dataset.value = value;
            option.textContent = !value ? label : select === rarity ? `${value}-star` : value;
            option.addEventListener("click", () => {
                select.value = value;
                syncSelect(select);
                select.dispatchEvent(new Event("change"));
                close();
                trigger.focus();
            });
            menu.append(option);
        });
        syncSelect(select);
        trigger.addEventListener("click", () => {
            const open = !root.classList.contains("open");
            document
                .querySelectorAll("[data-inventory-select] .custom-select-button")
                .forEach((button) => {
                button.closest(".custom-select").classList.remove("open");
                button.setAttribute("aria-expanded", "false");
            });
            root.classList.toggle("open", open);
            trigger.setAttribute("aria-expanded", String(open));
        });
        root.addEventListener("keydown", (event) => {
            const options = [...menu.querySelectorAll("button")];
            if (event.key === "Escape") {
                close();
                trigger.focus();
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                root.classList.add("open");
                trigger.setAttribute("aria-expanded", "true");
                const current = options.indexOf(document.activeElement);
                const next = event.key === "Home"
                    ? 0
                    : event.key === "End"
                        ? options.length - 1
                        : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) %
                            options.length;
                options[next]?.focus();
            }
        });
        root.addEventListener("focusout", (event) => {
            if (!root.contains(event.relatedTarget))
                close();
        });
        document.addEventListener("click", (event) => {
            if (!root.contains(event.target))
                close();
        });
    };
    addOptions(rarity, [...new Set([...items].map((item) => item.dataset.inventoryRarity))]
        .filter((value) => Number(value) > 0)
        .sort((a, b) => Number(b) - Number(a)), "All rarities");
    addOptions(kind, [...new Set([...items].map((item) => item.dataset.inventoryKind))]
        .filter((value) => value !== "Other materials")
        .sort((a, b) => a.localeCompare(b)), "All types");
    const apply = () => {
        const query = search.value.trim().toLowerCase();
        let visible = 0;
        items.forEach((item) => {
            const matches = item.dataset.inventoryName.includes(query) &&
                (!rarity.value || item.dataset.inventoryRarity === rarity.value) &&
                (!kind.value || item.dataset.inventoryKind === kind.value);
            item.hidden = !matches;
            visible += Number(matches);
        });
        if (count)
            count.textContent = String(visible);
        if (empty)
            empty.hidden = visible !== 0;
        reset.disabled = !query && !rarity.value && !kind.value;
    };
    search.addEventListener("input", apply);
    rarity.addEventListener("change", apply);
    kind.addEventListener("change", apply);
    reset.addEventListener("click", () => {
        search.value = "";
        rarity.value = "";
        kind.value = "";
        syncSelect(rarity);
        syncSelect(kind);
        apply();
    });
    apply();
}
window.initInventory = initInventory;
