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
        const response = await fetch(
            `/api/inventory?account_id=${encodeURIComponent(accountId)}`
        );
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
    } catch (error) {
        loading.classList.add("inventory-message-error");
        loading.removeAttribute("data-inventory-loading");
        loading.innerHTML = "";
        const title = document.createElement("h2");
        title.textContent = "Unable to load inventory";
        const description = document.createElement("p");
        description.textContent = error.message;
        loading.append(title, description);
    }
}

function initInventoryAccountDropdown() {
    const form = document.querySelector(
        "[data-inventory-account-form]"
    );

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

    button.addEventListener("click", event => {
        event.preventDefault();
        const shouldOpen = !select.classList.contains("open");
        close();

        if (shouldOpen) {
            select.classList.add("open");
            button.setAttribute("aria-expanded", "true");
        }
    });

    options.forEach(option => {
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

    document.addEventListener("click", event => {
        if (!select.contains(event.target)) {
            close();
        }
    });

    button.addEventListener("keydown", event => {
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

    search.addEventListener("input", () => {
        const query = search.value.trim().toLowerCase();
        let visible = 0;

        items.forEach(item => {
            const matches = item.dataset.inventoryName.includes(query);
            item.hidden = !matches;
            visible += Number(matches);
        });

        if (count) {
            count.textContent = String(visible);
        }

        if (empty) {
            empty.hidden = visible !== 0;
        }
    });
}

window.initInventory = initInventory;
