import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const shell = (
    content: string,
) => `<html><head><link rel="stylesheet" href="/static/build/css/global.css"></head><body>
    ${["/", "/events", "/characters", "/inventory"].map((path) => `<a class="nav-item" href="${path}">${path}</a>`).join("")}
    <main class="main-content">${content}</main><script type="module" src="/static/build/js/app.js"></script></body></html>`;

test.beforeEach(async ({ page }) => {
    await page.route("**/static/build/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({
            contentType: path.endsWith(".css") ? "text/css" : "text/javascript",
            body:
                path.endsWith("/app.js") || path.endsWith("/global.css")
                    ? readFileSync(`website${path}`)
                    : "",
        });
    });
    await page.route("**/", (route) =>
        route.fulfill({ contentType: "text/html", body: shell("Home") }),
    );
});

test("Characters sidebar activates immediately and stays active while its scripts load", async ({
    page,
}) => {
    let releaseHtml!: () => void;
    const html = new Promise<void>((resolve) => (releaseHtml = resolve));
    let releaseScript!: () => void;
    const script = new Promise<void>((resolve) => (releaseScript = resolve));
    await page.route("**/characters", async (route) => {
        await html;
        await route.fulfill({ contentType: "text/html", body: shell("Characters ready") });
    });
    await page.route("**/characters/characters-talents.js?*", async (route) => {
        await script;
        await route.fulfill({ contentType: "text/javascript", body: "" });
    });
    await page.goto("/");
    await page.locator('a[href="/characters"]').click();
    await expect(page.locator('a[href="/characters"]')).toHaveClass(/active/);
    await expect(page.getByRole("status")).toContainText("Loading Characters");
    releaseHtml();
    await expect(page.locator(".main-content")).toHaveText("Characters ready");
    await expect(page.locator('a[href="/characters"]')).toHaveClass(/active/);
    await expect(page.getByRole("status")).toContainText("Loading Characters");
    releaseScript();
    await expect(page.getByRole("status")).toHaveCount(0);
});

test("overlapping API fetches retain feedback until the last request finishes", async ({
    page,
}) => {
    const releases: (() => void)[] = [];
    await page.route("**/api/test-*", async (route) => {
        await new Promise<void>((resolve) => releases.push(resolve));
        await route.fulfill({ json: { ok: true } });
    });
    await page.goto("/");
    await page.evaluate(() => {
        void fetch("/api/test-one");
        void fetch("/api/test-two");
    });
    await expect(page.getByRole("status")).toContainText("Loading Home");
    expect(releases).toHaveLength(2);
    releases[0]();
    await expect(page.getByRole("status")).toBeVisible();
    releases[1]();
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.locator(".main-content")).not.toHaveAttribute("aria-busy");
});

test("Inventory navigation and API fetches do not use the shared indicator", async ({ page }) => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/inventory", (route) =>
        route.fulfill({ contentType: "text/html", body: shell("Inventory ready") }),
    );
    await page.route("**/api/test-inventory", async (route) => {
        await wait;
        await route.fulfill({ json: {} });
    });
    await page.goto("/");
    await page.locator('a[href="/inventory"]').click();
    await expect(page.locator(".main-content")).toHaveText("Inventory ready");
    await page.evaluate(() => {
        void fetch("/api/test-inventory");
    });
    // Pass the short API-feedback delay while this request remains pending.
    await page.waitForTimeout(300);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(page.locator('a[href="/inventory"]')).toHaveClass(/active/);
    release();
});

test("failed and aborted API requests clear their feedback", async ({ page }) => {
    let fail!: () => void;
    const failed = new Promise<void>((resolve) => (fail = resolve));
    await page.route("**/api/test-fail", async (route) => {
        await failed;
        await route.abort();
    });
    await page.goto("/");
    await page.evaluate(() => {
        void fetch("/api/test-fail").catch(() => {});
    });
    await expect(page.getByRole("status")).toBeVisible();
    fail();
    await expect(page.getByRole("status")).toHaveCount(0);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/test-abort", async (route) => {
        await pending;
        await route.fulfill({ json: {} });
    });
    await page.evaluate(() => {
        const controller = new AbortController();
        document.addEventListener("abort-test", () => controller.abort(), { once: true });
        void fetch("/api/test-abort", { signal: controller.signal }).catch(() => {});
    });
    await expect(page.getByRole("status")).toBeVisible();
    await page.evaluate(() => document.dispatchEvent(new Event("abort-test")));
    await expect(page.getByRole("status")).toHaveCount(0);
    release();
});

test("background character prefetches stay silent", async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/api/characters/1/showcase", async (route) => {
        await pending;
        await route.fulfill({ json: {} });
    });
    await page.goto("/");
    await page.evaluate(() => {
        void fetch("/api/characters/1/showcase", { headers: { "X-Cyrene-Background": "1" } });
    });
    await page.waitForTimeout(300);
    await expect(page.getByRole("status")).toHaveCount(0);
    release();
});
