const DAY_MS = 86400000;

const IMPORT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
};

function freshness(days: number): string {
    if (days < 7) return "fresh";

    if (days < 30) return "ageing";

    return "old";
}

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

        const days = Math.max(0, (Date.now() - date.getTime()) / DAY_MS);
        const importedAt = date.toLocaleString("en-GB", IMPORT_DATE_FORMAT);

        element.dataset.freshness = freshness(days);
        element.textContent = `Last imported: ${importedAt}`;
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
