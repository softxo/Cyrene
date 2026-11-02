export function initialiseSiteUpdates(): void {
    const loadedVersion = document.querySelector<HTMLMetaElement>(
        'meta[name="cyrene-site-version"]',
    )?.content;
    if (!loadedVersion) return;
    function readState(key: string) {
        try {
            return sessionStorage.getItem(key) ?? "";
        } catch {
            return "";
        }
    }
    function writeState(key: string, value: string) {
        try {
            if (value) sessionStorage.setItem(key, value);
            else sessionStorage.removeItem(key);
        } catch {
            /* Keep the current page working without storage. */
        }
    }
    let baseline = readState("cyrene-update-baseline");
    if (!/^[a-f0-9]{20}$/.test(baseline)) {
        baseline = loadedVersion;
        writeState("cyrene-update-baseline", baseline);
    }
    const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let transitioning = false;
    async function animate(element: HTMLElement, frames: Keyframe[], duration = 220) {
        if (reducedMotion()) return;
        const motion = element.animate(frames, {
            duration,
            easing: "cubic-bezier(.2,.7,.2,1)",
            fill: "both",
        });
        try {
            await motion.finished;
        } catch {
            /* Navigation can cancel an animation. */
        }
        motion.cancel();
    }
    const enterFrames = [
        { opacity: 0, transform: "translateX(-50%) translateY(-8px) scale(.96)" },
        { opacity: 1, transform: "translateX(-50%) translateY(0) scale(1)" },
    ];
    try {
        const pending = JSON.parse(sessionStorage.getItem("cyrene-pending-update") || "null");
        sessionStorage.removeItem("cyrene-pending-update");
        if (
            pending &&
            typeof pending.from === "string" &&
            (pending.from !== loadedVersion || pending.target === loadedVersion) &&
            Date.now() - pending.at < 180000 &&
            Date.now() >= pending.at
        ) {
            baseline = loadedVersion;
            writeState("cyrene-update-baseline", baseline);
            writeState("cyrene-available-update", "");
            writeState("cyrene-minimised-update", "");
            const success = document.createElement("div");
            success.className = "site-update-success";
            success.setAttribute("role", "status");
            const icon = document.createElement("span");
            icon.className = "site-update-success-icon";
            const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute("viewBox", "0 0 24 24");
            svg.setAttribute("width", "15");
            svg.setAttribute("height", "15");
            svg.setAttribute("fill", "none");
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", "M5 12l4 4L19 6");
            path.setAttribute("stroke", "currentColor");
            path.setAttribute("stroke-width", "2.5");
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            svg.append(path);
            icon.append(svg);
            icon.setAttribute("aria-hidden", "true");
            success.append(icon, document.createTextNode("Cyrene updated"));
            document.body.append(success);
            void animate(success, enterFrames);
            window.setTimeout(() => {
                void animate(success, [{ opacity: 1 }, { opacity: 0 }], 180).then(() =>
                    success.remove(),
                );
            }, 4500);
        }
    } catch {
        /* Updates still work when browser storage is unavailable. */
    }
    let checking = false;
    let announced = "";
    let indicator: HTMLButtonElement | null = null;
    let notification: HTMLElement | null = null;

    async function check(restoredVersion?: string) {
        if (checking || transitioning || document.hidden) return;
        checking = true;
        try {
            let data: { version?: unknown };
            if (restoredVersion) data = { version: restoredVersion };
            else {
                const response = await fetch("/api/site-version", {
                    cache: "no-store",
                    signal: AbortSignal.timeout(10000),
                });
                if (!response.ok) return;
                data = await response.json();
            }
            if (typeof data.version !== "string" || !/^[a-f0-9]{20}$/.test(data.version)) return;
            if (data.version === baseline) {
                notification?.remove();
                notification = null;
                indicator?.remove();
                indicator = null;
                writeState("cyrene-available-update", "");
                writeState("cyrene-minimised-update", "");
                announced = "";
                return;
            }
            if (data.version === announced) return;
            announced = data.version;
            writeState("cyrene-available-update", announced);
            notification?.remove();
            indicator?.remove();
            indicator = null;
            notification = document.createElement("aside");
            notification.className = "site-update-notice";
            notification.setAttribute("aria-label", "Site update");
            const message = document.createElement("div");
            message.setAttribute("role", "status");
            const title = document.createElement("strong");
            title.textContent = "Update available";
            const detail = document.createElement("p");
            detail.textContent =
                "A new version of Cyrene is ready. Reload to get the latest changes.";
            message.append(title, detail);
            const actions = document.createElement("div");
            actions.className = "site-update-actions";
            const later = document.createElement("button");
            later.type = "button";
            later.textContent = "Later";
            async function collapsePopup(withAnimation = true) {
                if (!notification || transitioning) return;
                transitioning = true;
                const popup = notification;
                writeState("cyrene-minimised-update", announced);
                later.disabled = true;
                update.disabled = true;
                indicator = document.createElement("button");
                indicator.type = "button";
                indicator.disabled = true;
                indicator.className = "site-update-dot";
                indicator.textContent = "Update";
                indicator.setAttribute("aria-label", "Show available update");
                indicator.title = "Update available";
                indicator.addEventListener("click", async () => {
                    if (transitioning || !indicator || !notification) return;
                    transitioning = true;
                    writeState("cyrene-minimised-update", "");
                    const pill = indicator;
                    await animate(
                        pill,
                        [
                            { opacity: 1, transform: "translateX(-50%) scale(1)" },
                            { opacity: 0, transform: "translateX(-50%) scale(.8)" },
                        ],
                        140,
                    );
                    pill.remove();
                    indicator = null;
                    notification.hidden = false;
                    later.disabled = true;
                    update.disabled = true;
                    await animate(notification, enterFrames);
                    later.disabled = false;
                    update.disabled = false;
                    notification.querySelector<HTMLButtonElement>(".site-update-apply")?.focus();
                    transitioning = false;
                });
                const pill = indicator;
                pill.hidden = true;
                document.body.append(pill);
                if (withAnimation)
                    await animate(popup, [
                        { opacity: 1, transform: "translateX(-50%) scale(1)" },
                        { opacity: 0, transform: "translateX(-50%) translateY(-6px) scale(.8)" },
                    ]);
                popup.hidden = true;
                pill.hidden = false;
                if (withAnimation)
                    await animate(
                        pill,
                        [
                            { opacity: 0, transform: "translateX(-50%) scale(.75)" },
                            { opacity: 1, transform: "translateX(-50%) scale(1)" },
                        ],
                        180,
                    );
                pill.disabled = false;
                if (withAnimation) pill.focus();
                later.disabled = false;
                update.disabled = false;
                transitioning = false;
            }
            later.addEventListener("click", () => void collapsePopup());
            const update = document.createElement("button");
            update.type = "button";
            update.className = "site-update-apply";
            update.textContent = "Update";
            update.addEventListener("click", async () => {
                if (transitioning) return;
                transitioning = true;
                update.disabled = true;
                later.disabled = true;
                update.textContent = "Updating...";
                try {
                    sessionStorage.setItem(
                        "cyrene-pending-update",
                        JSON.stringify({ from: loadedVersion, target: announced, at: Date.now() }),
                    );
                } catch {
                    /* Reload without a stored confirmation. */
                }
                const overlay = document.createElement("div");
                overlay.className = "site-update-transition";
                overlay.setAttribute("role", "status");
                const spinner = document.createElement("span");
                spinner.className = "site-update-spinner";
                spinner.setAttribute("aria-hidden", "true");
                overlay.append(spinner, document.createTextNode("Updating Cyrene..."));
                document.body.append(overlay);
                await animate(overlay, [{ opacity: 0 }, { opacity: 1 }], 240);
                window.location.reload();
            });
            actions.append(later, update);
            notification.append(message, actions);
            document.body.append(notification);
            if (readState("cyrene-minimised-update") === announced) void collapsePopup(false);
            else void animate(notification, enterFrames);
        } catch {
            // A temporary outage should not interrupt the current page.
        } finally {
            checking = false;
        }
    }

    window.setInterval(() => void check(), 60000);
    document.addEventListener("visibilitychange", () => void check());
    window.addEventListener("focus", () => void check());
    const available = readState("cyrene-available-update");
    if (/^[a-f0-9]{20}$/.test(available)) void check(available).then(() => check());
    else void check();
}
