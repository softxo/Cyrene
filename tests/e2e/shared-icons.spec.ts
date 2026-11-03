import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test.use({ channel: process.env.CYRENE_ICON_BROWSER === "edge" ? "msedge" : undefined });

test("shared SVG checks load for animated verification, badges, Events and toasts", async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("**/static/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({
            body: readFileSync(`website${path}`),
            contentType: path.endsWith(".svg")
                ? "image/svg+xml"
                : path.endsWith(".css")
                  ? "text/css"
                  : "text/javascript",
        });
    });
    await page.route("**/icon-preview", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: `
        <html><head><link rel="stylesheet" href="/static/build/css/global.css">
        <link rel="stylesheet" href="/static/build/css/verification.css">
        <link rel="stylesheet" href="/static/build/css/events.css"></head><body>
        <div style="padding:24px;display:flex;align-items:center;gap:24px">
        <span class="cyrene-check" style="--check-size:24px" aria-label="Complete"></span>
        <span class="cyrene-arrow" style="--arrow-size:24px" aria-label="To goal"></span>
        <span class="cyrene-arrow cyrene-arrow--left" style="--arrow-size:24px" aria-label="Back"></span>
        <button aria-label="Close modal" style="display:grid;place-items:center;width:38px;height:38px;padding:0;border:1px solid;border-radius:12px;font-size:32px"><span class="cyrene-close" aria-hidden="true"></span></button>
        <div class="verified-icon"><svg class="verified-check" viewBox="0 0 24 24"><use href="/static/images/ui/check.svg#check"></use></svg></div>
        <button class="event-checkmark" aria-label="Claimed"></button></div>
        <script type="module" src="/static/build/browser/core/toasts.js"></script>
        </body></html>`,
        }),
    );
    await page.goto("/icon-preview");
    const closeIcon = page.getByRole("button", { name: "Close modal" }).locator(".cyrene-close");
    await expect(closeIcon).toHaveCSS("mask-image", /close\.svg/);
    const buttonBox = await page.getByRole("button", { name: "Close modal" }).boundingBox();
    const iconBox = await closeIcon.boundingBox();
    expect(
        Math.abs(iconBox!.x + iconBox!.width / 2 - buttonBox!.x - buttonBox!.width / 2),
    ).toBeLessThan(1);
    expect(
        Math.abs(iconBox!.y + iconBox!.height / 2 - buttonBox!.y - buttonBox!.height / 2),
    ).toBeLessThan(1);
    await expect
        .poll(() =>
            page
                .locator(".verified-check use")
                .evaluate((use: SVGGraphicsElement) => use.getBBox().width),
        )
        .toBeGreaterThan(10);
    await expect(page.locator(".verified-check use")).toHaveCSS("stroke-dashoffset", "0px");
    await page.evaluate(() => window.showCyreneToast("Plan saved."));
    await expect(page.locator(".cyrene-toast")).toHaveCSS("opacity", "1");
    const alpha = await page.locator(".cyrene-toast").evaluate((toast) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = getComputedStyle(toast).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        return context.getImageData(0, 0, 1, 1).data[3];
    });
    expect(alpha).toBe(255);
    await expect(page.locator(".cyrene-toast-icon use")).toHaveAttribute(
        "href",
        "/static/images/ui/check.svg#check",
    );
    await expect
        .poll(() =>
            page
                .locator(".cyrene-toast-icon use")
                .evaluate((use: SVGGraphicsElement) => use.getBBox().width),
        )
        .toBeGreaterThan(10);
    await expect(page.locator(".cyrene-check")).toHaveCSS("mask-image", /check\.svg/);
    await expect(page.locator(".cyrene-arrow").first()).toHaveCSS("mask-image", /arrow-right\.svg/);
    await page.screenshot({ path: "test-results/shared-icons.png", animations: "disabled" });
});
