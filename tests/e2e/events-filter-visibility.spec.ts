import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const template = readFileSync("website/templates/base.html", "utf8");
const bootstrap = template.match(
    /<script id="limited-event-filter-bootstrap">([\s\S]*?)<\/script>/,
)![1];
const filters = readFileSync("website/static/build/browser/pages/events/events-filters.js", "utf8");

test("saved categories stay hidden before scripts load and during markup replacement", async ({
    page,
}) => {
    await page.addInitScript(() => {
        localStorage.setItem("cyrene-limited-hidden-categories-v1", '["TCG"]');
    });
    await page.route("**/events?*", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: `<html><head><script>${bootstrap}</script></head><body>
            <main class="events-page"><article data-limited-category="TCG" style="display:block">TCG</article>
            <article data-limited-category="Quest">Quest</article>
            <input type="checkbox" data-limited-filter-category="TCG"></main>
            <script>window.initialCategoryDisplay = getComputedStyle(document.querySelector('[data-limited-category="TCG"]')).display;</script>
            </body></html>`,
        }),
    );
    for (const accountId of [1, 2]) {
        await page.goto(`/events?account_id=${accountId}`);
        // This value is captured during parsing, before the deferred Events script.
        expect(await page.evaluate(() => (window as any).initialCategoryDisplay)).toBe("none");
        await page.addScriptTag({ content: filters });
        const replacementDisplay = await page.evaluate(() => {
            document.querySelector('[data-limited-category="TCG"]')!.outerHTML =
                '<article data-limited-category="TCG" style="display:block">Refreshed TCG</article>';
            // Inspect synchronously, before MutationObserver can set hidden.
            return getComputedStyle(document.querySelector('[data-limited-category="TCG"]')!)
                .display;
        });
        expect(replacementDisplay).toBe("none");
        await expect(page.locator('[data-limited-category="Quest"]')).toBeVisible();
    }
    await page.locator('input[data-limited-filter-category="TCG"]').check();
    await expect(page.locator('[data-limited-category="TCG"]')).toBeVisible();
    await page.locator('input[data-limited-filter-category="TCG"]').uncheck();
    await expect(page.locator('[data-limited-category="TCG"]')).toBeHidden();
});
