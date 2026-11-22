function keyOf(node: Node): string {
    return node instanceof Element ? node.id || node.getAttribute("data-key") || "" : "";
}

function compatible(current: Node, next: Node): boolean {
    if (current.nodeType !== next.nodeType) return false;

    if (current instanceof Element && next instanceof Element) {
        return current.tagName === next.tagName && keyOf(current) === keyOf(next);
    }

    return true;
}

function morphAttributes(current: Element, next: Element): void {
    for (const attribute of Array.from(current.attributes)) {
        if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    }

    for (const attribute of Array.from(next.attributes)) {
        if (current.getAttribute(attribute.name) !== attribute.value) {
            current.setAttribute(attribute.name, attribute.value);
        }
    }
}

function morphNode(current: Node, next: Node): void {
    if (!(current instanceof Element) || !(next instanceof Element)) {
        if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;

        return;
    }

    morphAttributes(current, next);

    if (
        (current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement) &&
        current !== document.activeElement &&
        (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) &&
        current.value !== next.value
    ) {
        current.value = next.value;
    }

    morphChildren(current, next);
}

export function morphChildren(current: Element, next: Element): void {
    const keyed = new Map<string, Element>();

    for (const child of Array.from(current.children)) {
        const key = keyOf(child);

        if (key) keyed.set(key, child);
    }

    let cursor: ChildNode | null = current.firstChild;

    for (const incoming of Array.from(next.childNodes)) {
        const key = keyOf(incoming);
        let match: ChildNode | null = null;

        if (key) {
            const candidate = keyed.get(key);

            if (candidate && compatible(candidate, incoming)) match = candidate;
        } else if (cursor && !keyOf(cursor) && compatible(cursor, incoming)) {
            match = cursor;
        }

        if (!match) {
            current.insertBefore(incoming, cursor);
            continue;
        }

        if (match === cursor) {
            cursor = cursor.nextSibling;
        } else {
            current.insertBefore(match, cursor);
        }

        morphNode(match, incoming);
    }

    while (cursor) {
        const following: ChildNode | null = cursor.nextSibling;
        cursor.remove();
        cursor = following;
    }
}

export function renderInPlace(container: Element, render: () => void): void {
    const previous = document.createElement(container.tagName);
    previous.append(...Array.from(container.childNodes));
    render();
    const rendered = document.createElement(container.tagName);
    rendered.append(...Array.from(container.childNodes));
    container.append(...Array.from(previous.childNodes));
    morphChildren(container, rendered);
}

export function applyWithoutTransition(elements: (HTMLElement | null)[], apply: () => void): void {
    const targets = elements.filter((element): element is HTMLElement => element !== null);

    for (const element of targets) element.style.transition = "none";

    apply();

    for (const element of targets) {
        void element.offsetWidth;
        element.style.removeProperty("transition");
    }
}

export function captureLoadedImages(container: Element): () => void {
    const loaded = new Map<string, HTMLImageElement[]>();

    for (const image of Array.from(container.querySelectorAll("img"))) {
        if (!image.complete || image.naturalWidth === 0) continue;

        const matches = loaded.get(image.src) ?? [];
        matches.push(image);
        loaded.set(image.src, matches);
    }

    return () => {
        for (const image of Array.from(container.querySelectorAll("img"))) {
            const previous = loaded.get(image.src)?.shift();

            if (!previous || previous === image) continue;

            for (const attribute of Array.from(previous.attributes)) {
                if (!image.hasAttribute(attribute.name)) previous.removeAttribute(attribute.name);
            }

            for (const attribute of Array.from(image.attributes)) {
                if (previous.getAttribute(attribute.name) !== attribute.value) {
                    previous.setAttribute(attribute.name, attribute.value);
                }
            }

            image.replaceWith(previous);
        }
    };
}

export function revealContent(root: Element | null): void {
    if (!root?.classList.contains("is-loading")) return;

    root.querySelectorAll(".skeleton").forEach((placeholder) => placeholder.remove());
    root.classList.remove("is-loading");
    root.classList.add("is-revealing");
    window.setTimeout(() => root.classList.remove("is-revealing"), 400);
}

declare global {
    interface Window {
        morphChildren?: typeof morphChildren;
        renderInPlace?: typeof renderInPlace;
        applyWithoutTransition?: typeof applyWithoutTransition;
        revealContent?: typeof revealContent;
        captureLoadedImages?: typeof captureLoadedImages;
    }
}
