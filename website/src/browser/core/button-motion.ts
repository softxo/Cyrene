export function initialiseButtonMotion(): void {
    const tracked = new WeakSet<HTMLElement>();
    const resize = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const box = entry.borderBoxSize[0];
            if (!box || box.inlineSize <= 0 || box.blockSize <= 0) continue;
            const element = entry.target as HTMLElement;
            element.style.setProperty("--button-width", String(box.inlineSize));
            element.style.setProperty("--button-height", String(box.blockSize));
        }
    });
    const buttonsIn = (node: Node): HTMLElement[] => {
        if (!(node instanceof Element)) return [];
        const buttons = Array.from(node.querySelectorAll<HTMLElement>(".cyrene-button"));
        if (node instanceof HTMLElement && node.matches(".cyrene-button")) buttons.unshift(node);
        return buttons;
    };
    const track = (button: HTMLElement): void => {
        if (tracked.has(button)) return;
        tracked.add(button);
        resize.observe(button, { box: "border-box" });
    };
    buttonsIn(document.body).forEach(track);
    new MutationObserver((records) => {
        for (const record of records) {
            for (const node of record.removedNodes) {
                for (const button of buttonsIn(node)) {
                    if (button.isConnected) continue;
                    resize.unobserve(button);
                    tracked.delete(button);
                }
            }
            for (const node of record.addedNodes) buttonsIn(node).forEach(track);
        }
    }).observe(document.body, { childList: true, subtree: true });
}
