(() => {
    const page = document.querySelector<HTMLElement>(".wishes-page");
    const accountId = page?.dataset.accountId;
    if (!page || !accountId) return;
    const selectedAccountId = accountId;

    const history = document.getElementById("wish-history")!;
    const urlInput = document.getElementById("wish-url") as HTMLInputElement;
    const importButton = document.getElementById("wish-import") as HTMLButtonElement;
    const status = document.getElementById("wish-import-status")!;
    const filter = document.getElementById("wish-filter") as HTMLSelectElement;
    let wishes: any[] = [];

    const category = (type: string) => {
        if (type === "301" || type === "400") return "character";
        if (type === "302") return "weapon";
        if (type === "200") return "standard";
        if (type === "100") return "novice";
        if (type === "500") return "chronicled";
        return "other";
    };
    const bannerLabels: Record<string, string> = { character: "Character Event", weapon: "Weapon Event", standard: "Standard", novice: "Novice", chronicled: "Chronicled" };
    const label = (type: string) => bannerLabels[category(type)] || "Wish";
    const pity = (kind: string) => {
        let count = 0;
        for (const wish of wishes.filter(item => category(item.gacha_type) === kind)) {
            if (Number(wish.rank_type) === 5) break;
            count += 1;
        }
        return count;
    };

    function render() {
        document.getElementById("wish-total")!.textContent = String(wishes.length);
        document.getElementById("wish-five-stars")!.textContent = String(wishes.filter(w => Number(w.rank_type) === 5).length);
        document.getElementById("wish-character-pity")!.textContent = String(pity("character"));
        document.getElementById("wish-weapon-pity")!.textContent = String(pity("weapon"));
        const selected = filter.value;
        const visible = selected === "all" ? wishes : wishes.filter(w => category(w.gacha_type) === selected);
        if (!visible.length) {
            history.innerHTML = '<p class="wish-empty-message">No wishes found for this banner yet.</p>';
            return;
        }
        history.replaceChildren(...visible.map(wish => {
            const row = document.createElement("article");
            row.className = "wish-row";
            row.dataset.rank = String(wish.rank_type);
            const rarity = document.createElement("span");
            rarity.className = "wish-rarity";
            rarity.textContent = `${wish.rank_type}★`;
            const details = document.createElement("div");
            const name = document.createElement("span");
            name.className = "wish-name";
            name.textContent = wish.item_name;
            const meta = document.createElement("span");
            meta.className = "wish-meta";
            meta.textContent = `${wish.item_type} · ${label(wish.gacha_type)}`;
            details.append(name, meta);
            const date = document.createElement("time");
            date.className = "wish-date";
            date.textContent = new Date(wish.pulled_at).toLocaleString();
            row.append(rarity, details, date);
            return row;
        }));
    }

    async function load() {
        const response = await fetch(`/api/wishes?account_id=${encodeURIComponent(selectedAccountId)}`);
        if (!response.ok) throw new Error("Could not load wish history.");
        wishes = (await response.json()).wishes || [];
        render();
    }

    importButton.addEventListener("click", async () => {
        const url = urlInput.value.trim();
        if (!url) return;
        importButton.disabled = true;
        status.className = "wish-import-status";
        status.textContent = "Importing wish history…";
        try {
            const response = await fetch(`/api/wishes/import?account_id=${encodeURIComponent(selectedAccountId)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail || "Wish import failed.");
            urlInput.value = "";
            status.classList.add("success");
            status.textContent = `Import complete: ${result.imported} new of ${result.found} wishes found.`;
            await load();
        } catch (error) {
            status.classList.add("error");
            status.textContent = error instanceof Error ? error.message : "Wish import failed.";
        } finally {
            importButton.disabled = false;
        }
    });
    filter.addEventListener("change", render);
    load().catch(error => { history.innerHTML = `<p class="wish-empty-message">${error.message}</p>`; });
})();
