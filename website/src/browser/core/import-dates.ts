export async function refreshImportDate(kind: string, accountId: string) {
    const element = document.querySelector<HTMLElement>(`[data-import-date="${kind}"]`);
    if (!element) return;
    element.hidden = true;
    element.textContent = "";
    delete element.dataset.freshness;
    try {
        const response = await fetch(
            `/api/import-dates?account_id=${encodeURIComponent(accountId)}`,
        );
        if (!response.ok) throw new Error("Import date unavailable");
        const dates = await response.json();
        if (!element.isConnected) return;
        if (typeof dates[kind] !== "string" || !dates[kind]) return;
        const date = new Date(dates[kind]);
        if (!Number.isFinite(date.getTime())) return;
        const days = Math.max(0, (Date.now() - date.getTime()) / 86400000);
        element.dataset.freshness = days < 7 ? "fresh" : days < 30 ? "ageing" : "old";
        element.textContent = `Last imported: ${date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
        element.hidden = false;
        element.title = "Green: under 7 days; yellow: 7 to 29 days; red: 30 days or more.";
    } catch {
        if (element.isConnected) element.hidden = true;
    }
}

declare global {
    interface Window {
        refreshImportDate: typeof refreshImportDate;
    }
}
