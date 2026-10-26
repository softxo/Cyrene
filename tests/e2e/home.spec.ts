import { expect, test } from "@playwright/test";

test("homepage loads successfully", async ({ page }) => {
    const response = await page.goto("/");

    expect(response).not.toBeNull();
    expect(response?.status()).toBeLessThan(400);

    await expect(page.locator("body")).toBeVisible();
});

test("homepage contains no broken internal navigation links", async ({ page }) => {
    await page.goto("/");

    const links = page.locator('a[href^="/"]');
    const count = await links.count();

    for (let index = 0; index < count; index++) {
        const href = await links.nth(index).getAttribute("href");

        if (!href || href.startsWith("//")) {
            continue;
        }

        const response = await page.request.get(href);

        expect(response.status(), `Broken link: ${href}`).toBeLessThan(400);
    }
});