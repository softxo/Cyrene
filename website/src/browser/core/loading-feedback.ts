type Activity = {
    path: string;
    message?: string;
    visible: boolean;
    timer?: ReturnType<typeof setTimeout>;
};
const requests = new Map<symbol, Activity>();
let navigation: { id: symbol; path: string } | undefined;
let installed = false;

const labels: Record<string, string> = {
    "/": "Home",
    "/characters": "Characters",
    "/events": "Events",
    "/weapons": "Weapons",
    "/wishes": "Wishes",
    "/achievements": "Achievements",
    "/planner": "Planner",
    "/settings": "Settings",
    "/codes": "Gift Codes",
    "/verify": "Verification",
};

function renderLoading(): void {
    const activity = [...requests.values()]
        .reverse()
        .filter((request) => request.visible && request.path === window.location.pathname);
    const current = activity.find((request) => request.message) ?? activity[0];
    const path = navigation?.path ?? current?.path;
    const show = path !== undefined && path !== "/inventory";
    document.querySelector(".main-content")?.toggleAttribute("aria-busy", show);
    if (show) document.querySelector(".main-content")?.setAttribute("aria-busy", "true");
    document.querySelectorAll<HTMLAnchorElement>(".nav-item").forEach((item) => {
        item.classList.toggle("is-loading", show && new URL(item.href).pathname === path);
    });
    const existing = document.getElementById("navigation-loading-status");
    if (!show) {
        existing?.remove();
        return;
    }
    const message = (!navigation && current?.message) || `Loading ${labels[path] || "page"}\u2026`;
    if (existing?.dataset.path === path && existing?.dataset.message === message) return;
    existing?.remove();
    const status = document.createElement("div");
    status.id = "navigation-loading-status";
    status.dataset.path = path;
    status.dataset.message = message;
    status.setAttribute("role", "status");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.classList.add("navigation-loading-spark");
    const spark = document.createElementNS(icon.namespaceURI, "path");
    spark.setAttribute("d", "m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z");
    spark.setAttribute("fill", "currentColor");
    icon.append(spark);
    const text = document.createElement("span");
    text.textContent = message;
    status.append(icon, text);
    document.body.append(status);
}

/** Navigation feedback owns the indicator until the destination is ready. */
export function beginNavigationLoading(path: string): () => void {
    for (const request of requests.values()) clearTimeout(request.timer);
    requests.clear();
    const id = Symbol();
    navigation = { id, path };
    renderLoading();
    return () => {
        if (navigation?.id !== id) return;
        navigation = undefined;
        renderLoading();
    };
}

/** Track same-origin API work, including legacy page scripts, in one place. */
export function initialiseFetchLoading(): void {
    if (installed) return;
    installed = true;
    const fetchRequest = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = new URL(
            input instanceof Request ? input.url : String(input),
            window.location.href,
        );
        const path = window.location.pathname;
        const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : undefined),
        );
        if (headers.get("X-Cyrene-Background") === "1") return fetchRequest(input, init);
        if (
            url.origin !== window.location.origin ||
            !url.pathname.startsWith("/api/") ||
            path === "/inventory" ||
            url.pathname.startsWith("/api/inventory")
        ) {
            return fetchRequest(input, init);
        }
        const id = Symbol();
        const message =
            headers.get("X-Cyrene-Loading") === "syncing"
                ? "Syncing\u2026"
                : headers.get("X-Cyrene-Loading") === "materials" ||
                    url.pathname.endsWith("/planner-costs")
                  ? "Loading Materials\u2026"
                  : path === "/characters" && url.pathname === "/api/weapons"
                    ? "Loading Weapons\u2026"
                    : undefined;
        const activity: Activity = { path, message, visible: false };
        requests.set(id, activity);
        activity.timer = setTimeout(() => {
            if (!requests.has(id)) return;
            activity.visible = true;
            renderLoading();
        }, 200);
        try {
            return await fetchRequest(input, init);
        } finally {
            clearTimeout(activity.timer);
            requests.delete(id);
            renderLoading();
        }
    };
}
