type Activity = {
    path: string;
    message?: string;
    visible: boolean;
    timer?: ReturnType<typeof setTimeout>;
};
const requests = new Map<symbol, Activity>();
let navigation: { id: symbol; path: string } | undefined;
let installed = false;
let loadingSizeObserver: ResizeObserver | undefined;

const labels: Record<string, string> = {
    "/": "Home",
    "/characters": "Characters",
    "/events": "Events",
    "/exploration": "Exploration",
    "/weapons": "Weapons",
    "/wishes": "Wishes",
    "/achievements": "Achievements",
    "/reminders": "Reminders",
    "/settings": "Settings",
    "/codes": "Gift Codes",
    "/verify": "Verification",
    "/inventory": "Inventory",
    "/docs": "Docs",
    "/uploads": "Uploads",
    "/journey-map": "Journey Map",
};

const SLOW_STATUS_DELAY = 1000;
let pendingStatus: { key: string; timer: ReturnType<typeof setTimeout> } | undefined;

function labelFor(path: string): string {
    return labels[path] || (path.startsWith("/docs/") ? labels["/docs"] : "page");
}

function clearPendingStatus(): void {
    clearTimeout(pendingStatus?.timer);
    pendingStatus = undefined;
}

let progress: HTMLElement | undefined;
let progressActive = false;
let progressTimer: ReturnType<typeof setTimeout> | undefined;

function progressBar(): HTMLElement {
    if (!progress?.isConnected) {
        progress = document.createElement("div");
        progress.id = "navigation-progress";
        progress.setAttribute("aria-hidden", "true");
        document.body.append(progress);
    }

    return progress;
}

function startProgress(): void {
    if (progressActive) return;

    progressActive = true;
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
        const bar = progressBar();
        bar.className = "";
        void bar.offsetWidth;
        bar.className = "is-running";
    }, 120);
}

function finishProgress(): void {
    if (!progressActive) return;

    progressActive = false;
    clearTimeout(progressTimer);
    const bar = progress;

    if (!bar?.classList.contains("is-running")) return;

    bar.className = "is-done";
    progressTimer = setTimeout(() => {
        bar.className = "";
    }, 600);
}

function renderLoading(): void {
    const activity = [...requests.values()]
        .reverse()
        .filter((request) => request.visible && request.path === window.location.pathname);
    const current = activity.find((request) => request.message) ?? activity[0];
    const path = navigation?.path ?? current?.path;
    const show = path !== undefined && path !== "/inventory";

    if (show) startProgress();
    else finishProgress();

    document.querySelector(".main-content")?.toggleAttribute("aria-busy", show);

    if (show) document.querySelector(".main-content")?.setAttribute("aria-busy", "true");

    const existing = document.getElementById("navigation-loading-status");

    if (!show) {
        clearPendingStatus();
        existing?.remove();
        loadingSizeObserver?.disconnect();
        document.body.style.removeProperty("--cyrene-feedback-top");

        return;
    }

    const customMessage = !navigation ? current?.message : undefined;
    const message = customMessage || `Loading ${labelFor(path)}\u2026`;
    const key = `${path}\n${message}`;

    if (existing?.dataset.path === path && existing?.dataset.message === message) return;

    if (pendingStatus?.key === key) return;

    clearPendingStatus();
    existing?.remove();
    loadingSizeObserver?.disconnect();
    document.body.style.removeProperty("--cyrene-feedback-top");

    if (customMessage) {
        showStatus(path, message);

        return;
    }

    pendingStatus = {
        key,
        timer: setTimeout(() => {
            pendingStatus = undefined;
            showStatus(path, message);
        }, SLOW_STATUS_DELAY),
    };
}

function showStatus(path: string, message: string): void {
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
    const positionFeedback = () =>
        document.body.style.setProperty(
            "--cyrene-feedback-top",
            `${status.getBoundingClientRect().bottom + 12}px`,
        );
    positionFeedback();
    loadingSizeObserver = new ResizeObserver(positionFeedback);
    loadingSizeObserver.observe(status);
}

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

function loadingMessage(headers: Headers, url: URL, path: string): string | undefined {
    const loadingKind = headers.get("X-Cyrene-Loading");

    if (loadingKind === "syncing") return "Syncing\u2026";

    if (loadingKind === "materials" || url.pathname.endsWith("/planner-costs")) {
        return "Loading Materials\u2026";
    }

    if (path === "/characters" && url.pathname === "/api/weapons") return "Loading Weapons\u2026";

    return undefined;
}

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
        const message = loadingMessage(headers, url, path);
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
