import { test, expect } from "@playwright/test";

const baseURL = process.env.CYRENE_TEST_URL;

test.describe("Cyrene website", () => {
    test.skip(!baseURL, "Set CYRENE_TEST_URL to the deployed website URL.");

    test("homepage responds successfully", async ({ page }) => {
        const response = await page.goto(baseURL!);

        expect(response).not.toBeNull();
        expect(response!.ok()).toBeTruthy();
    });

    test("page has a document title", async ({ page }) => {
        await page.goto(baseURL!);

        await expect(page).toHaveTitle(/.+/);
    });
});