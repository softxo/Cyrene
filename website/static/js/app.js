function initialiseHoverEffects() {

    const savedHoverEffects =
        localStorage.getItem("hoverEffects");

    const hoverEffectsEnabled =
        savedHoverEffects !== "false";

    document.documentElement.dataset.hoverEffects =
        hoverEffectsEnabled
            ? "on"
            : "off";
}

initialiseHoverEffects();

document.addEventListener("DOMContentLoaded", async () => {

    const mainContent = document.querySelector(".main-content");

    if (!mainContent) {
        return;
    }

    const pageScripts = {
        "/planner": "/static/js/planner.js",
        "/verify": "/static/js/verification.js",
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

        "/settings": "/static/js/settings.js",
    };

    const pageStyles = {
        "/planner": "/static/css/planner.css",
        "/verify": "/static/css/verification.css",
        "/codes": "/static/css/codes.css",
        "/events": "/static/css/events/events.css",
        "/settings": "/static/css/settings.css",
    };

    async function loadPageScript(path) {

        const configuredScripts = pageScripts[path];

        if (!configuredScripts) {
            return;
        }

        // Support both single-file pages and multi-file pages.
        const scriptSources =
            Array.isArray(configuredScripts)
                ? configuredScripts
                : [configuredScripts];

        // Load scripts sequentially to preserve dependencies.
        for (const scriptSrc of scriptSources) {

            const absoluteSrc =
                new URL(
                    scriptSrc,
                    window.location.origin
                ).href;

            const existingScript =
                Array.from(
                    document.querySelectorAll("script[src]")
                ).find(
                    script => script.src === absoluteSrc
                );

            // Scripts remain loaded when navigating between pages.
            if (existingScript) {
                continue;
            }

            const script =
                document.createElement("script");

            script.src = scriptSrc;
            script.dataset.pageScript = path;
            script.dataset.scriptSrc = scriptSrc;

            // Wait for the script before loading the next one.
            await new Promise((resolve, reject) => {

                script.addEventListener(
                    "load",
                    resolve,
                    { once: true }
                );

                script.addEventListener(
                    "error",
                    () => reject(
                        new Error(
                            `Failed to load page script: ${scriptSrc}`
                        )
                    ),
                    { once: true }
                );

                document.body.appendChild(script);

            });

        }

    }

    function loadPageStyle(path) {

        const styleHref =
            pageStyles[path];

        if (!styleHref) {
            return;
        }

        const existingStyle =
            document.querySelector(
                `link[data-page-style="${path}"]`
            );

        if (existingStyle) {
            return;
        }

        const link =
            document.createElement("link");

        link.rel = "stylesheet";
        link.href = styleHref;
        link.dataset.pageStyle = path;

        document.head.appendChild(link);
    }

    async function navigate(url, addToHistory = true) {

        try {

            const response = await fetch(
                url,
                {
                    redirect: "manual"
                }
            );


            /*
             * Handle server-side redirects.
             */

            if (
                response.status === 301 ||
                response.status === 302 ||
                response.status === 303 ||
                response.status === 307 ||
                response.status === 308
            ) {

                const redirectUrl =
                    response.headers.get("Location");

                if (redirectUrl) {

                    window.location.href =
                        new URL(
                            redirectUrl,
                            window.location.origin
                        ).href;

                    return;
                }
            }


            if (!response.ok) {

                throw new Error(
                    `Navigation failed: ${response.status}`
                );

            }


            const html =
                await response.text();


            const parser =
                new DOMParser();


            const newDocument =
                parser.parseFromString(
                    html,
                    "text/html"
                );


            const newMain =
                newDocument.querySelector(
                    ".main-content"
                );


            if (!newMain) {

                throw new Error(
                    "New page does not contain .main-content"
                );

            }


            /*
             * Replace the page content.
             */

            mainContent.innerHTML =
                newMain.innerHTML;


            /*
             * Execute scripts from the new page.
             */

            mainContent
                .querySelectorAll("script")
                .forEach(oldScript => {

                    const newScript =
                        window.document.createElement(
                            "script"
                        );


                    for (
                        const attribute
                        of oldScript.attributes
                    ) {

                        newScript.setAttribute(
                            attribute.name,
                            attribute.value
                        );

                    }


                    newScript.textContent =
                        oldScript.textContent;


                    oldScript.replaceWith(
                        newScript
                    );

                });


            /*
             * Update browser history.
             */

            if (addToHistory) {

                history.pushState(
                    {},
                    "",
                    url
                );

            }


            /*
             * Initialise page-specific functionality.
             */

            const finalPath =
                new URL(
                    url,
                    window.location.origin
                ).pathname;

            loadPageStyle(finalPath);
            await loadPageScript(finalPath);


            if (
                finalPath === "/planner" &&
                typeof window.initPlanner === "function"
            ) {

                window.initPlanner();

            }


            if (
                finalPath === "/verify" &&
                typeof window.initVerify === "function"
            ) {

                window.initVerify();

            }


            if (
                finalPath === "/achievements" &&
                typeof window.initAchievements === "function"
            ) {

                window.initAchievements();

            }


            if (
                finalPath === "/settings" &&
                typeof window.initSettings === "function"
            ) {

                window.initSettings();

            }


            if (
                finalPath === "/events" &&
                typeof window.initEvents === "function"
            ) {

                window.initEvents();

            }


            /*
             * Update active sidebar item.
             */

            updateActiveNavigation(url);


            /*
             * Scroll to the top.
             */

            window.scrollTo({
                top: 0,
                behavior: "instant"
            });


        } catch (error) {

            console.error(
                "Navigation error:",
                error
            );


            window.location.href =
                url;

        }

    }


    function updateActiveNavigation(url) {

        const currentPath = new URL(url, window.location.origin).pathname;

        document.querySelectorAll(".nav-item").forEach(item => {

            const itemPath = new URL(
                item.href,
                window.location.origin
            ).pathname;

            item.classList.toggle(
                "active",
                itemPath === currentPath
            );

        });
    }


    document.addEventListener("click", event => {

        const link = event.target.closest("a");

        if (!link) {
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

        if (link.pathname === window.location.pathname &&
            link.hash) {
            return;
        }

        event.preventDefault();

        navigate(link.href);
    });


    window.addEventListener("popstate", () => {
        navigate(window.location.href, false);
    });

    const initialPath =
        window.location.pathname;

    loadPageStyle(initialPath);
    await loadPageScript(initialPath);


    if (
        initialPath === "/planner" &&
        typeof window.initPlanner === "function"
    ) {

        window.initPlanner();

    }


    if (
        initialPath === "/verify" &&
        typeof window.initVerify === "function"
    ) {

        window.initVerify();

    }


    if (
        initialPath === "/events" &&
        typeof window.initEvents === "function"
    ) {

        window.initEvents();

    }

});

const mobileMenuButton = document.getElementById("mobile-menu-button");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");


function openSidebar() {

    sidebar?.classList.add("open");

    sidebarOverlay?.classList.add("visible");

    mobileMenuButton?.classList.add("open");

    mobileMenuButton?.setAttribute(
        "aria-expanded",
        "true"
    );
}


function closeSidebar() {

    sidebar?.classList.remove("open");

    sidebarOverlay?.classList.remove("visible");

    mobileMenuButton?.classList.remove("open");

    mobileMenuButton?.setAttribute(
        "aria-expanded",
        "false"
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
    closeSidebar
);


sidebar?.querySelectorAll("a").forEach(link => {

    link.addEventListener(
        "click",
        closeSidebar
    );

});