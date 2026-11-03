const toastModalHosts = new WeakSet();
function positionToastRegion(region) {
    const modal = document.activeElement?.closest("dialog[open]") ||
        Array.from(document.querySelectorAll("dialog[open]")).at(-1);
    const host = modal || document.body;
    if (region.parentElement !== host) {
        if (region.matches(":popover-open"))
            region.hidePopover();
        host.append(region);
    }
    if (modal && !toastModalHosts.has(modal)) {
        toastModalHosts.add(modal);
        modal.addEventListener("close", () => {
            const notifications = modal.querySelector("[data-cyrene-toasts]");
            if (notifications)
                positionToastRegion(notifications);
        });
    }
    if (typeof region.showPopover === "function" && region.childElementCount) {
        if (region.matches(":popover-open"))
            region.hidePopover();
        region.showPopover();
    }
}
/** Shared notifications survive navigation and stay interactive above native modals. */
export function showCyreneToast(message, kind = "success") {
    let region = document.querySelector("[data-cyrene-toasts]");
    if (!region) {
        region = document.createElement("div");
        region.className = "cyrene-toasts";
        region.setAttribute("popover", "manual");
        region.dataset.cyreneToasts = "";
        region.setAttribute("aria-label", "Notifications");
        region.setAttribute("aria-live", "polite");
        region.setAttribute("aria-relevant", "additions");
        document.body.append(region);
    }
    const toast = document.createElement("div");
    toast.className = "cyrene-toast";
    toast.dataset.kind = kind;
    toast.setAttribute("aria-atomic", "true");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.classList.add("cyrene-toast-icon");
    const path = document.createElementNS(icon.namespaceURI, kind === "success" ? "use" : "path");
    if (kind === "success")
        path.setAttribute("href", "/static/images/ui/check.svg#check");
    else
        path.setAttribute("d", "M12 7v6m0 4h.01M12 3 2 21h20L12 3Z");
    icon.append(path);
    const text = document.createElement("span");
    text.className = "cyrene-toast-message";
    text.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "cyrene-button cyrene-toast-close";
    if (kind !== "success")
        close.classList.add("cyrene-button--danger");
    close.setAttribute("aria-label", "Dismiss notification");
    const cross = document.createElement("span");
    cross.className = "cyrene-close";
    cross.setAttribute("aria-hidden", "true");
    close.append(cross);
    toast.append(icon, text, close);
    let timeout;
    const dismiss = () => {
        if (toast.dataset.dismissing)
            return;
        clearTimeout(timeout);
        toast.dataset.dismissing = "true";
        toast.inert = true;
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            toast.remove();
            return;
        }
        const style = getComputedStyle(toast);
        const motion = toast.animate([
            { opacity: style.opacity, transform: style.transform },
            { opacity: 0, transform: "translateY(6px)" },
        ], { duration: 180, easing: "ease-in", fill: "forwards" });
        void motion.finished.catch(() => { }).then(() => toast.remove());
    };
    const resume = () => {
        clearTimeout(timeout);
        if (toast.dataset.dismissing)
            return;
        if (!toast.matches(":hover, :focus-within"))
            timeout = setTimeout(dismiss, 5000);
    };
    close.addEventListener("click", dismiss);
    toast.addEventListener("pointerenter", () => clearTimeout(timeout));
    toast.addEventListener("pointerleave", resume);
    toast.addEventListener("focusin", () => clearTimeout(timeout));
    toast.addEventListener("focusout", resume);
    // Bound the stack while keeping recent actions visible.
    const visible = region.querySelectorAll(".cyrene-toast:not([data-dismissing])");
    if (visible.length >= 3) {
        visible[0].querySelector("button")?.click();
    }
    region.append(toast);
    positionToastRegion(region);
    resume();
}
window.showCyreneToast = showCyreneToast;
