/** Enhance existing inputs in place so page filtering and SPA updates keep working. */
export function initialiseSearchControls() {
    const tracked = new WeakSet();
    const icon = (pathData, className = "") => {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "1.8");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");
        if (className)
            svg.setAttribute("class", className);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        svg.append(path);
        return svg;
    };
    const update = (input) => {
        const clear = input.parentElement?.querySelector(".cyrene-search-clear");
        if (clear) {
            clear.hidden = !input.value;
            clear.disabled = input.disabled || input.readOnly;
        }
    };
    const enhance = (input) => {
        if (tracked.has(input))
            return;
        tracked.add(input);
        input.parentElement?.querySelector(".achievement-search-icon")?.remove();
        const wrapper = document.createElement("span");
        wrapper.className = "cyrene-search";
        input.before(wrapper);
        wrapper.append(input, icon("M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 21 21", "cyrene-search-icon"));
        input.classList.add("cyrene-input");
        const clear = document.createElement("button");
        clear.type = "button";
        clear.className = "cyrene-search-clear";
        clear.setAttribute("aria-label", "Clear search");
        if (input.id)
            clear.setAttribute("aria-controls", input.id);
        clear.append(icon("M7 7l10 10M17 7 7 17"));
        clear.addEventListener("click", () => {
            input.value = "";
            update(input);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("search", { bubbles: true }));
            input.focus({ preventScroll: true });
        });
        wrapper.append(clear);
        update(input);
    };
    const scan = (node) => {
        if (!(node instanceof Element))
            return;
        if (node instanceof HTMLInputElement && node.type === "search")
            enhance(node);
        node.querySelectorAll('input[type="search"]').forEach(enhance);
    };
    scan(document.body);
    for (const event of ["input", "change", "focusin"]) {
        document.addEventListener(event, (event) => {
            if (event.target instanceof HTMLInputElement && tracked.has(event.target))
                update(event.target);
        });
    }
    document.addEventListener("reset", (event) => {
        if (!(event.target instanceof HTMLFormElement))
            return;
        const form = event.target;
        queueMicrotask(() => form.querySelectorAll('input[type="search"]').forEach(update));
    });
    new MutationObserver((records) => {
        for (const record of records)
            for (const node of record.addedNodes)
                scan(node);
    }).observe(document.body, { childList: true, subtree: true });
}
