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
        initSettings?: () => void;
        initEvents?: () => void;

        CyreneSchemas: {
            customEventSchema: typeof customEventSchema;
            customEventsListResponseSchema:
                typeof customEventsListResponseSchema;
            customEventResponseSchema:
                typeof customEventResponseSchema;
            deleteCustomEventResponseSchema:
                typeof deleteCustomEventResponseSchema;
            customEventCompletionResponseSchema:
                typeof customEventCompletionResponseSchema;
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
    const savedHoverEffects =
        localStorage.getItem("hoverEffects");

    const hoverEffectsEnabled =
        savedHoverEffects !== "false";

    document.documentElement.dataset.hoverEffects =
        hoverEffectsEnabled ? "on" : "off";
}

initialiseHoverEffects();


/* =========================================================
   2. PAGE CONFIGURATION
   ========================================================= */

const pageScripts: Record<string, string | string[]> = {
    "/characters": [
        "/static/js/characters/characters-filters.js",
        "/static/js/characters/characters-tabs.js",
        "/static/js/characters/characters-showcase.js",
        "/static/js/characters/characters-planner.js",
        "/static/js/characters/characters.js",
    ],
    "/inventory": "/static/js/inventory.js",
    "/planner": "/static/js/planner.js",
    "/verify": "/static/js/verification.js?v=2",
    "/codes": "/static/js/codes.js",

    "/events": [
        "/static/js/events/events-dropdown.js",
        "/static/js/events/events-tabs.js",
        "/static/js/events/events-cards.js",
        "/static/js/events/events-timers.js",
        "/static/js/events/events-activity.js",
        "/static/js/events/events-refresh.js",
        "/static/js/events/events-custom.js",
        "/static/js/events/events.js",
    ],

    "/settings": "/static/js/settings.js?v=4",
};

const pageStyles: Record<string, string> = {
    "/characters": "/static/css/characters/characters.css",
    "/inventory": "/static/css/inventory.css",
    "/planner": "/static/css/planner.css",
    "/verify": "/static/css/verification.css?v=2",
    "/codes": "/static/css/codes.css",
    "/events": "/static/css/events/events.css",
    "/settings": "/static/css/settings.css?v=4",
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
        const absoluteSrc = new URL(
            scriptSrc,
            window.location.origin,
        ).href;

        const existingScript = Array.from(
            document.querySelectorAll<HTMLScriptElement>(
                "script[src]",
            ),
        ).find(script => script.src === absoluteSrc);

        // Page scripts remain loaded during SPA navigation.
        if (existingScript) {
            continue;
        }

        const script = document.createElement("script");

        script.src = scriptSrc;
        script.dataset.pageScript = path;
        script.dataset.scriptSrc = scriptSrc;

        await new Promise<void>((resolve, reject) => {
            script.addEventListener(
                "load",
                () => resolve(),
                { once: true },
            );

            script.addEventListener(
                "error",
                () => reject(
                    new Error(
                        `Failed to load page script: ${scriptSrc}`,
                    ),
                ),
                { once: true },
            );

            document.body.appendChild(script);
        });
    }
}


/* =========================================================
   4. PAGE STYLE LOADER
   ========================================================= */

function loadPageStyle(path: string): void {
    const styleHref = pageStyles[path];

    if (!styleHref) {
        return;
    }

    const absoluteHref = new URL(
        styleHref,
        window.location.origin,
    ).href;

    // Reuse any stylesheet already present in the document.
    const existingStyle = Array.from(
        document.querySelectorAll<HTMLLinkElement>(
            'link[rel="stylesheet"]',
        ),
    ).find(link => link.href === absoluteHref);

    if (existingStyle) {
        return;
    }

    const link = document.createElement("link");

    link.rel = "stylesheet";
    link.href = styleHref;
    link.dataset.pageStyle = path;

    document.head.appendChild(link);
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

        case "/settings":
            window.initSettings?.();
            break;

        case "/events":
            window.initEvents?.();
            break;
    }
}

async function preparePage(path: string): Promise<void> {
    loadPageStyle(path);

    await loadPageScript(path);

    initialisePage(path);
}


/* =========================================================
   6. ACTIVE SIDEBAR NAVIGATION
   ========================================================= */

function updateActiveNavigation(url: string | URL): void {
    const currentPath = new URL(
        url,
        window.location.origin,
    ).pathname;

    document.querySelectorAll<HTMLAnchorElement>(
        ".nav-item",
    ).forEach(item => {
        const itemPath = new URL(
            item.href,
            window.location.origin,
        ).pathname;

        item.classList.toggle(
            "active",
            itemPath === currentPath,
        );
    });
}


/* =========================================================
   7. CLIENT-SIDE NAVIGATION
   ========================================================= */

async function navigate(
    url: string | URL,
    addToHistory = true,
): Promise<void> {
    try {
        const response = await fetch(url, {
            redirect: "manual",
        });

        /*
         * Handle server-side redirects.
         */

        if (
            [301, 302, 303, 307, 308].includes(
                response.status,
            )
        ) {
            const redirectUrl =
                response.headers.get("Location");

            if (redirectUrl) {
                window.location.href = new URL(
                    redirectUrl,
                    window.location.origin,
                ).href;

                return;
            }
        }

        if (!response.ok) {
            throw new Error(
                `Navigation failed: ${response.status}`,
            );
        }

        const html = await response.text();
        const parser = new DOMParser();

        const newDocument = parser.parseFromString(
            html,
            "text/html",
        );

        const newMain = newDocument.querySelector(
            ".main-content",
        );

        if (!newMain) {
            throw new Error(
                "New page does not contain .main-content",
            );
        }

        const mainContent = document.querySelector(
            ".main-content",
        );

        if (!mainContent) {
            throw new Error(
                "Current page does not contain .main-content",
            );
        }

        /*
         * Replace the current page content.
         */

        mainContent.innerHTML = newMain.innerHTML;

        /*
         * Execute scripts included in the new content.
         */

        mainContent
            .querySelectorAll("script")
            .forEach(oldScript => {
                const newScript =
                    document.createElement("script");

                for (const attribute of oldScript.attributes) {
                    newScript.setAttribute(
                        attribute.name,
                        attribute.value,
                    );
                }

                newScript.textContent =
                    oldScript.textContent;

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

        const finalPath = new URL(
            url,
            window.location.origin,
        ).pathname;

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
   8. NAVIGATION EVENT LISTENERS
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    async () => {
        const mainContent = document.querySelector(
            ".main-content",
        );

        if (!mainContent) {
            return;
        }

        /*
         * Intercept internal navigation links.
         */

        document.addEventListener("click", event => {
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

            if (
                link.pathname === window.location.pathname &&
                link.hash
            ) {
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
    },
);


/* =========================================================
   9. MOBILE SIDEBAR
   ========================================================= */

const mobileMenuButton = document.getElementById(
    "mobile-menu-button",
);

const sidebar = document.getElementById("sidebar");

const sidebarOverlay = document.getElementById(
    "sidebar-overlay",
);

function openSidebar(): void {
    sidebar?.classList.add("open");
    sidebarOverlay?.classList.add("visible");
    mobileMenuButton?.classList.add("open");

    mobileMenuButton?.setAttribute(
        "aria-expanded",
        "true",
    );
}

function closeSidebar(): void {
    sidebar?.classList.remove("open");
    sidebarOverlay?.classList.remove("visible");
    mobileMenuButton?.classList.remove("open");

    mobileMenuButton?.setAttribute(
        "aria-expanded",
        "false",
    );
}

mobileMenuButton?.addEventListener("click", () => {
    if (sidebar?.classList.contains("open")) {
        closeSidebar();
    } else {
        openSidebar();
    }
});

sidebarOverlay?.addEventListener(
    "click",
    closeSidebar,
);

sidebar?.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", closeSidebar);
});
