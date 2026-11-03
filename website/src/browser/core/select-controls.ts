let initialised = false;

/** One owner for opening dropdowns; page modules still handle option selection. */
export function initialiseSelectControls(): void {
    if (initialised) return;
    initialised = true;
    const close = (select: Element): void => {
        select.classList.remove("open");
        select.querySelector(".custom-select-button")?.setAttribute("aria-expanded", "false");
    };
    const closeOthers = (except?: Element): void => {
        document.querySelectorAll(".custom-select.open").forEach((select) => {
            if (select !== except) close(select);
        });
    };
    document.addEventListener(
        "click",
        (event) => {
            if (!(event.target instanceof Element)) return;
            const button = event.target.closest<HTMLButtonElement>(".custom-select-button");
            const select = button?.closest<HTMLElement>(".custom-select");
            if (!button || !select) {
                if (!event.target.closest(".custom-select")) closeOthers();
                return;
            }
            // Do not let legacy page listeners toggle the same control a second time.
            event.preventDefault();
            event.stopPropagation();
            if (button.disabled || select.classList.contains("disabled")) return;
            const opening = !select.classList.contains("open");
            closeOthers(select);
            select.classList.toggle("open", opening);
            button.setAttribute("aria-expanded", String(opening));
            if (opening)
                requestAnimationFrame(() => {
                    if (!select.isConnected || !select.classList.contains("open")) return;
                    const selected = select.querySelector<HTMLElement>(
                        '.custom-select-option:is(.selected, .active, [aria-selected="true"])',
                    );
                    selected?.scrollIntoView({ block: "nearest" });
                    if (event.detail === 0) selected?.focus({ preventScroll: true });
                });
        },
        true,
    );
    document.addEventListener(
        "keydown",
        (event) => {
            if (!(event.target instanceof Element)) return;
            const select = event.target.closest<HTMLElement>(".custom-select");
            const button = select?.querySelector<HTMLButtonElement>(".custom-select-button");
            if (!select || !button || button.disabled) return;
            if (event.key === "Escape" && select.classList.contains("open")) {
                event.preventDefault();
                event.stopPropagation();
                close(select);
                button.focus();
            } else if (event.target === button && ["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                event.stopPropagation();
                closeOthers(select);
                select.classList.add("open");
                button.setAttribute("aria-expanded", "true");
                const options = select.querySelectorAll<HTMLButtonElement>(
                    ".custom-select-option:not(:disabled):not(.disabled)",
                );
                const option = event.key === "ArrowUp" ? options[options.length - 1] : options[0];
                option?.focus({ preventScroll: true });
            }
        },
        true,
    );
}
