import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const shell = (content: string) =>
    `<html><head><link rel="stylesheet" href="/static/build/css/global.css"></head><body><a class="nav-item" href="/events"><span class="nav-icon">?</span>Events</a><a href="/other">Other</a><main class="main-content">${content}</main><script type="module" src="/static/build/js/app.js"></script></body></html>`;

test("Events gives immediate feedback and clears it after loading", async ({ page }) => {
    await page.route("**/static/build/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        const body =
            path.endsWith("/app.js") || path.endsWith("/global.css")
                ? readFileSync(`website${path}`)
                : "";
        return route.fulfill({
            contentType: path.endsWith(".css") ? "text/css" : "text/javascript",
            body,
        });
    });
    await page.route("**/", (route) =>
        route.fulfill({ contentType: "text/html", body: shell("Home") }),
    );
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/events", async (route) => {
        await pending;
        await route.fulfill({ contentType: "text/html", body: shell("Events ready") });
    });
    await page.goto("/");
    await page.locator('a[href="/events"]').click();
    await expect(page.getByRole("status")).toContainText("Loading Events");
    await expect(page.locator(".main-content")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator(".nav-item")).toHaveClass(/is-loading/);
    release();
    await expect(page.locator(".main-content")).toHaveText("Events ready");
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.locator(".main-content")).not.toHaveAttribute("aria-busy");
});

test("leaving during a slow Events request cancels the pending navigation", async ({ page }) => {
    await page.route("**/static/build/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({
            contentType: path.endsWith(".css") ? "text/css" : "text/javascript",
            body: path.endsWith("/app.js") ? readFileSync(`website${path}`) : "",
        });
    });
    await page.route("**/", (route) =>
        route.fulfill({ contentType: "text/html", body: shell("Home") }),
    );
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/events", async (route) => {
        await pending;
        await route.fulfill({ contentType: "text/html", body: shell("Events ready") });
    });
    await page.route("**/other", (route) =>
        route.fulfill({ contentType: "text/html", body: shell("Other page") }),
    );
    await page.goto("/");
    await page.locator('a[href="/events"]').click();
    await expect(page.getByRole("status")).toBeVisible();
    await page.locator('a[href="/other"]').click();
    await expect(page.locator(".main-content")).toHaveText("Other page");
    release();
    await expect(page).toHaveURL(/\/other$/);
    await expect(page.getByRole("status")).toHaveCount(0);
});
