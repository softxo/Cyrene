import { refreshImportDate } from "./browser/core/import-dates";
import {
    applyWithoutTransition,
    captureLoadedImages,
    morphChildren,
    renderInPlace,
    revealContent,
} from "./browser/core/smooth-updates";
import { initialiseAccountProfiles } from "./browser/core/account-profiles";
import { beginNavigationLoading, initialiseFetchLoading } from "./browser/core/loading-feedback";
import "./browser/core/toasts";
import { initialiseSiteUpdates } from "./site-updates";
import { initialiseSupport, renderSupportTranscripts } from "./browser/core/support";
import { initialiseButtonMotion } from "./browser/core/button-motion";
import { initialiseSearchControls } from "./browser/core/search-controls";
import { initialiseColourPickers } from "./browser/core/colour-pickers";
import { initialiseSelectControls } from "./browser/core/select-controls";
import { initialiseTermsGate } from "./browser/core/terms-gate";

import {
    customEventSchema,
    customEventsListResponseSchema,
    customEventResponseSchema,
    deleteCustomEventResponseSchema,
    customEventCompletionResponseSchema,
} from "./schemas/events";

export {};

declare global {
    interface Window {
        initHome?: () => void;
        disposeHome?: () => void;
        initWeapons?: () => void;
        disposeWeapons?: () => void;
        initCharacters?: () => void;
        initInventory?: () => void;
        initExploration?: () => void;
        explorationPrefetch?: {
            accountId: string;
            result: Promise<{ ok: boolean; payload: unknown }>;
        };
        beginExplorationLoading?: () => () => void;
        initReminders?: () => void;
        initVerify?: () => void;
        disposeVerify?: () => void;
        initAchievements?: () => void;
        initCodes?: () => void;
        initSettings?: () => void;
        initEvents?: () => void;
        initDocs?: () => void;
        initUploads?: () => void;
        initJourneyMap?: () => void;

        CyreneSchemas: {
            customEventSchema: typeof customEventSchema;
            customEventsListResponseSchema: typeof customEventsListResponseSchema;
            customEventResponseSchema: typeof customEventResponseSchema;
            deleteCustomEventResponseSchema: typeof deleteCustomEventResponseSchema;
            customEventCompletionResponseSchema: typeof customEventCompletionResponseSchema;
        };
    }
}

window.CyreneSchemas = {
    customEventSchema,
    customEventsListResponseSchema,
    customEventResponseSchema,
    deleteCustomEventResponseSchema,
    customEventCompletionResponseSchema,
};
window.beginExplorationLoading = () => beginNavigationLoading("/exploration");

function initialiseHoverEffects(): void {
    const savedHoverEffects = localStorage.getItem("hoverEffects");
    const hoverEffectsEnabled = savedHoverEffects !== "false";

    document.documentElement.dataset.hoverEffects = hoverEffectsEnabled ? "on" : "off";
}

initialiseFetchLoading();
initialiseHoverEffects();
initialiseButtonMotion();
initialiseSearchControls();
initialiseSelectControls();
initialiseColourPickers();
initialiseSiteUpdates();
initialiseSupport();
initialiseTermsGate();

const pageScripts: Record<string, string | string[]> = {
    "/": "/static/build/browser/pages/home.js?v=28",
    "/weapons": [
        "/static/build/browser/core/planner-materials.js?v=1",
        "/static/build/browser/pages/events/events-rewards.js?v=6",
        "/static/build/browser/pages/weapon-planner.js?v=16",
        "/static/build/browser/pages/weapons.js?v=29",
    ],
    "/characters": [
        "/static/build/browser/core/planner-materials.js?v=1",
        "/static/build/browser/pages/characters/characters-talents.js?v=1",
        "/static/build/browser/pages/characters/characters-filters.js?v=5",
        "/static/build/browser/pages/characters/characters-tabs.js?v=2",
        "/static/build/browser/pages/characters/characters-showcase.js?v=14",
        "/static/build/browser/pages/characters/characters-planner-data.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-render.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-picker.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-weapons.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-cards.js?v=2",
        "/static/build/browser/pages/characters/characters-planner-costs.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-progression.js?v=1",
        "/static/build/browser/pages/characters/characters-planner.js?v=42",
        "/static/build/browser/pages/characters/characters.js?v=2",
    ],
    "/achievements": "/static/build/browser/pages/achievements.js?v=15",
    "/inventory": "/static/build/browser/pages/inventory.js?v=4",
    "/exploration": "/static/build/browser/pages/exploration.js?v=20",
    "/reminders": "/static/build/browser/pages/reminders.js?v=23",
    "/verify": "/static/build/browser/pages/verification.js?v=3",
    "/codes": "/static/build/browser/pages/codes.js?v=2",

    "/events": [
        "/static/build/browser/pages/events/events-dropdown.js?v=2",
        "/static/build/browser/pages/events/events-tabs.js?v=2",
        "/static/build/browser/pages/events/events-cards.js",
        "/static/build/browser/pages/events/events-rewards.js?v=6",
        "/static/build/browser/pages/events/events-filters.js?v=11",
        "/static/build/browser/pages/events/events-timers.js?v=10",
        "/static/build/browser/pages/events/events-activity.js?v=13",
        "/static/build/browser/pages/events/events-refresh.js?v=9",
        "/static/build/browser/pages/events/events-custom-controls.js?v=1",
        "/static/build/browser/pages/events/events-custom-dropdowns.js?v=1",
        "/static/build/browser/pages/events/events-custom-form.js?v=1",
        "/static/build/browser/pages/events/events-custom-order.js?v=1",
        "/static/build/browser/pages/events/events-custom-progress.js?v=1",
        "/static/build/browser/pages/events/events-custom-cards.js?v=1",
        "/static/build/browser/pages/events/events-custom-overview.js?v=1",
        "/static/build/browser/pages/events/events-custom.js?v=20",
        "/static/build/browser/pages/events/events.js?v=1",
    ],

    "/settings": "/static/build/browser/pages/settings.js?v=17",
    "/docs": "/static/build/browser/pages/docs.js?v=1",
    "/uploads": "/static/build/browser/pages/uploads.js?v=1",
    "/journey-map": "/static/build/browser/pages/journey-map.js?v=7",
};

const pageStyles: Record<string, string> = {
    "/weapons": "/static/build/css/weapons.css?v=54",
    "/": "/static/build/css/home.css?v=44",
    "/achievements": "/static/build/css/achievements.css?v=22",
    "/wishes": "/static/build/css/wishes.css?v=22",
    "/characters": "/static/build/css/characters.css?v=77",
    "/inventory": "/static/build/css/inventory.css?v=11",
    "/exploration": "/static/build/css/exploration.css?v=21",
    "/reminders": "/static/build/css/reminders.css?v=28",
    "/verify": "/static/build/css/verification.css?v=20",
    "/codes": "/static/build/css/codes.css?v=9",
    "/events": "/static/build/css/events.css?v=73",
    "/settings": "/static/build/css/settings.css?v=15",
    "/journey-map": "/static/build/css/journey-map.css?v=13",
};

async function loadPageScript(path: string): Promise<void> {
    const configuredScripts = pageScripts[path];

    if (!configuredScripts) {
        return;
    }

    const scriptSources = Array.isArray(configuredScripts)
        ? configuredScripts
        : [configuredScripts];
    const loadedSources = new Set(
        Array.from(
            document.querySelectorAll<HTMLScriptElement>("script[src]"),
            (script) => script.src,
        ),
    );
    const pending: Promise<void>[] = [];

    for (const scriptSrc of scriptSources) {
        const absoluteSrc = new URL(scriptSrc, window.location.origin).href;

        if (loadedSources.has(absoluteSrc)) {
            continue;
        }

        const script = document.createElement("script");

        script.src = scriptSrc;
        script.async = false;
        script.dataset.pageScript = path;
        script.dataset.scriptSrc = scriptSrc;

        pending.push(
            new Promise<void>((resolve, reject) => {
                script.addEventListener("load", () => resolve(), { once: true });

                script.addEventListener(
                    "error",
                    () => reject(new Error(`Failed to load page script: ${scriptSrc}`)),
                    { once: true },
                );
            }),
        );

        document.body.appendChild(script);
    }

    await Promise.all(pending);
}

async function loadPageStyle(path: string, serverDocument?: Document): Promise<void> {
    const serverStyle = serverDocument?.querySelector<HTMLLinkElement>(
        `link[data-page-style="${path}"]`,
    );

    if (serverStyle?.getAttribute("href")) {
        pageStyles[path] = serverStyle.getAttribute("href")!;
    }

    const styleHref = pageStyles[path];

    if (!styleHref) {
        return;
    }

    const absoluteHref = new URL(styleHref, window.location.origin).href;
    const existingStyle = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ).find((link) => link.href === absoluteHref);

    if (existingStyle) {
        return;
    }

    const link = document.createElement("link");

    link.rel = "stylesheet";
    link.href = styleHref;
    link.dataset.pageStyle = path;

    await new Promise<void>((resolve, reject) => {
        link.addEventListener("load", () => resolve(), { once: true });
        link.addEventListener(
            "error",
            () => reject(new Error(`Failed to load page style: ${styleHref}`)),
            { once: true },
        );

        document.head.appendChild(link);
    });
}

function initialisePage(path: string): void {
    if (document.querySelector("[data-no-accounts]")) return;

    switch (path) {
        case "/":
            window.initHome?.();
            break;
        case "/weapons":
            window.initWeapons?.();
            break;
        case "/characters":
            window.initCharacters?.();
            break;

        case "/exploration":
            window.initExploration?.();
            break;

        case "/inventory":
            window.initInventory?.();
            break;

        case "/reminders":
            window.initReminders?.();
            break;

        case "/verify":
            window.initVerify?.();
            break;

        case "/achievements":
            window.initAchievements?.();
            break;

        case "/codes":
            window.initCodes?.();
            break;

        case "/settings":
            window.initSettings?.();
            break;

        case "/events":
            window.initEvents?.();
            break;

        case "/docs":
            window.initDocs?.();
            break;

        case "/uploads":
            window.initUploads?.();
            break;

        case "/journey-map":
            window.initJourneyMap?.();
            break;
    }
}

async function preparePage(path: string, signal?: AbortSignal): Promise<void> {
    await loadPageStyle(path);

    if (path.startsWith("/support/")) renderSupportTranscripts();

    if (document.querySelector("[data-no-accounts]")) return;

    const scriptPath = path.startsWith("/docs/") ? "/docs" : path;

    await loadPageScript(scriptPath);

    if (!signal?.aborted) initialisePage(scriptPath);
}

function updateActiveNavigation(url: string | URL): void {
    const currentPath = new URL(url, window.location.origin).pathname;

    document.querySelectorAll<HTMLAnchorElement>(".nav-item").forEach((item) => {
        const itemPath = new URL(item.href, window.location.origin).pathname;

        item.classList.toggle(
            "active",
            itemPath === currentPath || (itemPath === "/docs" && currentPath.startsWith("/docs/")),
        );
    });
}

let navigationController: AbortController | undefined;

type PageResponse = {
    ok: boolean;
    status: number;
    location: string | null;
    html: string;
};

const PREFETCH_TTL = 5000;
const PREFETCH_HOVER_DELAY = 80;
const prefetchedPages = new Map<string, { at: number; page: Promise<PageResponse> }>();
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
let scrollSaveTimer: ReturnType<typeof setTimeout> | undefined;

function pageKey(url: string | URL): string {
    const key = new URL(url, window.location.origin);
    key.hash = "";

    return key.href;
}

async function requestPage(url: string, signal?: AbortSignal): Promise<PageResponse> {
    const response = await fetch(url, { redirect: "manual", signal });

    return {
        ok: response.ok,
        status: response.status,
        location: response.headers.get("Location"),
        html: response.ok ? await response.text() : "",
    };
}

function takePrefetchedPage(url: string): Promise<PageResponse> | undefined {
    const key = pageKey(url);
    const entry = prefetchedPages.get(key);
    prefetchedPages.delete(key);

    return entry && Date.now() - entry.at < PREFETCH_TTL ? entry.page : undefined;
}

function prefetchPage(url: string): void {
    const key = pageKey(url);
    const existing = prefetchedPages.get(key);

    if (existing && Date.now() - existing.at < PREFETCH_TTL) {
        return;
    }

    const page = requestPage(key);
    page.catch(() => {
        if (prefetchedPages.get(key)?.page === page) prefetchedPages.delete(key);
    });
    prefetchedPages.set(key, { at: Date.now(), page });
}

function navigableLink(target: EventTarget | null): HTMLAnchorElement | undefined {
    if (!(target instanceof Element)) {
        return undefined;
    }

    const link = target.closest("a");

    if (
        !(link instanceof HTMLAnchorElement) ||
        link.origin !== window.location.origin ||
        link.hasAttribute("data-discord-oauth") ||
        link.hasAttribute("download") ||
        link.target === "_blank"
    ) {
        return undefined;
    }

    return link;
}

function prefetchableLink(target: EventTarget | null): HTMLAnchorElement | undefined {
    const link = navigableLink(target);

    if (
        !link ||
        !(Object.hasOwn(pageScripts, link.pathname) || link.pathname.startsWith("/docs/")) ||
        pageKey(link.href) === pageKey(window.location.href)
    ) {
        return undefined;
    }

    return link;
}

function saveScrollPosition(): void {
    clearTimeout(scrollSaveTimer);
    history.replaceState({ ...(history.state ?? {}), scrollY: window.scrollY }, "");
}

function savedScrollPosition(): number | undefined {
    const scrollY: unknown = history.state?.scrollY;

    return typeof scrollY === "number" ? scrollY : undefined;
}

function focusPageHeading(mainContent: Element): void {
    const active = document.activeElement;

    if (active && active !== document.body && !active.closest(".sidebar, .main-content")) {
        return;
    }

    const heading = mainContent.querySelector<HTMLElement>("h1");

    if (!heading) {
        return;
    }

    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
}

function animatePageEntrance(mainContent: Element): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    mainContent.querySelector(".site-content")?.animate(
        [
            { opacity: 0, transform: "translateY(6px)" },
            { opacity: 1, transform: "none" },
        ],
        { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
}

async function navigate(
    url: string | URL,
    addToHistory = true,
    restoreScroll?: number,
): Promise<void> {
    navigationController?.abort();
    const controller = new AbortController();
    navigationController = controller;
    clearTimeout(scrollSaveTimer);

    if (addToHistory) saveScrollPosition();

    const destination = new URL(url, window.location.origin);
    updateActiveNavigation(destination);
    const finishLoading = beginNavigationLoading(destination.pathname);

    try {
        const response = await (takePrefetchedPage(destination.href) ??
            requestPage(destination.href, controller.signal));

        if (controller.signal.aborted) return;

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const redirectUrl = response.location;

            if (redirectUrl) {
                window.location.href = new URL(redirectUrl, window.location.origin).href;

                return;
            }
        }

        if (!response.ok) {
            throw new Error(`Navigation failed: ${response.status}`);
        }

        const parser = new DOMParser();
        const newDocument = parser.parseFromString(response.html, "text/html");
        const newMain = newDocument.querySelector(".main-content");

        if (!newMain) {
            throw new Error("New page does not contain .main-content");
        }

        const mainContent = document.querySelector(".main-content");

        if (!mainContent) {
            throw new Error("Current page does not contain .main-content");
        }

        const finalPath = destination.pathname;

        await loadPageStyle(finalPath, newDocument);

        if (controller.signal.aborted) return;

        window.explorationPrefetch = undefined;
        const explorationAccount =
            newMain.querySelector<HTMLElement>("[data-exploration-root]")?.dataset.accountId;

        if (finalPath === "/exploration" && explorationAccount) {
            window.explorationPrefetch = {
                accountId: explorationAccount,
                result: fetch(
                    `/api/exploration?account_id=${encodeURIComponent(explorationAccount)}`,
                    { signal: controller.signal },
                )
                    .then(async (explorationResponse) => ({
                        ok: explorationResponse.ok,
                        payload: (await explorationResponse.json()) as unknown,
                    }))
                    .catch(() => ({
                        ok: false,
                        payload: { error: "Couldn't retrieve exploration from HoYoLAB." },
                    })),
            };
        }

        window.disposeVerify?.();
        window.disposeHome?.();
        window.disposeWeapons?.();
        mainContent.innerHTML = newMain.innerHTML;

        mainContent.querySelectorAll("script").forEach((oldScript) => {
            const newScript = document.createElement("script");

            for (const attribute of oldScript.attributes) {
                newScript.setAttribute(attribute.name, attribute.value);
            }

            newScript.textContent = oldScript.textContent;

            oldScript.replaceWith(newScript);
        });

        if (newDocument.title) {
            document.title = newDocument.title;
        }

        if (addToHistory) {
            history.pushState({}, "", url);
        }

        window.scrollTo({ top: restoreScroll ?? 0, behavior: "instant" });
        animatePageEntrance(mainContent);

        await preparePage(finalPath, controller.signal);

        if (controller.signal.aborted) return;

        updateActiveNavigation(url);

        const hashTarget =
            restoreScroll === undefined && destination.hash
                ? document.getElementById(decodeURIComponent(destination.hash.slice(1)))
                : null;

        if (restoreScroll !== undefined) {
            window.scrollTo({ top: restoreScroll, behavior: "instant" });
        } else if (hashTarget) {
            hashTarget.scrollIntoView({ behavior: "instant" });
        }

        focusPageHeading(mainContent);
    } catch (error) {
        if (controller.signal.aborted) return;

        console.error("Navigation error:", error);

        window.location.href = url.toString();
    } finally {
        if (navigationController === controller) {
            finishLoading();
        }
    }
}

if ("scrollRestoration" in history) {
    history.scrollRestoration = "manual";
}

document.addEventListener("DOMContentLoaded", async () => {
    const mainContent = document.querySelector(".main-content");

    if (!mainContent) {
        return;
    }

    document.addEventListener("click", (event) => {
        const link = navigableLink(event.target);

        if (!link) {
            if (event.target instanceof Element && event.target.closest("button")) {
                prefetchedPages.clear();
            }

            return;
        }

        if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
            return;
        }

        if (link.pathname === window.location.pathname && link.hash) {
            return;
        }

        event.preventDefault();

        void navigate(link.href);
    });

    document.addEventListener("submit", () => prefetchedPages.clear(), true);

    document.addEventListener("pointerover", (event) => {
        const link = prefetchableLink(event.target);

        if (!link) {
            return;
        }

        clearTimeout(prefetchTimer);
        prefetchTimer = setTimeout(() => prefetchPage(link.href), PREFETCH_HOVER_DELAY);
    });

    document.addEventListener("pointerout", (event) => {
        const link = prefetchableLink(event.target);

        if (link && !(event.relatedTarget instanceof Node && link.contains(event.relatedTarget))) {
            clearTimeout(prefetchTimer);
        }
    });

    document.addEventListener("pointerdown", (event) => {
        const link = prefetchableLink(event.target);

        if (link && event.button === 0) {
            clearTimeout(prefetchTimer);
            prefetchPage(link.href);
        }
    });

    document.addEventListener("focusin", (event) => {
        const link = prefetchableLink(event.target);

        if (link) {
            prefetchPage(link.href);
        }
    });

    window.addEventListener(
        "scroll",
        () => {
            clearTimeout(scrollSaveTimer);
            scrollSaveTimer = setTimeout(saveScrollPosition, 150);
        },
        { passive: true },
    );

    window.addEventListener("popstate", () => {
        void navigate(window.location.href, false, savedScrollPosition() ?? 0);
    });

    const initialScroll = window.location.hash ? undefined : savedScrollPosition();

    if (initialScroll !== undefined) {
        window.scrollTo({ top: initialScroll, behavior: "instant" });
    }

    await preparePage(window.location.pathname);
    initialiseAccountProfiles();

    updateActiveNavigation(window.location.href);

    if (initialScroll !== undefined) {
        window.scrollTo({ top: initialScroll, behavior: "instant" });
    }
});

const mobileMenuButton = document.getElementById("mobile-menu-button");

const sidebar = document.getElementById("sidebar");

const sidebarOverlay = document.getElementById("sidebar-overlay");

const mobileNavigationQuery = window.matchMedia("(max-width: 1000px)");

function setSidebarBackgroundInert(inert: boolean): void {
    document.documentElement.classList.toggle("sidebar-locked", inert);
    document.querySelector<HTMLElement>(".main-content")?.toggleAttribute("inert", inert);
}

function openSidebar(): void {
    sidebar?.classList.add("open");
    sidebarOverlay?.classList.add("visible");
    mobileMenuButton?.classList.add("open");

    mobileMenuButton?.setAttribute("aria-expanded", "true");
    setSidebarBackgroundInert(true);
    sidebar
        ?.querySelector<HTMLElement>(".nav-item.active, .nav-item")
        ?.focus({ preventScroll: true });
}

function closeSidebar(restoreFocus = false): void {
    const wasOpen = sidebar?.classList.contains("open") ?? false;
    sidebar?.classList.remove("open");
    sidebarOverlay?.classList.remove("visible");
    mobileMenuButton?.classList.remove("open");

    mobileMenuButton?.setAttribute("aria-expanded", "false");
    setSidebarBackgroundInert(false);

    if (wasOpen && restoreFocus) {
        mobileMenuButton?.focus({ preventScroll: true });
    }
}

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebar?.classList.contains("open")) {
        closeSidebar(true);
    }
});

mobileNavigationQuery.addEventListener("change", (event) => {
    if (!event.matches) closeSidebar();
});

mobileMenuButton?.addEventListener("click", () => {
    if (sidebar?.classList.contains("open")) {
        closeSidebar(true);
    } else {
        openSidebar();
    }
});

sidebarOverlay?.addEventListener("click", () => closeSidebar(true));

sidebar?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => closeSidebar());
});

window.refreshImportDate = refreshImportDate;
window.morphChildren = morphChildren;
window.renderInPlace = renderInPlace;
window.applyWithoutTransition = applyWithoutTransition;
window.revealContent = revealContent;
window.captureLoadedImages = captureLoadedImages;
