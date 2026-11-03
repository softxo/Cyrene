import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({ channel: process.env.CYRENE_ICON_BROWSER === "edge" ? "msedge" : undefined });

for (const reducedMotion of ["no-preference", "reduce"] as const) {
    test(`shared modal motion for native dialogs and overlay panels (${reducedMotion})`, async ({
        page,
    }) => {
        await page.emulateMedia({ reducedMotion });
        await page.setContent(`<style>${readFileSync("website/src/styles/components/modals.css", "utf8")}
            [data-modal-shell] { position: fixed; inset: 0; display: grid; place-items: center; }
            [hidden] { display: none !important; }
            [aria-modal] { background: white; padding: 20px; }
            </style><dialog><p>Native modal</p><span data-fixed-icon style="display:inline-block;width:24px;height:24px"></span></dialog>
            <div data-modal-shell hidden><div class="test-backdrop"></div><section role="dialog" aria-modal="true">Overlay modal<span data-fixed-icon style="display:inline-block;width:24px;height:24px"></span></section></div>`);
        for (const selector of ["dialog", "[data-modal-shell]"]) {
            const opening = await page.evaluate((selector) => {
                const root = document.querySelector(selector) as HTMLElement;
                const panel = root.querySelector<HTMLElement>("[aria-modal]") || root;
                void getComputedStyle(root).display;
                if (root instanceof HTMLDialogElement) root.showModal();
                else root.hidden = false;
                const style = getComputedStyle(panel);
                const backdrop =
                    root instanceof HTMLDialogElement
                        ? getComputedStyle(root, "::backdrop")
                        : getComputedStyle(root.querySelector(".test-backdrop")!);
                return {
                    duration: style.transitionDuration,
                    animations: panel.getAnimations().length,
                    iconWidth: root.querySelector("[data-fixed-icon]")!.getBoundingClientRect()
                        .width,
                    blur: backdrop.backdropFilter,
                };
            }, selector);
            if (reducedMotion === "reduce") expect(opening.duration).toBe("0s");
            else {
                expect(opening.duration).toContain("0.22s");
                expect(opening.animations).toBeGreaterThan(0);
                expect(opening.blur).toBe("blur(0px)");
            }
            expect(opening.iconWidth).toBe(24);
            await page.evaluate(async (selector) => {
                const root = document.querySelector(selector)!;
                await Promise.all(
                    root.getAnimations({ subtree: true }).map((animation) => animation.finished),
                );
            }, selector);
            const settled = await page.evaluate((selector) => {
                const root = document.querySelector(selector)!;
                return {
                    iconWidth: root.querySelector("[data-fixed-icon]")!.getBoundingClientRect()
                        .width,
                    blur: (root instanceof HTMLDialogElement
                        ? getComputedStyle(root, "::backdrop")
                        : getComputedStyle(root.querySelector(".test-backdrop")!)
                    ).backdropFilter,
                };
            }, selector);
            expect(settled.iconWidth).toBe(24);
            expect(settled.blur).toBe("blur(6px)");
            const closing = await page.evaluate((selector) => {
                const root = document.querySelector(selector) as HTMLElement;
                const panel = root.querySelector<HTMLElement>("[aria-modal]") || root;
                if (root instanceof HTMLDialogElement) root.close();
                else root.hidden = true;
                return getComputedStyle(panel).transitionDuration;
            }, selector);
            expect(closing).toContain(reducedMotion === "reduce" ? "0s" : "0.18s");
            await expect(page.locator(selector)).toBeHidden();
        }
    });
}
