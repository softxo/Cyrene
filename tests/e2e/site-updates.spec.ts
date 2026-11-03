import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

for (const width of [390, 1280]) {
    test(`Site update notification reloads the current page at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.clock.install();
        let version = "a".repeat(20);
        let offline = false;
        let documents = 0;
        await page.route("http://127.0.0.1:8000/**", async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.startsWith("/static/"))
                return route.fulfill({
                    body: readFileSync(`website${path}`),
                    contentType: path.endsWith(".css") ? "text/css" : "text/javascript",
                });
            if (path === "/api/site-version")
                return offline ? route.abort() : route.fulfill({ json: { version } });
            documents++;
            return route.fulfill({
                contentType: "text/html",
                body: `<!doctype html><html><head><meta name="cyrene-site-version" content="${version}"><link rel="stylesheet" href="/static/build/css/global.css"></head><body><main class="main-content">Current page</main><script type="module" src="/static/build/js/app.js"></script></body></html>`,
            });
        });
        await page.goto("http://127.0.0.1:8000/settings?view=test");
        const notice = page.getByRole("complementary", { name: "Site update" });
        await expect(notice).toHaveCount(0);
        offline = true;
        await page.clock.fastForward(61000);
        await expect(notice).toHaveCount(0);
        offline = false;
        version = "b".repeat(20);
        await page.clock.fastForward(61000);
        await expect(notice).toBeVisible();
        await expect(notice).toContainText("Update available");
        await expect(notice).toHaveCSS("box-shadow", "none");
        await notice.evaluate(async (el) => {
            await Promise.all(el.getAnimations().map((animation) => animation.finished));
        });
        const later = notice.getByRole("button", { name: "Later", exact: true });
        await expect(later).toHaveClass(/site-update-later/);
        const danger = await later.evaluate((el) => {
            const probe = document.createElement("span");
            probe.style.color = "var(--error)";
            el.append(probe);
            const colour = getComputedStyle(probe).color;
            probe.remove();
            return colour;
        });
        await expect(later).toHaveCSS("color", danger);
        await later.focus();
        await expect
            .poll(() => later.evaluate((el) => getComputedStyle(el, "::before").borderColor))
            .toBe(danger);
        await later.blur();
        const popupBounds = await notice.boundingBox();
        expect(Math.abs(popupBounds!.x + popupBounds!.width / 2 - width / 2)).toBeLessThan(1);
        expect(popupBounds!.y).toBe(16);

        for (const name of ["Later", "Update"]) {
            const button = notice.getByRole("button", { name, exact: true });

            const bounds = await button.boundingBox();
            await button.hover();
            await expect
                .poll(() =>
                    button.evaluate((el) => {
                        const matrix = new DOMMatrixReadOnly(
                            getComputedStyle(el, "::before").transform,
                        );
                        return (
                            Math.round(
                                ((1 - matrix.a) * el.getBoundingClientRect().width) / 2 - 1,
                            ) + "px"
                        );
                    }),
                )
                .toBe("0px");
            await expect(button).toHaveClass(/cyrene-button/);
            await expect(button).toHaveCSS("border-radius", "14px");
            await page.mouse.down();
            await expect
                .poll(() =>
                    button.evaluate((el) => {
                        const matrix = new DOMMatrixReadOnly(
                            getComputedStyle(el, "::before").transform,
                        );
                        return (
                            Math.round(
                                ((1 - matrix.a) * el.getBoundingClientRect().width) / 2 - 1,
                            ) + "px"
                        );
                    }),
                )
                .toBe("1px");
            await page.mouse.move(0, 0);
            await page.mouse.up();
            await expect
                .poll(() =>
                    button.evaluate((el) => {
                        const matrix = new DOMMatrixReadOnly(
                            getComputedStyle(el, "::before").transform,
                        );
                        return (
                            Math.round(
                                ((1 - matrix.a) * el.getBoundingClientRect().width) / 2 - 1,
                            ) + "px"
                        );
                    }),
                )
                .toBe("-1px");
            expect(await button.boundingBox()).toEqual(bounds);
        }
        expect(documents).toBe(1);
        await page.clock.fastForward(61000);
        await expect(notice).toHaveCount(1);
        await notice.getByRole("button", { name: "Later", exact: true }).click();
        await page.clock.fastForward(61000);
        await expect(notice).toBeHidden();
        const dot = page.getByRole("button", { name: "Show available update", exact: true });
        await expect(dot).toBeVisible();
        await expect(dot).toHaveText("Update");
        await expect(dot).toHaveCSS("box-shadow", "none");
        expect(await dot.evaluate((el) => getComputedStyle(el, "::before").animationName)).toBe(
            "site-update-breathe",
        );

        await expect(dot).toBeEnabled();
        await page.reload();
        await expect(dot).toBeVisible();
        await expect(notice).toBeHidden();
        await page.goto("http://127.0.0.1:8000/characters?view=test");
        await expect(dot).toBeVisible();
        await page.goto("http://127.0.0.1:8000/settings?view=test");
        await expect(dot).toBeVisible();

        const bounds = await dot.boundingBox();
        expect(Math.abs(bounds!.x + bounds!.width / 2 - width / 2)).toBeLessThan(1);
        await dot.click();
        await expect(notice).toBeVisible();
        await expect(dot).toHaveCount(0);
        await page.reload();
        await expect(notice).toBeVisible();
        await notice.getByRole("button", { name: "Later", exact: true }).click();
        await expect(dot).toBeVisible();
        await expect(dot).toBeEnabled();
        version = "c".repeat(20);
        await page.clock.fastForward(61000);
        await expect(notice).toBeVisible();
        await expect(dot).toHaveCount(0);
        await notice.screenshot({ path: `test-results/site-update-notice-${width}.png` });
        await page.reload();
        await expect(notice).toBeVisible();
        const beforeUpdate = documents;
        await notice.getByRole("button", { name: "Update", exact: true }).click();
        await expect.poll(() => documents).toBe(beforeUpdate + 1);
        await expect(page).toHaveURL("http://127.0.0.1:8000/settings?view=test");
        await expect(notice).toHaveCount(0);
        await expect(page.getByRole("status")).toContainText("Cyrene updated");
        await expect(page.locator(".site-update-success-icon svg use")).toHaveCount(1);
        await page
            .locator(".site-update-success")
            .screenshot({ path: `test-results/site-update-success-${width}.png` });
        await page.reload();
        await expect(page.locator(".site-update-success")).toHaveCount(0);
    });
}
