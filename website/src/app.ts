/**
 * Cyrene frontend entry point.
 *
 * Handles:
 * 1. Hover effects
 * 2. Client-side navigation
 * 3. Page-specific scripts and styles
 * 4. Page initialisation
 * 5. Browser history
 * 6. Mobile sidebar
 */

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
        initCharacters?: () => void;
        initInventory?: () => void;
        initPlanner?: () => void;
        initVerify?: () => void;
        initAchievements?: () => void;
        initCodes?: () => void;
        initSettings?: () => void;
        initEvents?: () => void;

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

/* =========================================================
   1. HOVER EFFECTS
   ========================================================= */

function initialiseHoverEffects(): void {
    const savedHoverEffects = localStorage.getItem("hoverEffects");

    const hoverEffectsEnabled = savedHoverEffects !== "false";

    document.documentElement.dataset.hoverEffects = hoverEffectsEnabled ? "on" : "off";
}

initialiseHoverEffects();

/* =========================================================
   2. PAGE CONFIGURATION
   ========================================================= */

const pageScripts: Record<string, string | string[]> = {
    "/characters": [
        "/static/build/browser/pages/characters/characters-talents.js?v=1",
        "/static/build/browser/pages/characters/characters-filters.js",
        "/static/build/browser/pages/characters/characters-tabs.js?v=2",
        "/static/build/browser/pages/characters/characters-showcase.js?v=6",
        "/static/build/browser/pages/characters/characters-planner.js?v=9",
        "/static/build/browser/pages/characters/characters.js",
    ],
    "/achievements": "/static/build/browser/pages/achievements.js?v=2",
    "/inventory": "/static/build/browser/pages/inventory.js",
    "/planner": "/static/build/browser/pages/planner.js",
    "/verify": "/static/build/browser/pages/verification.js",
    "/codes": "/static/build/browser/pages/codes.js",

    "/events": [
        "/static/build/browser/pages/events/events-dropdown.js",
        "/static/build/browser/pages/events/events-tabs.js",
        "/static/build/browser/pages/events/events-cards.js",
        "/static/build/browser/pages/events/events-timers.js",
        "/static/build/browser/pages/events/events-activity.js",
        "/static/build/browser/pages/events/events-refresh.js",
        "/static/build/browser/pages/events/events-custom.js",
        "/static/build/browser/pages/events/events.js",
    ],

    "/settings": "/static/build/browser/pages/settings.js?v=3",
};

const pageStyles: Record<string, string> = {
    "/": "/static/build/css/home.css?v=4",
    "/achievements": "/static/build/css/achievements.css?v=3",
    "/wishes": "/static/build/css/wishes.css?v=10",
    "/characters": "/static/build/css/characters.css?v=37",
    "/inventory": "/static/build/css/inventory.css?v=3",
    "/planner": "/static/build/css/planner.css?v=2",
    "/verify": "/static/build/css/verification.css?v=2",
    "/codes": "/static/build/css/codes.css?v=2",
    "/events": "/static/build/css/events.css?v=4",
    "/settings": "/static/build/css/settings.css?v=3",
};

/* =========================================================
   3. PAGE SCRIPT LOADER
   ========================================================= */

async function loadPageScript(path: string): Promise<void> {
    const configuredScripts = pageScripts[path];

    if (!configuredScripts) {
        return;
    }

    // Support both single-file and multi-file pages.
    const scriptSources = Array.isArray(configuredScripts)
        ? configuredScripts
        : [configuredScripts];

    // Preserve script dependencies by loading sequentially.
    for (const scriptSrc of scriptSources) {
        const absoluteSrc = new URL(scriptSrc, window.location.origin).href;

        const existingScript = Array.from(
            document.querySelectorAll<HTMLScriptElement>("script[src]"),
        ).find((script) => script.src === absoluteSrc);

        // Page scripts remain loaded during SPA navigation.
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

/* =========================================================
   4. PAGE STYLE LOADER
   ========================================================= */

async function loadPageStyle(path: string): Promise<void> {
    const styleHref = pageStyles[path];

    if (!styleHref) {
        return;
    }

    const absoluteHref = new URL(styleHref, window.location.origin).href;

    // Reuse any stylesheet already present in the document.
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

/* =========================================================
   5. PAGE INITIALISATION
   ========================================================= */

function initialisePage(path: string): void {
    switch (path) {
        case "/characters":
            window.initCharacters?.();
            break;

        case "/inventory":
            window.initInventory?.();
            break;

        case "/planner":
            window.initPlanner?.();
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
    }
}

async function preparePage(path: string): Promise<void> {
    await loadPageStyle(path);

    await loadPageScript(path);

    initialisePage(path);
}

/* =========================================================
   6. CUSTOM SELECT SAFETY NET
   ========================================================= */

function initialiseCustomSelectFallback(): void {
    document.addEventListener(
        "click",
        (event) => {
            if (!(event.target instanceof Element)) {
                return;
            }

            const button = event.target.closest<HTMLButtonElement>(".custom-select-button");

            const select = button?.closest<HTMLElement>(".custom-select");

            if (!button || !select || button.disabled) {
                return;
            }

            const wasOpen = select.classList.contains("open");
            const previousExpanded = button.getAttribute("aria-expanded");

            // Page-specific handlers run first. Only step in when a freshly
            // inserted SPA control has not been initialised by its page module.
            window.setTimeout(() => {
                const handled =
                    select.classList.contains("open") !== wasOpen ||
                    button.getAttribute("aria-expanded") !== previousExpanded;

                if (handled || !select.isConnected) {
                    return;
                }

                document
                    .querySelectorAll<HTMLElement>(".custom-select.open")
                    .forEach((otherSelect) => {
                        if (otherSelect === select) {
                            return;
                        }

                        otherSelect.classList.remove("open");
                        otherSelect
                            .querySelector(".custom-select-button")
                            ?.setAttribute("aria-expanded", "false");
                    });

                select.classList.toggle("open", !wasOpen);
                button.setAttribute("aria-expanded", String(!wasOpen));
            }, 0);
        },
        true,
    );
}

/* =========================================================
   7. ACTIVE SIDEBAR NAVIGATION
   ========================================================= */

function updateActiveNavigation(url: string | URL): void {
    const currentPath = new URL(url, window.location.origin).pathname;

    document.querySelectorAll<HTMLAnchorElement>(".nav-item").forEach((item) => {
        const itemPath = new URL(item.href, window.location.origin).pathname;

        item.classList.toggle("active", itemPath === currentPath);
    });
}

/* =========================================================
   8. CLIENT-SIDE NAVIGATION
   ========================================================= */

async function navigate(url: string | URL, addToHistory = true): Promise<void> {
    try {
        const response = await fetch(url, {
            redirect: "manual",
        });

        /*
         * Handle server-side redirects.
         */

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

        // Keep the current page visible until the destination stylesheet is
        // ready, preventing an unstyled frame during client-side navigation.
        await loadPageStyle(finalPath);

        /*
         * Replace the current page content.
         */

        mainContent.innerHTML = newMain.innerHTML;

        /*
         * Execute scripts included in the new content.
         */

        mainContent.querySelectorAll("script").forEach((oldScript) => {
            const newScript = document.createElement("script");

            for (const attribute of oldScript.attributes) {
                newScript.setAttribute(attribute.name, attribute.value);
            }

            newScript.textContent = oldScript.textContent;

            oldScript.replaceWith(newScript);
        });

        /*
         * Update browser history.
         */

        if (addToHistory) {
            history.pushState({}, "", url);
        }

        /*
         * Load assets and initialise the destination page.
         */

        await preparePage(finalPath);

        /*
         * Update the active sidebar item.
         */

        updateActiveNavigation(url);

        /*
         * Scroll to the top.
         */

        window.scrollTo({
            top: 0,
            behavior: "instant",
        });
    } catch (error) {
        console.error("Navigation error:", error);

        window.location.href = url.toString();
    }
}

/* =========================================================
   9. NAVIGATION EVENT LISTENERS
   ========================================================= */

document.addEventListener("DOMContentLoaded", async () => {
    const mainContent = document.querySelector(".main-content");

    if (!mainContent) {
        return;
    }

    initialiseCustomSelectFallback();

    /*
     * Intercept internal navigation links.
     */

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

    /*
     * Support browser Back and Forward navigation.
     */

    window.addEventListener("popstate", () => {
        void navigate(window.location.href, false);
    });

    /*
     * Initialise the page loaded by the server.
     */

    await preparePage(window.location.pathname);

    updateActiveNavigation(window.location.href);
});

/* =========================================================
   10. MOBILE SIDEBAR
   ========================================================= */

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
