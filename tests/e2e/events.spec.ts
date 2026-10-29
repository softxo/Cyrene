import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const script = (name: string) =>
    readFileSync(`website/static/build/browser/pages/events/${name}.js`, "utf8");
const fixture = (overview = false, tab = "all", value = "old") => `
<style>[hidden]{display:none}.events-overview-panel{display:none}.events-overview-panel.active{display:block}</style>
<div class="events-page" data-overview="${overview}" data-account-id="1">
<a class="events-layout-switch" href="/events?${overview ? "" : "overview=true&"}account_id=1">Layout</a>
${
    overview
        ? ["daily", "wishes"]
              .map(
                  (t) =>
                      `<button class="events-overview-tab ${t === "daily" ? "active" : ""}" data-overview-tab="${t}">${t}</button><section class="events-overview-panel" data-overview-panel="${t}">${value}</section>`,
              )
              .join("")
        : `
${["all", "permanent", "wishes"].map((t) => `<button class="events-account-tab ${t === tab ? "active" : ""}" data-account-tab="${t}">${t}</button>`).join("")}
<section class="events-list" data-account-category="permanent" ${tab === "wishes" ? "hidden" : ""}>${value}</section>
<section class="events-wishes" data-account-category="wishes" ${tab !== "wishes" ? "hidden" : ""}>${value}</section>`
}
</div>`;

async function setup(page, overview = false) {
    await page.route("**/events?*", (route) =>
        route.fulfill({ contentType: "text/html", body: fixture(overview) }),
    );
    await page.route("**/events", (route) =>
        route.fulfill({ contentType: "text/html", body: fixture(overview) }),
    );
    await page.goto("/events");
    await page.evaluate(() => {
        localStorage.setItem("cyreneAccountEventTab", "wishes");
        localStorage.setItem("cyreneOverviewTab", "wishes");
    });
    await page.addScriptTag({ content: script("events-tabs") });
    await page.addScriptTag({ content: script("events-refresh") });
    await page.evaluate(() => {
        window.initialiseAccountTabs();
        window.initialiseOverviewTabs();
    });
}

test("fresh Events visits ignore old storage; reload and layout links retain this visit", async ({
    page,
}) => {
    await setup(page);
    await expect(page.locator('[data-account-tab="all"]')).toHaveClass(/active/);
    await page.locator('[data-account-tab="wishes"]').click();
    await expect(page.locator(".events-layout-switch")).toHaveAttribute("href", /tab=wishes/);
    await page.reload();
    await page.addScriptTag({ content: script("events-tabs") });
    await page.evaluate(() => window.initialiseAccountTabs());
    await expect(page.locator(".events-wishes")).toBeVisible();
    await page.goto("/events");
    await page.addScriptTag({ content: script("events-tabs") });
    await page.evaluate(() => window.initialiseAccountTabs());
    await expect(page.locator('[data-account-tab="all"]')).toHaveClass(/active/);
});

for (const overview of [false, true]) {
    test(`refresh arriving after tab switch preserves selection (${overview ? "overview" : "normal"})`, async ({
        page,
    }) => {
        await setup(page, overview);
        let release!: () => void;
        const pending = new Promise<void>((resolve) => (release = resolve));
        await page.route("**/events/refresh?*", async (route) => {
            await pending;
            await route.fulfill({
                contentType: "text/html",
                body: fixture(overview, "all", "updated"),
            });
        });
        await page.evaluate(() => {
            window.refreshPromise = window.refreshEvents();
        });
        await expect.poll(() => page.evaluate(() => window.eventsRefreshing)).toBe(true);
        await page
            .locator(overview ? '[data-overview-tab="wishes"]' : '[data-account-tab="wishes"]')
            .click();
        release();
        await page.evaluate(() => window.refreshPromise);
        const wishes = page.locator(overview ? '[data-overview-panel="wishes"]' : ".events-wishes");
        await expect(wishes).toBeVisible();
        await expect(wishes).toHaveText("updated");
        await expect(
            page.locator(overview ? '[data-overview-panel="daily"]' : ".events-list"),
        ).toBeHidden();
    });
}

test("layout round trip and account change retain the normal tab", async ({ page }) => {
    await setup(page);
    await page.locator('[data-account-tab="wishes"]').click();
    await page.route("**/events?*", (route) => {
        const overview = new URL(route.request().url()).searchParams.has("overview");
        return route.fulfill({ contentType: "text/html", body: fixture(overview) });
    });
    await page.locator(".events-layout-switch").click();
    await page.addScriptTag({ content: script("events-tabs") });
    await page.evaluate(() => window.initialiseOverviewTabs());
    await page.locator('[data-overview-tab="wishes"]').click();
    await page.locator(".events-layout-switch").click();
    await page.addScriptTag({ content: script("events-tabs") });
    await page.evaluate(() => window.initialiseAccountTabs());
    await expect(page.locator(".events-wishes")).toBeVisible();
    await page
        .locator(".events-page")
        .evaluate((el) =>
            el.insertAdjacentHTML(
                "beforeend",
                `<div id="events-account"><button class="custom-select-button">Account</button><button class="custom-select-option" data-account-id="2">Second account</button></div>`,
            ),
        );
    await page.addScriptTag({ content: script("events-dropdown") });
    await page.evaluate(() => window.initialiseEventsDropdown());
    await page.locator(".custom-select-option").click();
    await expect(page).toHaveURL(/account_id=2/);
    await page.addScriptTag({ content: script("events-tabs") });
    await page.evaluate(() => window.initialiseAccountTabs());
    await expect(page.locator(".events-wishes")).toBeVisible();
});
