import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const variants = [
    ["home", "home-page home-changelog", "home-action-primary"],
    ["characters", "characters-page", "planner-add-button"],
    ["weapons", "weapons-page", "characters-reset-filters weapon-add-submit"],
    ["codes", "codes-page", "codes-refresh-button"],
    ["planner", "planner-page", "planner-button"],
    ["events", "events-page events-custom-dialog", "events-custom-save"],
    ["settings", "settings-page account-link-form", "account-link-open"],
    ["wishes", "wishes-page", "button wish-import-header-button"],
    ["achievements", "achievements-page", "button achievement-notes-add"],
    ["verification", "verification-page", "verification-primary"],
];

const importControls = ["weapons", "wishes", "achievements"]
    .flatMap((name) =>
        [
            ...readFileSync(`website/templates/${name}.html`, "utf8").matchAll(
                /<button\b[^>]*>[\s\S]*?<\/button>/g,
            ),
        ]
            .map((match) => match[0])
            .filter((tag) => tag.includes("cyrene-import-button")),
    )
    .join("");
const dropdownControls = [
    ["characters-account-select", "custom-select-button"],
    ["characters-filter", "custom-select-button"],
    ["codes-account-selector", "custom-select-button"],
    ["inventory-account-select", "custom-select-button"],
    ["wishes-account-form", "custom-select-button"],
    ["achievement-version-select", "custom-select-button achievement-version-button"],
    ["events-account-selector", "custom-select-button"],
    ["events-custom-dialog", "custom-select-button"],
    ["planner-talent-levels", "planner-choice-trigger"],
    ["events-custom-dialog", "cyrene-select-trigger events-custom-datetime-trigger"],
]
    .map(
        ([wrapper, trigger]) =>
            `<div class="${wrapper}" style="position:static;min-height:0;padding:0"><div class="custom-select" data-custom-dropdown="test"><button class="${trigger}">Account<span class="custom-select-arrow"></span></button></div></div>`,
    )
    .join("");

const plus =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

for (const width of [390, 1280]) {
    test(`Shared appearance allows different sizes, centred motion and subtle focus at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.route("http://127.0.0.1:8000/**", (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.startsWith("/static/"))
                return route.fulfill({
                    body: readFileSync(`website${path}`),
                    contentType: path.endsWith(".css") ? "text/css" : "text/javascript",
                });
            return route.fulfill({
                contentType: "text/html",
                body: `<!doctype html><html><head><link rel="stylesheet" href="/static/build/css/global.css"><link rel="stylesheet" href="/static/build/css/inventory.css">${variants.map(([sheet]) => `<link rel="stylesheet" href="/static/build/css/${sheet}.css">`).join("")}</head><body><main style="padding:20px"><div data-import-standards>${importControls}</div><div data-dropdown-standards>${dropdownControls}</div>${variants.map(([sheet, wrapper, button]) => `<section class="${wrapper}" style="position:static;display:block;padding:0;margin:0;border:0;min-height:0;width:100%;max-width:100%"><button id="${sheet}" class="cyrene-button ${button}" type="button">${plus}<span>Action</span></button></section>`).join("")}<div class="achievement-category-controls"><div class="achievement-search-wrapper"><input class="cyrene-input achievement-search" aria-label="Achievement search" placeholder="Search achievements..."></div><div class="custom-select achievement-version-select"><button class="custom-select-button achievement-version-button">All Versions</button></div><label class="checkbox-control"><input type="checkbox"><span>Hide Completed</span></label><button class="cyrene-button button achievement-import-button">Import</button></div><div class="events-controls"><button class="cyrene-button events-account-tab">All</button><a class="cyrene-button events-layout-switch" href="#">Switch layout</a><button class="cyrene-button events-limited-filter-button" aria-label="Categories">${plus}</button><button class="cyrene-button events-custom-action">Edit</button></div><div class="home-changelog"><button id="plus" class="cyrene-button cyrene-button--icon changelog-add" aria-label="Add changelog">${plus}</button></div><div class="events-custom-dialog" style="position:static;min-height:0;padding:0"><div class="custom-select" data-custom-dropdown="recurrence_type"><button class="custom-select-button" aria-expanded="false"><span>Account</span><span class="custom-select-arrow"></span></button><div class="custom-select-menu" role="listbox"><button class="custom-select-option selected" data-value="none" aria-selected="true">Account one</button><button class="custom-select-option disabled" disabled>Unavailable</button></div></div></div><label class="characters-search"><input class="cyrene-input" aria-label="Character search"></label><label class="inventory-search"><input class="cyrene-input" aria-label="Inventory search"></label><label class="custom-input-wrapper"><input aria-label="Wrapped search"></label><input class="cyrene-input" aria-label="Nickname"><button class="cyrene-button" disabled>Saving</button></main><script type="module">import {initialiseButtonMotion} from '/static/build/browser/core/button-motion.js';initialiseButtonMotion();</script></body></html>`,
            });
        });
        await page.goto("http://127.0.0.1:8000/controls");
        await page.evaluate(() => {
            document.documentElement.dataset.theme = "pink";
        });
        await page.locator("[data-import-standards]").evaluate(async (el) => {
            await Promise.all(
                el
                    .getAnimations({ subtree: true })
                    .map((animation) => animation.finished.catch(() => {})),
            );
        });
        const importStyles = [];
        for (const button of await page.locator("[data-import-standards] button").all()) {
            await expect(button).toHaveText("Import");
            importStyles.push(
                await button.evaluate((el) => {
                    const s = getComputedStyle(el);
                    return [
                        s.height,
                        s.minHeight,
                        s.padding,
                        s.fontSize,
                        s.fontWeight,
                        s.lineHeight,
                        s.borderRadius,
                        getComputedStyle(el, "::before").backgroundColor,
                    ];
                }),
            );
        }
        expect(importStyles).toHaveLength(5);
        for (const style of importStyles) expect(style).toEqual(importStyles[0]);
        expect(importStyles[0].slice(0, 3)).toEqual(["40px", "40px", "8px 12px"]);
        for (const trigger of await page.locator("[data-dropdown-standards] button").all()) {
            const wrapper = await trigger.evaluate(
                (el) =>
                    el.closest("[data-dropdown-standards]")!.children[
                        Array.from(
                            el.closest("[data-dropdown-standards]")!.querySelectorAll("button"),
                        ).indexOf(el as HTMLButtonElement)
                    ].className,
            );
            const expectedHeight = wrapper.includes("events-account-selector")
                ? "36px"
                : wrapper.includes("events-custom-dialog") ||
                    wrapper.includes("codes-account-selector")
                  ? "42px"
                  : "40px";
            expect(
                await trigger.evaluate((el) => {
                    const s = getComputedStyle(el);
                    return [
                        s.height,
                        s.padding,
                        s.fontSize,
                        s.fontWeight,
                        s.lineHeight,
                        s.borderRadius,
                    ];
                }),
            ).toEqual([expectedHeight, "0px 12px", "14px", "400", "20px", "14px"]);
        }
        const heights = new Set<number>();
        for (const [name] of variants) {
            const button = page.locator(`#${name}`);
            await expect
                .poll(() => button.evaluate((el) => el.style.getPropertyValue("--button-width")))
                .not.toBe("");
            await button.scrollIntoViewIfNeeded();
            const bounds = (await button.boundingBox())!;
            heights.add(Math.round(bounds.height));
            await expect(button).toHaveCSS("border-radius", "14px");
            await expect(button).toHaveCSS("transform", "none");
            await button.hover();
            await expect
                .poll(() =>
                    button.evaluate((el) => {
                        const m = new DOMMatrixReadOnly(getComputedStyle(el, "::before").transform);
                        return (
                            Math.round((((1 - m.a) * el.getBoundingClientRect().width) / 2) * 100) /
                            100
                        );
                    }),
                )
                .toBe(1);
            await page.mouse.down();
            await expect
                .poll(() =>
                    button.evaluate((el) => {
                        const m = new DOMMatrixReadOnly(getComputedStyle(el, "::before").transform);
                        return (
                            Math.round(
                                (((1 - m.d) * el.getBoundingClientRect().height) / 2) * 100,
                            ) / 100
                        );
                    }),
                )
                .toBe(2);
            await page.mouse.up();
            expect(await button.boundingBox()).toEqual(bounds);
        }
        expect(heights.size).toBeGreaterThan(2);
        // Sample intermediate compositor frames, including quick reversals.
        const button = page.locator("#codes");
        await button.scrollIntoViewIfNeeded();
        const recording = page.evaluate(async () => {
            const el = document.querySelector<HTMLElement>("#codes")!;
            const frames: { x: number; y: number }[] = [];
            const start = performance.now();
            while (performance.now() - start < 500) {
                await new Promise(requestAnimationFrame);
                const m = new DOMMatrixReadOnly(getComputedStyle(el, "::before").transform);
                const box = el.getBoundingClientRect();
                frames.push({ x: ((1 - m.a) * box.width) / 2, y: ((1 - m.d) * box.height) / 2 });
            }
            return frames;
        });
        await button.hover();
        await page.mouse.down();
        await page.waitForTimeout(35);
        await page.mouse.up();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(35);
        await button.hover();
        const frames = await recording;
        expect(frames.some((f) => f.x > 0.05 && f.x < 0.95)).toBe(true);
        for (const frame of frames) expect(Math.abs(frame.x - frame.y)).toBeLessThan(0.02);
        const add = page.locator("#plus");
        const centre = await add.evaluate((el) => {
            const a = el.getBoundingClientRect(),
                b = el.querySelector("svg")!.getBoundingClientRect();
            return {
                x: a.x + a.width / 2 - b.x - b.width / 2,
                y: a.y + a.height / 2 - b.y - b.height / 2,
                width: a.width,
                height: a.height,
            };
        });
        expect(centre).toEqual({ x: 0, y: 0, width: 34, height: 34 });
        await page.mouse.move(0, 0);
        await button.blur();
        await button.evaluate(async (el) => {
            await Promise.all(
                el.getAnimations({ subtree: true }).map((animation) => animation.finished),
            );
        });
        const palette = await button.evaluate((el) => {
            const s = getComputedStyle(el, "::before");
            return { background: s.backgroundColor, border: s.borderColor };
        });
        const inset = await page.evaluate(() => {
            const probe = document.createElement("span");
            probe.style.backgroundColor = "var(--surface-inset)";
            document.body.append(probe);
            const colour = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return colour;
        });
        expect(palette.background).toBe(inset);
        for (const selector of [
            ".achievement-search",
            ".achievement-version-button",
            ".checkbox-control",
            ".custom-select-button",
        ]) {
            const control = page.locator(selector).first();
            await expect(control).toHaveCSS("background-color", palette.background);
            await expect(control).toHaveCSS("border-color", palette.border);
        }
        for (const selector of [
            ".events-account-tab",
            ".events-layout-switch",
            ".events-limited-filter-button",
            ".events-custom-action",
        ]) {
            const control = page.locator(selector);
            expect(
                await control.evaluate((el) => {
                    const s = getComputedStyle(el, "::before");
                    return { background: s.backgroundColor, border: s.borderColor };
                }),
            ).toEqual(palette);
            await expect(control).toHaveCSS("transform", "none");
        }
        const border = await button.evaluate((el) => getComputedStyle(el, "::before").borderColor);
        for (const selector of [
            ".custom-select-button",
            '[aria-label="Character search"]',
            '[aria-label="Inventory search"]',
            ".cyrene-input",
        ]) {
            for (const control of await page.locator(selector).all()) {
                await control.focus();
                await expect(control).toHaveCSS("border-color", border);
                await expect(control).toHaveCSS("box-shadow", "none");
                await expect(control).toHaveCSS("outline-style", "none");
            }
        }
        await page.getByRole("textbox", { name: "Wrapped search", exact: true }).focus();
        await expect(page.locator(".custom-input-wrapper")).toHaveCSS("border-color", border);
        await expect(page.locator(".custom-input-wrapper")).toHaveCSS("box-shadow", "none");
        await page.emulateMedia({ reducedMotion: "reduce" });
        expect(
            await button.evaluate((el) => getComputedStyle(el, "::before").transitionDuration),
        ).toBe("0s");
        await page.screenshot({
            path: `test-results/shared-controls-${width}.png`,
            fullPage: true,
        });
    });
}
