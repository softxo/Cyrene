interface DocsSearchEntry {
    title: string;
    context: string;
    text: string;
    url: string;
}

interface Window {
    initDocs?: () => void;
}

(() => {
    const MAX_RESULTS = 8;

    function readSearchIndex(): DocsSearchEntry[] {
        const source = document.getElementById("docs-search-index");
        if (!source?.textContent) return [];

        try {
            const parsed: unknown = JSON.parse(source.textContent);
            return Array.isArray(parsed) ? (parsed as DocsSearchEntry[]) : [];
        } catch (error) {
            console.error("Couldn't read the documentation search index:", error);
            return [];
        }
    }

    function scoreEntry(entry: DocsSearchEntry, terms: string[]): number {
        const title = entry.title.toLowerCase();
        const haystack = `${title} ${entry.context} ${entry.text}`.toLowerCase();
        let score = 0;

        for (const term of terms) {
            if (!haystack.includes(term)) return 0;
            if (title === term || title === `/${term}`) score += 10;
            else if (title.startsWith(term) || title.startsWith(`/${term}`)) score += 6;
            else if (title.includes(term)) score += 4;
            else score += 1;
        }

        return score;
    }

    function initialiseSearch(page: HTMLElement): void {
        const input = page.querySelector<HTMLInputElement>("#docs-search-input");
        const results = page.querySelector<HTMLUListElement>("#docs-search-results");
        if (!input || !results) return;

        const index = readSearchIndex();
        let activeIndex = -1;
        const options = () => Array.from(results.querySelectorAll<HTMLAnchorElement>("a"));
        const setActive = (next: number) => {
            const links = options();
            if (!links.length) return;
            activeIndex = (next + links.length) % links.length;
            links.forEach((link, i) => link.classList.toggle("active", i === activeIndex));
            links[activeIndex].scrollIntoView({ block: "nearest" });
        };
        const render = () => {
            const terms = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
            results.replaceChildren();
            activeIndex = -1;

            if (!terms.length) {
                results.hidden = true;
                return;
            }

            const matches = index
                .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
                .filter((match) => match.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, MAX_RESULTS);

            if (!matches.length) {
                const empty = document.createElement("li");
                empty.className = "docs-search-empty";
                empty.textContent = "No matches. Try a command or feature name.";
                results.append(empty);
            }

            for (const { entry } of matches) {
                const item = document.createElement("li");
                const link = document.createElement("a");
                const title = document.createElement("strong");
                const context = document.createElement("span");

                link.href = entry.url;
                link.setAttribute("role", "option");
                title.textContent = entry.title;
                context.textContent = entry.context;
                link.append(title, context);
                item.append(link);
                results.append(item);
            }

            results.hidden = false;
        };

        input.addEventListener("input", render);
        input.addEventListener("focus", () => {
            if (input.value.trim()) render();
        });
        input.addEventListener("keydown", (event) => {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive(activeIndex + 1);
            } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive(activeIndex - 1);
            } else if (event.key === "Enter") {
                const target = options()[Math.max(activeIndex, 0)];
                if (target) {
                    event.preventDefault();
                    target.click();
                }
            } else if (event.key === "Escape") {
                input.value = "";
                render();
            }
        });

        results.addEventListener("click", () => {
            results.hidden = true;
            input.value = "";
        });

        const onDocumentClick = (event: MouseEvent) => {
            if (!page.isConnected) {
                document.removeEventListener("click", onDocumentClick, true);
                return;
            }
            if (event.target instanceof Node && !input.parentElement?.contains(event.target)) {
                results.hidden = true;
            }
        };
        const onDocumentKeydown = (event: KeyboardEvent) => {
            if (!page.isConnected) {
                document.removeEventListener("keydown", onDocumentKeydown);
                return;
            }
            const typing =
                event.target instanceof HTMLElement &&
                (event.target.isContentEditable ||
                    ["INPUT", "TEXTAREA"].includes(event.target.tagName));
            if (event.key === "/" && !typing) {
                event.preventDefault();
                input.focus();
            }
        };

        document.addEventListener("click", onDocumentClick, true);
        document.addEventListener("keydown", onDocumentKeydown);
    }

    function initialiseNavToggle(page: HTMLElement): void {
        const toggle = page.querySelector<HTMLButtonElement>("[data-docs-nav-toggle]");
        const links = page.querySelector<HTMLElement>("#docs-nav-links");
        if (!toggle || !links) return;

        toggle.addEventListener("click", () => {
            const open = toggle.getAttribute("aria-expanded") !== "true";
            toggle.setAttribute("aria-expanded", String(open));
            links.classList.toggle("open", open);
        });
    }

    function initialiseTableOfContents(page: HTMLElement): void {
        const links = Array.from(page.querySelectorAll<HTMLAnchorElement>("[data-docs-toc]"));
        if (!links.length) return;

        const headings = links
            .map((link) => document.getElementById(link.dataset.docsToc ?? ""))
            .filter((heading): heading is HTMLElement => heading !== null);
        const update = () => {
            let current = headings[0]?.id;
            for (const heading of headings) {
                if (heading.getBoundingClientRect().top <= 120) current = heading.id;
            }
            for (const link of links) {
                link.classList.toggle("active", link.dataset.docsToc === current);
            }
        };
        const onScroll = () => {
            if (!page.isConnected) {
                window.removeEventListener("scroll", onScroll);
                return;
            }
            update();
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        update();
    }

    function initDocs(): void {
        const page = document.querySelector<HTMLElement>("[data-docs-page]");
        if (!page || page.dataset.initialised === "true") return;

        page.dataset.initialised = "true";

        initialiseSearch(page);
        initialiseNavToggle(page);
        initialiseTableOfContents(page);
    }

    window.initDocs = initDocs;
})();
