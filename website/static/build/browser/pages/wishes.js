(() => {
    const page = document.querySelector(".wishes-page");
    const accountId = page?.dataset.accountId;
    if (!page || !accountId)
        return;
    const selectedAccountId = accountId;
    const history = document.getElementById("wish-history");
    const urlInput = document.getElementById("wish-url");
    const importButton = document.getElementById("wish-import");
    const importOpen = document.getElementById("wish-import-open");
    const importDialog = document.getElementById("wish-import-dialog");
    const filter = document.getElementById("wish-filter");
    const success = document.getElementById("wish-import-success");
    const successMessage = document.getElementById("wish-import-success-message");
    const importTitle = document.getElementById("wish-import-title");
    const importCount = document.getElementById("wish-import-count");
    const importClose = document.getElementById("wish-import-close");
    const selectedRarities = new Set([3, 4, 5]);
    const standardFiveStars = new Set(["Diluc", "Jean", "Keqing", "Mona", "Qiqi", "Tighnari", "Dehya", "Yumemizuki Mizuki"]);
    const bannerLabels = { character: "Character Event", weapon: "Weapon Event", standard: "Standard Banner", novice: "Novice", chronicled: "Chronicled Wish" };
    const summaryKinds = ["character", "weapon", "standard", "chronicled"];
    const listPageSize = 20;
    const gridPageSize = 24;
    let wishes = [];
    let currentPage = 1;
    let currentView = "list";
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
    const hitsRarity = (wish, rarity) => Number(wish.rank_type) === rarity;
    const pity = (kind, rarity) => {
        let count = 0;
        for (const wish of wishes.filter(item => category(item.gacha_type) === kind)) {
            if (hitsRarity(wish, rarity))
                break;
            count += 1;
        }
        return count;
    };
    const averagePity = (rarity) => {
        const intervals = [];
        [...new Set(wishes.map(wish => category(wish.gacha_type)))].forEach(kind => {
            let count = 0;
            const chronological = wishes.filter(wish => category(wish.gacha_type) === kind).reverse();
            for (const wish of chronological) {
                count += 1;
                if (hitsRarity(wish, rarity)) {
                    intervals.push(count);
                    count = 0;
                }
            }
        });
        return intervals.length ? (intervals.reduce((sum, value) => sum + value, 0) / intervals.length).toFixed(1) : "—";
    };
    const pullNumbers = () => {
        const numbers = new Map();
        const counters = new Map();
        for (const wish of [...wishes].reverse()) {
            const kind = category(wish.gacha_type);
            const number = (counters.get(kind) || 0) + 1;
            numbers.set(wish, number);
            counters.set(kind, Number(wish.rank_type) === 5 ? 0 : number);
        }
        return numbers;
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
                else {
                    currentPage = 1;
                    render();
                }
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
        summaryKinds.forEach(kind => {
            const bannerWishes = wishes.filter(item => category(item.gacha_type) === kind);
            document.getElementById(`wish-${kind}-pulls`).textContent = String(bannerWishes.length);
            document.getElementById(`wish-${kind}-five-pity`).textContent = String(pity(kind, 5));
            document.getElementById(`wish-${kind}-four-pity`).textContent = String(pity(kind, 4));
        });
        document.getElementById("wish-five-average").textContent = averagePity(5);
        document.getElementById("wish-four-average").textContent = averagePity(4);
        const characterFiveStars = wishes.filter(wish => resultFor(wish));
        const wins = characterFiveStars.filter(wish => resultFor(wish) === "win").length;
        document.getElementById("wish-win-rate").textContent = characterFiveStars.length ? `${Math.round(wins / characterFiveStars.length * 100)}%` : "—";
        const visible = wishes.filter(wish => (filter.value === "all" || category(wish.gacha_type) === filter.value) && selectedRarities.has(Number(wish.rank_type)));
        const pageSize = currentView === "grid" ? gridPageSize : listPageSize;
        const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
        currentPage = Math.min(currentPage, pageCount);
        const pageWishes = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);
        const wishPullNumbers = pullNumbers();
        history.className = currentView === "grid" ? "wish-history-grid" : "wish-history-list";
        if (!pageWishes.length)
            history.innerHTML = '<p class="wish-empty-message">No wishes match these filters.</p>';
        else
            history.replaceChildren(...pageWishes.map(wish => {
                const row = document.createElement("article");
                row.className = currentView === "grid" ? "wish-grid-item" : "wish-row";
                row.dataset.rank = String(wish.rank_type);
                const result = resultFor(wish);
                if (result)
                    row.classList.add(`result-${result}`);
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
                if (result) {
                    const badge = document.createElement("span");
                    badge.className = `wish-result ${result}`;
                    badge.textContent = result;
                    badge.title = result === "loss" ? "Standard-pool five-star on Character Event Wish" : "Limited five-star on Character Event Wish";
                    nameLine.append(badge);
                }
                const meta = document.createElement("span");
                meta.className = "wish-meta";
                const metaStar = document.createElement("b");
                metaStar.className = `wish-meta-star rarity-${wish.rank_type}`;
                metaStar.textContent = "★";
                meta.append(metaStar, ` ${wish.rank_type} ${wish.item_type} · ${label(wish.gacha_type)}`);
                details.append(nameLine, meta);
                const date = document.createElement("time");
                date.className = "wish-date";
                date.textContent = new Date(wish.pulled_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
                const pull = document.createElement("span");
                pull.className = "wish-pull-number";
                pull.textContent = `#${wishPullNumbers.get(wish) || 1}`;
                if (currentView === "grid") {
                    visual.title = `${wish.item_name} · ${wish.rank_type} star · pull ${pull.textContent}`;
                    row.setAttribute("aria-label", visual.title);
                    row.append(visual, pull);
                    if (result) {
                        const gridResult = document.createElement("span");
                        gridResult.className = `wish-grid-result ${result}`;
                        gridResult.textContent = result;
                        row.append(gridResult);
                    }
                }
                else
                    row.append(visual, details, pull, date);
                return row;
            }));
        renderPagination(pageCount, visible.length);
    }
    function renderPagination(pageCount, resultCount) {
        const pagination = document.getElementById("wish-pagination");
        if (!resultCount || pageCount <= 1) {
            pagination.replaceChildren();
            return;
        }
        const makeButton = (text, pageNumber, labelText, active = false) => {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = text;
            button.setAttribute("aria-label", labelText);
            if (active) {
                button.classList.add("active");
                button.setAttribute("aria-current", "page");
            }
            button.disabled = pageNumber < 1 || pageNumber > pageCount;
            button.addEventListener("click", () => { currentPage = pageNumber; render(); history.scrollIntoView({ behavior: "smooth", block: "start" }); });
            return button;
        };
        const pages = new Set([1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
        const nodes = [makeButton("‹", currentPage - 1, "Previous page")];
        let previous = 0;
        [...pages].filter(pageNumber => pageNumber >= 1 && pageNumber <= pageCount).sort((a, b) => a - b).forEach(pageNumber => {
            if (previous && pageNumber - previous > 1) {
                const ellipsis = document.createElement("span");
                ellipsis.textContent = "…";
                nodes.push(ellipsis);
            }
            nodes.push(makeButton(String(pageNumber), pageNumber, `Page ${pageNumber}`, pageNumber === currentPage));
            previous = pageNumber;
        });
        nodes.push(makeButton("›", currentPage + 1, "Next page"));
        pagination.replaceChildren(...nodes);
    }
    async function load() {
        const response = await fetch(`/api/wishes?account_id=${encodeURIComponent(selectedAccountId)}`);
        if (!response.ok)
            throw new Error("Could not load wish history.");
        wishes = (await response.json()).wishes || [];
        render();
    }
    function openImportModal() {
        success.classList.remove("complete", "error");
        importTitle.textContent = "Importing wishes";
        importCount.textContent = "0";
        successMessage.textContent = "Connecting to HoYoverse…";
        importClose.hidden = true;
        success.hidden = false;
    }
    function updateImportModal(event) {
        if (typeof event.found === "number")
            importCount.textContent = event.found.toLocaleString();
        if (event.type === "progress")
            successMessage.textContent = "Reading wish history…";
        if (event.type === "phase")
            successMessage.textContent = event.message || "Processing wishes…";
        if (event.type === "retry")
            successMessage.textContent = `HoYoverse asked us to slow down. Retrying in ${event.seconds || 2} seconds…`;
        if (event.type === "complete") {
            success.classList.add("complete");
            importTitle.textContent = "Import complete";
            const imported = Number(event.imported) || 0;
            successMessage.textContent = `${imported.toLocaleString()} new wish${imported === 1 ? "" : "es"} saved.`;
            importClose.hidden = false;
        }
        if (event.type === "error") {
            success.classList.add("error");
            importTitle.textContent = "Import stopped";
            successMessage.textContent = event.message || "Wish import failed.";
            importClose.hidden = false;
        }
    }
    document.querySelectorAll(".wish-rarity-filter").forEach(button => button.addEventListener("click", () => {
        const rarity = Number(button.dataset.rarity);
        if (selectedRarities.has(rarity))
            selectedRarities.delete(rarity);
        else
            selectedRarities.add(rarity);
        button.classList.toggle("active", selectedRarities.has(rarity));
        button.setAttribute("aria-pressed", String(selectedRarities.has(rarity)));
        currentPage = 1;
        render();
    }));
    document.querySelectorAll(".wish-view-toggle button").forEach(button => button.addEventListener("click", () => {
        currentView = button.dataset.view === "grid" ? "grid" : "list";
        currentPage = 1;
        document.querySelectorAll(".wish-view-toggle button").forEach(item => {
            const active = item === button;
            item.classList.toggle("active", active);
            item.setAttribute("aria-pressed", String(active));
        });
        render();
    }));
    const closeImportDialog = () => { importDialog.hidden = true; };
    importOpen.addEventListener("click", () => {
        importDialog.hidden = false;
        window.setTimeout(() => urlInput.focus(), 0);
    });
    document.querySelectorAll("[data-close-import-dialog]").forEach(button => button.addEventListener("click", closeImportDialog));
    importDialog.addEventListener("keydown", event => { if (event.key === "Escape")
        closeImportDialog(); });
    urlInput.addEventListener("keydown", event => { if (event.key === "Enter")
        importButton.click(); });
    importButton.addEventListener("click", async () => {
        const url = urlInput.value.trim();
        if (!url) {
            urlInput.focus();
            return;
        }
        importButton.disabled = true;
        closeImportDialog();
        openImportModal();
        try {
            const response = await fetch(`/api/wishes/import/stream?account_id=${encodeURIComponent(selectedAccountId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.detail || "Wish import failed.");
            }
            if (!response.body)
                throw new Error("Import progress is unavailable.");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let completed = false;
            while (true) {
                const { value, done } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    const event = JSON.parse(line);
                    updateImportModal(event);
                    if (event.type === "complete")
                        completed = true;
                    if (event.type === "error")
                        throw new Error(event.message || "Wish import failed.");
                }
                if (done)
                    break;
            }
            if (!completed)
                throw new Error("The import ended before it could finish.");
            urlInput.value = "";
            await load();
        }
        catch (error) {
            updateImportModal({ type: "error", message: error instanceof Error ? error.message : "Wish import failed." });
        }
        finally {
            importButton.disabled = false;
        }
    });
    importClose.addEventListener("click", () => { success.hidden = true; });
    initialiseDropdowns();
    load().catch(error => { history.textContent = error instanceof Error ? error.message : "Could not load wish history."; });
})();
