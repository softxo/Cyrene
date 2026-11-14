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
        } catch {}
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
        } catch {}
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
            const path = document.createElementNS("http://www.w3.org/2000/svg", "use");
            path.setAttribute("href", "/static/images/ui/check.svg#check");
            path.setAttribute("stroke", "currentColor");
            path.setAttribute("stroke-width", "1.8");
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
    } catch {}
    let checking = false;
    let announced = "";
    let candidate = "";
    let indicator: HTMLButtonElement | null = null;
    let notification: HTMLElement | null = null;

    async function check() {
        if (checking || transitioning || document.hidden) return;
        checking = true;
        try {
            const response = await fetch("/api/site-version", {
                cache: "no-store",
                headers: { "X-Cyrene-Background": "1" },
                signal: AbortSignal.timeout(5000),
            });
            if (!response.ok) throw new Error("Site version unavailable");
            const data = (await response.json()) as { version?: unknown };
            if (typeof data.version !== "string" || !/^[a-f0-9]{20}$/.test(data.version))
                throw new Error("Invalid site version");
            if (data.version === baseline) {
                notification?.remove();
                notification = null;
                indicator?.remove();
                indicator = null;
                writeState("cyrene-available-update", "");
                writeState("cyrene-minimised-update", "");
                announced = "";
                candidate = "";
                return;
            }
            if (data.version === announced) return;
            if (candidate !== data.version) {
                notification?.remove();
                notification = null;
                indicator?.remove();
                indicator = null;
                announced = "";
                candidate = data.version;
                return;
            }
            const pageResponse = await fetch(window.location.href, {
                cache: "no-store",
                headers: { "X-Cyrene-Background": "1" },
                signal: AbortSignal.timeout(5000),
            });
            if (
                !pageResponse.ok ||
                !pageResponse.headers.get("content-type")?.includes("text/html")
            ) {
                throw new Error("Site page unavailable");
            }
            const page = new DOMParser().parseFromString(await pageResponse.text(), "text/html");
            if (
                page.querySelector<HTMLMetaElement>('meta[name="cyrene-site-version"]')?.content !==
                data.version
            ) {
                candidate = "";
                return;
            }
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
            later.className = "cyrene-button cyrene-button--danger site-update-later";
            later.textContent = "Later";
            async function settleButton(button: HTMLButtonElement) {
                button.dataset.settling = "true";
                later.disabled = true;
                update.disabled = true;
                void getComputedStyle(button, "::before").inset;
                await Promise.all(
                    button
                        .getAnimations({ subtree: true })
                        .map((motion) => motion.finished.catch(() => {})),
                );
            }
            async function collapsePopup(withAnimation = true) {
                if (!notification || transitioning) return;
                transitioning = true;
                const popup = notification;
                writeState("cyrene-minimised-update", announced);
                if (withAnimation) await settleButton(later);
                else {
                    later.disabled = true;
                    update.disabled = true;
                }
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
                delete later.dataset.settling;
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
            update.className = "cyrene-button site-update-apply";
            update.textContent = "Update";
            update.addEventListener("click", async () => {
                if (transitioning) return;
                transitioning = true;
                await settleButton(update);
                try {
                    sessionStorage.setItem(
                        "cyrene-pending-update",
                        JSON.stringify({ from: loadedVersion, target: announced, at: Date.now() }),
                    );
                } catch {}
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
            candidate = "";
            announced = "";
            notification?.remove();
            notification = null;
            indicator?.remove();
            indicator = null;
        } finally {
            checking = false;
        }
    }

    window.setInterval(() => void check(), 5000);
    document.addEventListener("visibilitychange", () => void check());
    window.addEventListener("focus", () => void check());
    window.addEventListener("online", () => void check());
    window.addEventListener("pageshow", () => void check());
    void check();
}
