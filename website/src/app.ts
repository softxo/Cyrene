import { refreshImportDate } from "./browser/core/import-dates";
import { initialiseAccountProfiles } from "./browser/core/account-profiles";
import { beginNavigationLoading, initialiseFetchLoading } from "./browser/core/loading-feedback";
import "./browser/core/toasts";
import { initialiseSiteUpdates } from "./site-updates";
import { initialiseSupport, renderSupportTranscripts } from "./browser/core/support";
import { initialiseButtonMotion } from "./browser/core/button-motion";
import { initialiseSearchControls } from "./browser/core/search-controls";
import { initialiseColourPickers } from "./browser/core/colour-pickers";
import { initialiseSelectControls } from "./browser/core/select-controls";

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
        explorationPrefetch?: { accountId: string; ok: boolean; payload: unknown };
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

const pageScripts: Record<string, string | string[]> = {
    "/": "/static/build/browser/pages/home.js?v=27",
    "/weapons": [
        "/static/build/browser/core/planner-materials.js?v=1",
        "/static/build/browser/pages/events/events-rewards.js?v=6",
        "/static/build/browser/pages/weapon-planner.js?v=15",
        "/static/build/browser/pages/weapons.js?v=27",
    ],
    "/characters": [
        "/static/build/browser/core/planner-materials.js?v=1",
        "/static/build/browser/pages/characters/characters-talents.js?v=1",
        "/static/build/browser/pages/characters/characters-filters.js?v=5",
        "/static/build/browser/pages/characters/characters-tabs.js?v=2",
        "/static/build/browser/pages/characters/characters-showcase.js?v=12",
        "/static/build/browser/pages/characters/characters-planner-data.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-render.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-picker.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-weapons.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-cards.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-costs.js?v=1",
        "/static/build/browser/pages/characters/characters-planner-progression.js?v=1",
        "/static/build/browser/pages/characters/characters-planner.js?v=42",
        "/static/build/browser/pages/characters/characters.js?v=1",
    ],
    "/achievements": "/static/build/browser/pages/achievements.js?v=11",
    "/inventory": "/static/build/browser/pages/inventory.js?v=3",
    "/exploration": "/static/build/browser/pages/exploration.js?v=18",
    "/reminders": "/static/build/browser/pages/reminders.js?v=21",
    "/verify": "/static/build/browser/pages/verification.js?v=3",
    "/codes": "/static/build/browser/pages/codes.js?v=1",

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
};

const pageStyles: Record<string, string> = {
    "/weapons": "/static/build/css/weapons.css?v=52",
    "/": "/static/build/css/home.css?v=41",
    "/achievements": "/static/build/css/achievements.css?v=16",
    "/wishes": "/static/build/css/wishes.css?v=17",
    "/characters": "/static/build/css/characters.css?v=74",
    "/inventory": "/static/build/css/inventory.css?v=9",
    "/exploration": "/static/build/css/exploration.css?v=19",
    "/reminders": "/static/build/css/reminders.css?v=26",
    "/verify": "/static/build/css/verification.css?v=19",
    "/codes": "/static/build/css/codes.css?v=7",
    "/events": "/static/build/css/events.css?v=71",
    "/settings": "/static/build/css/settings.css?v=14",
};

async function loadPageScript(path: string): Promise<void> {
    const configuredScripts = pageScripts[path];

    if (!configuredScripts) {
        return;
    }

    const scriptSources = Array.isArray(configuredScripts)
        ? configuredScripts
        : [configuredScripts];

    for (const scriptSrc of scriptSources) {
        const absoluteSrc = new URL(scriptSrc, window.location.origin).href;
        const existingScript = Array.from(
            document.querySelectorAll<HTMLScriptElement>("script[src]"),
        ).find((script) => script.src === absoluteSrc);

        if (existingScript) {
            continue;
        }

        const script = document.createElement("script");

        script.src = scriptSrc;
        script.dataset.pageScript = path;
        script.dataset.scriptSrc = scriptSrc;

        await new Promise<void>((resolve, reject) => {
            script.addEventListener("load", () => resolve(), { once: true });

            script.addEventListener(
                "error",
                () => reject(new Error(`Failed to load page script: ${scriptSrc}`)),
                { once: true },
            );

            document.body.appendChild(script);
        });
    }
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

async function navigate(url: string | URL, addToHistory = true): Promise<void> {
    navigationController?.abort();
    const controller = new AbortController();
    navigationController = controller;
    const destination = new URL(url, window.location.origin);
    updateActiveNavigation(destination);
    const finishLoading = beginNavigationLoading(destination.pathname);
    try {
        const response = await fetch(url, {
            redirect: "manual",
            signal: controller.signal,
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const redirectUrl = response.headers.get("Location");

            if (redirectUrl) {
                window.location.href = new URL(redirectUrl, window.location.origin).href;

                return;
            }
        }

        if (!response.ok) {
            throw new Error(`Navigation failed: ${response.status}`);
        }

        const html = await response.text();
        if (controller.signal.aborted) return;
        const parser = new DOMParser();
        const newDocument = parser.parseFromString(html, "text/html");
        const newMain = newDocument.querySelector(".main-content");

        if (!newMain) {
            throw new Error("New page does not contain .main-content");
        }

        const mainContent = document.querySelector(".main-content");

        if (!mainContent) {
            throw new Error("Current page does not contain .main-content");
        }

        const finalPath = new URL(url, window.location.origin).pathname;

        await loadPageStyle(finalPath, newDocument);
        if (controller.signal.aborted) return;

        window.explorationPrefetch = undefined;
        const explorationAccount =
            newMain.querySelector<HTMLElement>("[data-exploration-root]")?.dataset.accountId;
        if (finalPath === "/exploration" && explorationAccount) {
            try {
                const explorationResponse = await fetch(
                    `/api/exploration?account_id=${encodeURIComponent(explorationAccount)}`,
                    { signal: controller.signal },
                );
                const payload: unknown = await explorationResponse.json();
                if (controller.signal.aborted) return;
                window.explorationPrefetch = {
                    accountId: explorationAccount,
                    ok: explorationResponse.ok,
                    payload,
                };
            } catch {
                if (controller.signal.aborted) return;
                window.explorationPrefetch = {
                    accountId: explorationAccount,
                    ok: false,
                    payload: { error: "Couldn't retrieve exploration from HoYoLAB." },
                };
            }
        }
        if (controller.signal.aborted) return;

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

        if (addToHistory) {
            history.pushState({}, "", url);
        }

        await preparePage(finalPath, controller.signal);
        if (controller.signal.aborted) return;

        updateActiveNavigation(url);

        const hashTarget = destination.hash
            ? document.getElementById(decodeURIComponent(destination.hash.slice(1)))
            : null;

        if (hashTarget) {
            hashTarget.scrollIntoView({ behavior: "instant" });
        } else {
            window.scrollTo({
                top: 0,
                behavior: "instant",
            });
        }
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

document.addEventListener("DOMContentLoaded", async () => {
    const mainContent = document.querySelector(".main-content");

    if (!mainContent) {
        return;
    }

    document.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) {
            return;
        }

        const link = event.target.closest("a");

        if (!(link instanceof HTMLAnchorElement)) {
            return;
        }

        if (link.origin !== window.location.origin) {
            return;
        }

        if (link.hasAttribute("data-discord-oauth") || link.hasAttribute("download")) {
            return;
        }

        if (
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            event.metaKey ||
            link.target === "_blank"
        ) {
            return;
        }

        if (link.pathname === window.location.pathname && link.hash) {
            return;
        }

        event.preventDefault();

        void navigate(link.href);
    });

    window.addEventListener("popstate", () => {
        void navigate(window.location.href, false);
    });

    await preparePage(window.location.pathname);
    initialiseAccountProfiles();

    updateActiveNavigation(window.location.href);
});

const mobileMenuButton = document.getElementById("mobile-menu-button");

const sidebar = document.getElementById("sidebar");

const sidebarOverlay = document.getElementById("sidebar-overlay");

function openSidebar(): void {
    sidebar?.classList.add("open");
    sidebarOverlay?.classList.add("visible");
    mobileMenuButton?.classList.add("open");

    mobileMenuButton?.setAttribute("aria-expanded", "true");
}

function closeSidebar(): void {
    sidebar?.classList.remove("open");
    sidebarOverlay?.classList.remove("visible");
    mobileMenuButton?.classList.remove("open");

    mobileMenuButton?.setAttribute("aria-expanded", "false");
}

mobileMenuButton?.addEventListener("click", () => {
    if (sidebar?.classList.contains("open")) {
        closeSidebar();
    } else {
        openSidebar();
    }
});

sidebarOverlay?.addEventListener("click", closeSidebar);

sidebar?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeSidebar);
});

window.refreshImportDate = refreshImportDate;
