import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const python = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
const pages: Record<string, string> = JSON.parse(
    execFileSync(
        python,
        [
            "-X",
            "utf8",
            "-c",
            `
import json
from starlette.requests import Request
from utils.web.app import templates
pages={}
for path,name in [('characters','characters'),('weapons','weapons'),('inventory','inventory'),('planner','planner'),('events','events'),('achievements','achievements'),('wishes','wishes'),('codes','codes'),('settings','settings')]:
 request=Request({'type':'http','method':'GET','path':'/'+path,'headers':[],'scheme':'http','server':('127.0.0.1',8000),'query_string':b''})
 pages['/'+path]=templates.env.get_template(name+'.html').render(request=request,accounts=[])
print(json.dumps(pages))
`,
        ],
        { encoding: "utf8" },
    ),
);

test("Events refresh replaces stale cards when the last account is removed", async ({ page }) => {
    await page.route("http://127.0.0.1:8000/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.startsWith("/static/"))
            return route.fulfill({
                body: readFileSync(`website${path}`),
                contentType: path.endsWith(".css") ? "text/css" : "text/javascript",
            });
        if (path === "/events/refresh")
            return route.fulfill({ body: pages["/events"], contentType: "text/html" });
        return route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html><head><link rel="stylesheet" href="/static/build/css/global.css"></head><body><main class="main-content"><div class="page events-page" data-account-id="1"><p>Stale event cards</p></div></main><script src="/static/build/browser/pages/events/events-refresh.js"></script></body></html>`,
        });
    });
    await page.goto("http://127.0.0.1:8000/events");
    await page.evaluate(async () => {
        await (window as unknown as { refreshEvents: () => Promise<void> }).refreshEvents();
    });
    await expect(
        page.getByRole("heading", { name: "No accounts added", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Stale event cards")).toHaveCount(0);
});

for (const width of [390, 1280]) {
    test(`All account pages use one empty view at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        const accountCalls: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("http://127.0.0.1:8000/**", async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.startsWith("/static/"))
                return route.fulfill({
                    body: readFileSync(`website${path}`),
                    contentType: path.endsWith(".css")
                        ? "text/css"
                        : path.endsWith(".js")
                          ? "text/javascript"
                          : "image/png",
                });
            if (path.startsWith("/api/")) {
                if (path !== "/api/site-version") accountCalls.push(path);
                return route.fulfill({
                    json: path === "/api/auth/status" ? { authenticated: true, user_id: 7 } : [],
                });
            }
            return route.fulfill({
                body: pages[path] || pages["/settings"],
                contentType: "text/html",
            });
        });
        let dimensions: { width: number; height: number } | null = null;
        for (const path of Object.keys(pages).filter((path) => path !== "/settings")) {
            if (!dimensions) await page.goto(`http://127.0.0.1:8000${path}`);
            else {
                await page
                    .locator(`.sidebar a[href="${path}"]`)
                    .first()
                    .evaluate((link: HTMLAnchorElement) => link.click());
                await expect(page).toHaveURL(`http://127.0.0.1:8000${path}`);
            }
            await expect(page.locator("[data-no-accounts]")).toHaveCount(1);
            await expect(
                page.getByRole("heading", { name: "No accounts added", exact: true }),
            ).toBeVisible();
            await expect(
                page.getByRole("link", { name: "Add account", exact: true }),
            ).toHaveAttribute("href", "/settings");
            const bounds = (await page.locator(".no-accounts-card").boundingBox())!;
            if (!dimensions) dimensions = { width: bounds.width, height: bounds.height };
            expect(bounds.width).toBe(dimensions.width);
            expect(bounds.height).toBe(dimensions.height);
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        }
        expect(accountCalls).toEqual([]);
        await page
            .locator(".no-accounts-card")
            .screenshot({ path: `test-results/no-accounts-${width}.png` });
        await page.getByRole("link", { name: "Add account", exact: true }).click();
        await expect(page).toHaveURL("http://127.0.0.1:8000/settings");
        await expect(page.locator("[data-no-accounts]")).toHaveCount(0);
        await expect(
            page.getByRole("heading", { name: "HoYoLAB Accounts", exact: true }),
        ).toBeVisible();
        expect(errors).toEqual([]);
    });
}
