// Delegation keeps reward previews working after Events refresh replaces cards.
(() => {
    if (document.documentElement.dataset.insightRewardsInitialised)
        return;
    document.documentElement.dataset.insightRewardsInitialised = "true";
    let active = null;
    let closeTimer;
    let nextId = 0;
    const close = () => {
        clearTimeout(closeTimer);
        if (!active)
            return;
        const popup = active.querySelector(".event-insight-popover");
        if (popup?.isConnected && popup.matches(":popover-open"))
            popup.hidePopover();
        active.querySelector("button")?.setAttribute("aria-expanded", "false");
        active = null;
    };
    const position = (wrapper) => {
        const popup = wrapper.querySelector(".event-insight-popover");
        const button = wrapper.querySelector("button");
        if (!popup || !button)
            return;
        const anchor = button.getBoundingClientRect();
        const bounds = popup.getBoundingClientRect();
        const left = Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8));
        const top = anchor.bottom + bounds.height + 8 <= innerHeight
            ? anchor.bottom + 6
            : Math.max(8, anchor.top - bounds.height - 6);
        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
    };
    const open = (wrapper) => {
        clearTimeout(closeTimer);
        if (active === wrapper && wrapper.querySelector(".event-insight-popover:popover-open"))
            return;
        close();
        const popup = wrapper.querySelector(".event-insight-popover");
        const button = wrapper.querySelector("button");
        if (!popup || !button)
            return;
        if (!popup.id)
            popup.id = `insight-rewards-${++nextId}`;
        button.setAttribute("aria-describedby", popup.id);
        button.setAttribute("aria-expanded", "true");
        popup.showPopover();
        position(wrapper);
        active = wrapper;
    };
    const wrapperFor = (target) => target instanceof Element ? target.closest(".event-insight") : null;
    document.addEventListener("pointerover", event => {
        if (event.pointerType === "touch")
            return;
        const wrapper = wrapperFor(event.target);
        if (wrapper)
            open(wrapper);
    });
    document.addEventListener("pointerout", event => {
        const wrapper = wrapperFor(event.target);
        if (wrapper && !(event.relatedTarget instanceof Node && wrapper.contains(event.relatedTarget))) {
            closeTimer = setTimeout(close, 180);
        }
    });
    document.addEventListener("focusin", event => {
        const wrapper = wrapperFor(event.target);
        if (wrapper)
            open(wrapper);
    });
    document.addEventListener("focusout", event => {
        if (active && !(event.relatedTarget instanceof Node && active.contains(event.relatedTarget)))
            close();
    });
    document.addEventListener("click", event => {
        const wrapper = wrapperFor(event.target);
        if (wrapper && event.target instanceof Element && event.target.closest("button")) {
            event.preventDefault();
            open(wrapper);
        }
        else if (!wrapper)
            close();
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape")
        close(); });
    document.addEventListener("scroll", event => {
        if (!active || (event.target instanceof Element && event.target.closest(".event-insight-popover")))
            return;
        requestAnimationFrame(() => {
            if (active?.isConnected)
                position(active);
            else
                close();
        });
    }, true);
    window.addEventListener("resize", close);
})();
