// @ts-nocheck -- Legacy global script; types will be tightened incrementally.
/* =========================================================
   CHARACTERS � MAIN INITIALISER
   ========================================================= */

function initCharacters() {
    initCharactersAccountDropdown();
    initCharactersFilters();
    initCharactersTabs();
    initCharacterPlanner();
    initCharacterShowcase();
    initCharactersAutoRefresh();
}

/* =========================================================
   ACCOUNT DROPDOWN
   ========================================================= */

function initCharactersAccountDropdown() {
    const form = document.querySelector("[data-characters-account-form]");

    if (!form || form.dataset.initialised === "true") {
        return;
    }

    const select = form.querySelector(".characters-account-select");
    const button = select?.querySelector(".custom-select-button");
    const menu = select?.querySelector(".custom-select-menu");
    const valueElement = select?.querySelector(".custom-select-value");
    const hiddenInput = select?.querySelector('input[name="account_id"]');
    const options = select?.querySelectorAll(".custom-select-option");

    if (!select || !button || !menu || !valueElement || !hiddenInput || !options) {
        return;
    }

    form.dataset.initialised = "true";

    function closeDropdown() {
        select.classList.remove("open");
        button.setAttribute("aria-expanded", "false");
    }

    function openDropdown() {
        select.classList.add("open");
        button.setAttribute("aria-expanded", "true");
    }

    button.addEventListener("click", (event) => {
        event.preventDefault();

        if (select.classList.contains("open")) {
            closeDropdown();
        } else {
            openDropdown();
        }
    });

    options.forEach((option) => {
        option.addEventListener("click", () => {
            const accountId = option.dataset.value;

            if (!accountId) {
                return;
            }

            hiddenInput.value = accountId;
            valueElement.textContent = option.textContent.trim();

            options.forEach((item) => {
                const isSelected = item === option;

                item.classList.toggle("selected", isSelected);
                item.setAttribute("aria-selected", String(isSelected));
            });

            closeDropdown();
            form.requestSubmit();
        });
    });

    document.addEventListener("click", (event) => {
        if (!select.contains(event.target)) {
            closeDropdown();
        }
    });

    button.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeDropdown();
            button.focus();
        }
    });
}

/* =========================================================
   EXPOSE MAIN INITIALISER
   ========================================================= */

window.initCharacters = initCharacters;

// Refresh the server-rendered roster without replacing controls or open drafts.
function initCharactersAutoRefresh() {
    const page = document.querySelector(".characters-page");
    if (!page || page.dataset.autoRefresh) return;
    page.dataset.autoRefresh = "true";
    const controller = new AbortController();
    let busy = false;
    let lastRefresh = Date.now();
    async function refresh() {
        if (!page.isConnected) {
            controller.abort();
            return;
        }
        if (
            busy ||
            document.hidden ||
            Date.now() - lastRefresh < 120_000 ||
            page.querySelector(
                "dialog[open], .planner-editor:not([hidden]), .planner-picker:not([hidden])",
            ) ||
            document.body.classList.contains("character-showcase-open")
        )
            return;
        busy = true;
        lastRefresh = Date.now();
        try {
            const accountId = page.querySelector('[name="account_id"]')?.value;
            const response = await fetch(
                `/characters?account_id=${encodeURIComponent(accountId || "")}`,
                {
                    signal: controller.signal,
                    cache: "no-store",
                    headers: { "X-Cyrene-Background": "1" },
                },
            );
            if (!response.ok || response.redirected) return;
            const snapshot = new DOMParser().parseFromString(await response.text(), "text/html");
            const incoming = snapshot.querySelector(".characters-page");
            if (
                !incoming?.querySelector('.character-card[data-owned="true"]') ||
                !page.isConnected ||
                page.querySelector(
                    "dialog[open], .planner-editor:not([hidden]), .planner-picker:not([hidden])",
                ) ||
                document.body.classList.contains("character-showcase-open")
            )
                return;
            for (const selector of [".character-card", "[data-planner-character-id]"]) {
                for (const current of page.querySelectorAll(selector)) {
                    const key =
                        selector === ".character-card"
                            ? "data-character-id"
                            : "data-planner-character-id";
                    const next = incoming.querySelector(
                        `${selector}[${key}="${current.getAttribute(key)}"]`,
                    );
                    if (!next) continue;
                    for (const attribute of next.attributes) {
                        if (attribute.name.startsWith("data-"))
                            current.setAttribute(attribute.name, attribute.value);
                    }
                    if (selector === ".character-card") {
                        current.classList.toggle(
                            "character-card-unowned",
                            next.dataset.owned !== "true",
                        );
                    }
                    current.replaceChildren(
                        ...Array.from(next.childNodes, (node) => document.importNode(node, true)),
                    );
                }
            }
            page.dispatchEvent(new CustomEvent("characters-refreshed"));
        } catch (error) {
            if (!controller.signal.aborted)
                console.warn("Could not refresh Characters from HoYoLAB.", error);
        } finally {
            busy = false;
        }
    }
    const timer = window.setInterval(refresh, 120_000);
    document.addEventListener("visibilitychange", refresh, { signal: controller.signal });
    window.addEventListener("focus", refresh, { signal: controller.signal });
    const observer = new MutationObserver(() => {
        if (!page.isConnected) controller.abort();
    });
    observer.observe(page.parentNode, { childList: true });
    controller.signal.addEventListener(
        "abort",
        () => {
            window.clearInterval(timer);
            observer.disconnect();
        },
        { once: true },
    );
}
