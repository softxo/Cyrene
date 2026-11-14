let initialised = false;

export function initialiseColourPickers(): void {
    if (initialised || !CSS.supports("selector(input:open)")) return;
    initialised = true;
    let active: HTMLInputElement | null = null;
    let pressedWhileOpen = false;
    function watch(input: HTMLInputElement): void {
        requestAnimationFrame(() => {
            if (active !== input) return;
            if (!input.isConnected || !input.matches(":open")) active = null;
            else watch(input);
        });
    }
    document.addEventListener(
        "pointerdown",
        (event) => {
            const input = event.target;
            pressedWhileOpen = input === active && active !== null;
            if (input !== active) active = null;
        },
        true,
    );
    document.addEventListener(
        "click",
        (event) => {
            const input = event.target;
            if (!(input instanceof HTMLInputElement) || input.type !== "color") return;
            if (pressedWhileOpen || input.matches(":open")) {
                event.preventDefault();
                active = null;
                if (input.matches(":open")) {
                    input.hidden = true;
                    void input.offsetWidth;
                    input.hidden = false;
                }
            } else {
                active = input;
                watch(input);
            }
            pressedWhileOpen = false;
        },
        true,
    );
}
