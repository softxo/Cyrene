interface Window {
    initVerify?: () => void;
    disposeVerify?: () => void;
}

window.initVerify = () => {
    const page = document.querySelector<HTMLElement>(".verification-page");
    if (!page || page.dataset.initialised) return;
    window.disposeVerify?.();
    page.dataset.initialised = "true";
    const lifecycle = new AbortController();
    const { signal } = lifecycle;
    const connected = page.querySelector<HTMLElement>("[data-discord-connected-panel]");
    const flow = page.querySelector<HTMLElement>("[data-verification-flow]")!;
    const code = page.querySelector<HTMLElement>("#verification-code")!;
    const status = page.querySelector<HTMLElement>("#verification-status")!;
    const success = page.querySelector<HTMLElement>("#verification-success")!;
    const retry = page.querySelector<HTMLButtonElement>("[data-verification-retry]")!;
    const next =
        document.querySelector<HTMLElement>("#verification-data")?.dataset.next || "/verify";
    const TOKEN = "cyrene_verification_token";
    const CODE = "cyrene_verification_code";
    let token: string | null = null;
    let polling: number | undefined;
    let redirect: number | undefined;
    let request: AbortController | null = null;
    let active = false;
    let checking = false;
    let generation = 0;
    function clearStored() {
        try {
            sessionStorage.removeItem(TOKEN);
            sessionStorage.removeItem(CODE);
        } catch {
            /* Verification also works without storage. */
        }
    }
    function stop() {
        active = false;
        generation++;
        token = null;
        window.clearInterval(polling);
        polling = undefined;
        request?.abort();
        request = null;
        checking = false;
    }
    async function check() {
        if (!active || !token || checking) return;
        checking = true;
        const run = generation;
        const pending = new AbortController();
        request = pending;
        try {
            const response = await fetch(`/api/verify/status?token=${encodeURIComponent(token)}`, {
                cache: "no-store",
                signal: pending.signal,
            });
            if (!active || signal.aborted || run !== generation) return;
            if (response.status === 404) {
                stop();
                clearStored();
                retry.hidden = false;
                status.textContent =
                    "This verification code has expired. Generate a new code to continue.";
                return;
            }
            if (!response.ok) {
                status.textContent = "Connection interrupted. Retrying verification...";
                return;
            }
            const data: { verified: boolean } = await response.json();
            if (!active || signal.aborted || run !== generation) return;
            if (!data.verified) {
                status.textContent = "Awaiting Verification";
                return;
            }
            stop();
            clearStored();
            flow.classList.add("is-verified");
            success.setAttribute("aria-hidden", "false");
            redirect = window.setTimeout(() => window.location.assign(next), 2200);
        } catch {
            if (!pending.signal.aborted && !signal.aborted && run === generation)
                status.textContent = "Connection interrupted. Retrying verification...";
        } finally {
            if (run === generation) {
                checking = false;
                request = null;
            }
        }
    }
    function poll() {
        active = true;
        polling = window.setInterval(() => void check(), 2000);
        void check();
    }
    async function create() {
        stop();
        clearStored();
        active = true;
        const run = generation;
        retry.hidden = true;
        code.textContent = "Generating...";
        status.textContent = "Generating verification code...";
        const pending = new AbortController();
        request = pending;
        try {
            const response = await fetch("/api/verify/create", {
                method: "POST",
                signal: pending.signal,
            });
            if (!response.ok) throw new Error("Verification unavailable");
            const data: { token: string; code: string } = await response.json();
            if (!active || signal.aborted || run !== generation) return;
            token = data.token;
            code.textContent = data.code;
            try {
                sessionStorage.setItem(TOKEN, data.token);
                sessionStorage.setItem(CODE, data.code);
            } catch {
                /* Poll without a stored request. */
            }
            status.textContent = "Awaiting Verification";
            poll();
        } catch {
            if (!pending.signal.aborted && !signal.aborted && run === generation) {
                status.textContent = "Unable to start verification. Please try again.";
                retry.hidden = false;
            }
        }
    }
    page.querySelector("[data-connect-another]")?.addEventListener(
        "click",
        () => {
            if (connected) connected.hidden = true;
            flow.hidden = false;
            void create();
        },
        { signal },
    );
    page.querySelector("[data-cancel-switch]")?.addEventListener(
        "click",
        () => {
            stop();
            clearStored();
            flow.hidden = true;
            if (connected) connected.hidden = false;
            page.querySelector<HTMLButtonElement>("[data-connect-another]")?.focus();
        },
        { signal },
    );
    const disconnect = page.querySelector<HTMLButtonElement>("[data-disconnect-discord]");
    const disconnectError = page.querySelector<HTMLElement>("[data-disconnect-error]");
    disconnect?.addEventListener(
        "click",
        async () => {
            if (disconnect.disabled) return;
            const connect = page.querySelector<HTMLButtonElement>("[data-connect-another]");
            disconnect.disabled = true;
            if (connect) connect.disabled = true;
            disconnect.textContent = "Disconnecting...";
            if (disconnectError) disconnectError.textContent = "";
            try {
                const response = await fetch("/api/auth/logout", { method: "POST", signal });
                if (!response.ok) throw new Error("Disconnect failed");
                if (signal.aborted) return;
                stop();
                clearStored();
                window.location.assign("/verify");
            } catch {
                if (signal.aborted) return;
                if (disconnectError)
                    disconnectError.textContent = "Couldn't disconnect. Please try again.";
                disconnect.disabled = false;
                if (connect) connect.disabled = false;
                disconnect.textContent = "Disconnect Discord account";
            }
        },
        { signal },
    );
    retry.addEventListener("click", () => void create(), { signal });
    document.addEventListener(
        "visibilitychange",
        () => {
            if (!document.hidden) void check();
        },
        { signal },
    );
    window.addEventListener("pageshow", () => void check(), { signal });
    window.disposeVerify = () => {
        stop();
        window.clearTimeout(redirect);
        lifecycle.abort();
        delete page.dataset.initialised;
    };
    if (connected) {
        clearStored();
        return;
    }
    try {
        token = sessionStorage.getItem(TOKEN);
        const savedCode = sessionStorage.getItem(CODE);
        if (token && savedCode) {
            code.textContent = savedCode;
            poll();
            return;
        }
    } catch {
        /* Start a fresh request if browser storage is unavailable. */
    }
    void create();
};
