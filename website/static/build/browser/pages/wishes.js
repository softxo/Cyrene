(() => {
    const page = document.querySelector(".wishes-page");
    const accountId = page?.dataset.accountId;
    if (!page || !accountId)
        return;
    const selectedAccountId = accountId;
    const history = document.getElementById("wish-history");
    const urlInput = document.getElementById("wish-url");
    const importButton = document.getElementById("wish-import");
    const status = document.getElementById("wish-import-status");
    const filter = document.getElementById("wish-filter");
    const success = document.getElementById("wish-import-success");
    const successMessage = document.getElementById("wish-import-success-message");
    const selectedRarities = new Set([3, 4, 5]);
    const standardFiveStars = new Set(["Diluc", "Jean", "Keqing", "Mona", "Qiqi", "Tighnari", "Dehya", "Yumemizuki Mizuki"]);
    const bannerLabels = { character: "Character Event", weapon: "Weapon Event", standard: "Standard", novice: "Novice", chronicled: "Chronicled" };
    let wishes = [];
    let successTimer = 0;
    const category = (type) => {
        if (type === "301" || type === "400")
            return "character";
        if (type === "302")
            return "weapon";
        if (type === "200")
            return "standard";
        if (type === "100")
            return "novice";
        if (type === "500")
            return "chronicled";
        return "other";
    };
    const label = (type) => bannerLabels[category(type)] || "Wish";
    const pity = (kind) => {
        let count = 0;
        for (const wish of wishes.filter(item => category(item.gacha_type) === kind)) {
            if (Number(wish.rank_type) === 5)
                break;
            count += 1;
        }
        return count;
    };
    function initialiseDropdowns() {
        document.querySelectorAll("[data-wish-select]").forEach(select => {
            const button = select.querySelector(".custom-select-button");
            const value = select.querySelector(".custom-select-value");
            const input = select.querySelector("input");
            const options = select.querySelectorAll(".custom-select-option");
            const close = () => { select.classList.remove("open"); button.setAttribute("aria-expanded", "false"); };
            button.addEventListener("click", event => {
                event.stopPropagation();
                document.querySelectorAll(".custom-select.open").forEach(open => { if (open !== select)
                    open.classList.remove("open"); });
                const open = select.classList.toggle("open");
                button.setAttribute("aria-expanded", String(open));
            });
            options.forEach(option => option.addEventListener("click", () => {
                options.forEach(item => item.classList.toggle("selected", item === option));
                value.textContent = option.textContent?.trim() || "";
                input.value = option.dataset.value || "";
                close();
                if (select.hasAttribute("data-submit-on-select"))
                    select.closest("form")?.requestSubmit();
                else
                    render();
            }));
        });
        document.addEventListener("click", () => document.querySelectorAll(".custom-select.open").forEach(open => open.classList.remove("open")));
        document.addEventListener("keydown", event => { if (event.key === "Escape")
            document.querySelectorAll(".custom-select.open").forEach(open => open.classList.remove("open")); });
    }
    function resultFor(wish) {
        if (Number(wish.rank_type) !== 5 || category(wish.gacha_type) !== "character" || wish.item_type.toLowerCase() !== "character")
            return null;
        return standardFiveStars.has(wish.item_name) ? "loss" : "win";
    }
    function render() {
        document.getElementById("wish-total").textContent = String(wishes.length);
        document.getElementById("wish-five-stars").textContent = String(wishes.filter(w => Number(w.rank_type) === 5).length);
        document.getElementById("wish-character-pity").textContent = String(pity("character"));
        document.getElementById("wish-weapon-pity").textContent = String(pity("weapon"));
        const visible = wishes.filter(wish => (filter.value === "all" || category(wish.gacha_type) === filter.value) && selectedRarities.has(Number(wish.rank_type)));
        if (!visible.length) {
            history.innerHTML = '<p class="wish-empty-message">No wishes match these filters.</p>';
            return;
        }
        history.replaceChildren(...visible.map(wish => {
            const row = document.createElement("article");
            row.className = "wish-row";
            row.dataset.rank = String(wish.rank_type);
            const fallback = document.createElement("span");
            fallback.className = "wish-item-icon wish-item-fallback";
            fallback.textContent = wish.item_name.slice(0, 1);
            let visual = fallback;
            if (wish.icon_url) {
                const image = document.createElement("img");
                image.className = "wish-item-icon";
                image.src = wish.icon_url;
                image.alt = "";
                image.loading = "lazy";
                image.addEventListener("error", () => image.replaceWith(fallback), { once: true });
                visual = image;
            }
            const details = document.createElement("div");
            const nameLine = document.createElement("div");
            nameLine.className = "wish-name-line";
            const name = document.createElement("span");
            name.className = "wish-name";
            name.textContent = wish.item_name;
            nameLine.append(name);
            const result = resultFor(wish);
            if (result) {
                const badge = document.createElement("span");
                badge.className = `wish-result ${result}`;
                badge.textContent = result;
                badge.title = result === "loss" ? "Standard-pool five-star on Character Event Wish" : "Limited five-star on Character Event Wish";
                nameLine.append(badge);
            }
            const meta = document.createElement("span");
            meta.className = "wish-meta";
            meta.textContent = `${wish.rank_type}★ ${wish.item_type} · ${label(wish.gacha_type)}`;
            details.append(nameLine, meta);
            const date = document.createElement("time");
            date.className = "wish-date";
            date.textContent = new Date(wish.pulled_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
            row.append(visual, details, date);
            return row;
        }));
    }
    async function load() {
        const response = await fetch(`/api/wishes?account_id=${encodeURIComponent(selectedAccountId)}`);
        if (!response.ok)
            throw new Error("Could not load wish history.");
        wishes = (await response.json()).wishes || [];
        render();
    }
    function showVerified(imported) {
        successMessage.textContent = `${imported} new wish${imported === 1 ? "" : "es"} imported successfully.`;
        window.clearTimeout(successTimer);
        success.hidden = false;
        successTimer = window.setTimeout(() => { success.hidden = true; }, 2200);
    }
    document.querySelectorAll(".wish-rarity-filter").forEach(button => button.addEventListener("click", () => {
        const rarity = Number(button.dataset.rarity);
        if (selectedRarities.has(rarity))
            selectedRarities.delete(rarity);
        else
            selectedRarities.add(rarity);
        button.classList.toggle("active", selectedRarities.has(rarity));
        button.setAttribute("aria-pressed", String(selectedRarities.has(rarity)));
        render();
    }));
    importButton.addEventListener("click", async () => {
        const url = urlInput.value.trim();
        if (!url)
            return;
        importButton.disabled = true;
        status.className = "wish-import-status";
        status.textContent = "Importing wish history…";
        try {
            const response = await fetch(`/api/wishes/import?account_id=${encodeURIComponent(selectedAccountId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.detail || "Wish import failed.");
            urlInput.value = "";
            status.textContent = "";
            await load();
            showVerified(Number(result.imported) || 0);
        }
        catch (error) {
            status.classList.add("error");
            status.textContent = error instanceof Error ? error.message : "Wish import failed.";
        }
        finally {
            importButton.disabled = false;
        }
    });
    initialiseDropdowns();
    load().catch(error => { history.textContent = error instanceof Error ? error.message : "Could not load wish history."; });
})();
