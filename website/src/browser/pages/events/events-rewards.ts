// Delegation keeps reward previews working after Events refresh replaces cards.
(() => {
    if (document.documentElement.dataset.insightRewardsInitialised) return;
    document.documentElement.dataset.insightRewardsInitialised = "true";
    let active: HTMLElement | null = null;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let nextId = 0;

    const close = (immediate = false) => {
        clearTimeout(closeTimer);
        clearTimeout(openTimer);
        if (!active) return;
        const popup = active.querySelector<HTMLElement>(".event-insight-popover");
        popup?.classList.remove("is-visible");
        const finish = () => {
            if (
                popup?.isConnected &&
                !popup.classList.contains("is-visible") &&
                popup.matches(":popover-open")
            )
                popup.hidePopover();
        };
        if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) finish();
        else setTimeout(finish, 140);
        active.querySelector("button")?.setAttribute("aria-expanded", "false");
        active = null;
    };

    const position = (wrapper: HTMLElement) => {
        const popup = wrapper.querySelector<HTMLElement>(".event-insight-popover");
        const button = wrapper.querySelector<HTMLButtonElement>("button");
        if (!popup || !button) return;
        const anchor = button.getBoundingClientRect();
        const content = popup.querySelector<HTMLElement>(".event-insight-content");
        if (content) content.style.maxHeight = `${Math.max(72, innerHeight - 34)}px`;
        const desiredHeight = popup.offsetHeight;
        const roomBelow = innerHeight - anchor.bottom - 20;
        const roomAbove = anchor.top - 20;
        const below =
            wrapper.dataset.popoverPlacement !== "top" &&
            (desiredHeight <= roomBelow || (desiredHeight > roomAbove && roomBelow >= roomAbove));
        if (content) content.style.maxHeight = `${Math.max(72, below ? roomBelow : roomAbove)}px`;
        const width = popup.offsetWidth;
        const height = popup.offsetHeight;
        const left = Math.max(
            8,
            Math.min(anchor.left + anchor.width / 2 - width / 2, innerWidth - width - 8),
        );
        const top = below ? anchor.bottom + 10 : Math.max(8, anchor.top - height - 10);
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.dataset.side = below ? "bottom" : "top";
        popup.style.setProperty(
            "--insight-arrow-x",
            `${Math.max(18, Math.min(width - 18, anchor.left + anchor.width / 2 - left))}px`,
        );
    };

    const open = (wrapper: HTMLElement) => {
        clearTimeout(closeTimer);
        clearTimeout(openTimer);
        if (active === wrapper && wrapper.querySelector(".event-insight-popover:popover-open"))
            return;
        close(true);
        const popup = wrapper.querySelector<HTMLElement>(".event-insight-popover");
        const button = wrapper.querySelector<HTMLButtonElement>("button");
        if (!popup || !button) return;
        if (!popup.id) popup.id = `insight-rewards-${++nextId}`;
        button.setAttribute("aria-describedby", popup.id);
        button.setAttribute("aria-expanded", "true");
        if (!popup.matches(":popover-open")) popup.showPopover();
        position(wrapper);
        active = wrapper;
        requestAnimationFrame(() => {
            if (active === wrapper) popup.classList.add("is-visible");
        });
    };

    const wrapperFor = (target: EventTarget | null) =>
        target instanceof Element ? target.closest<HTMLElement>(".event-insight") : null;

    document.addEventListener("pointerover", (event) => {
        if (event.pointerType === "touch") return;
        const wrapper = wrapperFor(event.target);
        if (wrapper) {
            clearTimeout(closeTimer);
            if (event.relatedTarget instanceof Node && wrapper.contains(event.relatedTarget))
                return;
            clearTimeout(openTimer);
            openTimer = setTimeout(() => open(wrapper), 70);
        }
    });
    document.addEventListener("pointerout", (event) => {
        const wrapper = wrapperFor(event.target);
        if (
            wrapper &&
            !(event.relatedTarget instanceof Node && wrapper.contains(event.relatedTarget))
        ) {
            clearTimeout(openTimer);
            closeTimer = setTimeout(() => close(), 180);
        }
    });
    document.addEventListener("focusin", (event) => {
        const wrapper = wrapperFor(event.target);
        if (wrapper) open(wrapper);
    });
    document.addEventListener("focusout", (event) => {
        if (
            active &&
            !(event.relatedTarget instanceof Node && active.contains(event.relatedTarget))
        )
            close();
    });
    document.addEventListener("click", (event) => {
        const wrapper = wrapperFor(event.target);
        if (wrapper && event.target instanceof Element && event.target.closest("button")) {
            event.preventDefault();
            open(wrapper);
        } else if (!wrapper) close();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close(true);
    });
    document.addEventListener(
        "scroll",
        (event) => {
            if (
                !active ||
                (event.target instanceof Element && event.target.closest(".event-insight-popover"))
            )
                return;
            requestAnimationFrame(() => {
                if (active?.isConnected) position(active);
                else close();
            });
        },
        true,
    );
    window.addEventListener("resize", () => close(true));
})();
