const TERMS_COOKIE_AGE = 60 * 60 * 24 * 365;

export function initialiseTermsGate(): void {
    const gate = document.querySelector<HTMLElement>("[data-terms-gate]");

    if (!gate) return;

    const blocked = [...document.body.children].filter(
        (element): element is HTMLElement => element instanceof HTMLElement && element !== gate,
    );
    blocked.forEach((element) => (element.inert = true));
    gate.querySelector<HTMLButtonElement>("[data-terms-accept]")?.focus();

    gate.querySelector("[data-terms-accept]")?.addEventListener("click", () => {
        document.cookie = `cyrene_terms=${encodeURIComponent(gate.dataset.termsGate ?? "")}; Max-Age=${TERMS_COOKIE_AGE}; Path=/; SameSite=Lax; Secure`;
        blocked.forEach((element) => (element.inert = false));
        gate.remove();
    });

    gate.querySelector("[data-terms-decline]")?.addEventListener("click", () => {
        const message = gate.querySelector("[data-terms-declined]");

        if (message) {
            message.textContent =
                "You need to accept the Terms of Service to use Cyrene. You can close this tab, or accept if you change your mind.";
        }
    });
}
