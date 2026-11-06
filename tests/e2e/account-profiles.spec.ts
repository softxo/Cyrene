import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

for (const width of [390, 1485]) {
    test(`Open account labels and AR refresh without changing drafts at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.clock.install();
        let nickname = "Old name";
        let level = 50;
        let calls = 0;
        await page.route("http://profiles.test/api/hoyolab/accounts", (route) => {
            calls++;
            return route.fulfill({
                json: {
                    accounts: [{ id: 1, uid: "123", nickname, cyrene_nickname: "My alias", level }],
                },
            });
        });
        await page.route("http://profiles.test/", (route) =>
            route.fulfill({
                contentType: "text/html",
                body: `
            <div class="custom-select"><button class="custom-select-button"><span>Old name ? 123</span></button>
                <button class="custom-select-option selected"><span data-account-profile-name="123">Old name</span> ? 123</button></div>
            <h2 data-account-profile-name="123" data-account-profile-field="display">My alias</h2>
            <strong data-account-profile-rank="123">50</strong>
            <span data-account-profile-meta="123">UID 123 ? AR 50</span>
            <button data-account-profile-label="123" data-account-profile-old-name="Old name" data-label="Old name ? 123">Choose account</button>
            <button data-account-profile-aria="123" data-account-profile-old-name="Old name" aria-label="Mark complete for Old name">Complete</button>
            <input id="draft" value="Unsaved plan">
        `,
            }),
        );
        await page.goto("http://profiles.test/");
        const script = readFileSync(
            "website/static/build/browser/core/account-profiles.js",
            "utf8",
        ).replaceAll("export function", "function");
        await page.addScriptTag({ content: script + "\ninitialiseAccountProfiles();" });
        await expect.poll(() => calls).toBe(1);
        await expect(page.locator("[data-account-profile-rank]")).toHaveText("50");
        nickname = "New <name>";
        level = 56;
        await page.locator("#draft").fill("Keep this draft");
        await page.clock.runFor(60_000);
        await expect(page.locator(".custom-select-option [data-account-profile-name]")).toHaveText(
            nickname,
        );
        await expect(page.locator(".custom-select-button span")).toHaveText("New <name> ? 123");
        await expect(page.locator("[data-account-profile-rank]")).toHaveText("56");
        await expect(page.locator("[data-account-profile-meta]")).toHaveText("UID 123 | AR 56");
        await expect(page.locator("h2")).toHaveText("My alias");
        await expect(page.locator("[data-account-profile-label]")).toHaveAttribute(
            "data-label",
            "My alias ? 123",
        );
        await expect(page.locator("[data-account-profile-aria]")).toHaveAttribute(
            "aria-label",
            "Mark complete for My alias",
        );
        await expect(page.locator("#draft")).toHaveValue("Keep this draft");
        expect(await page.locator("name").count()).toBe(0);
        await page.evaluate(() => {
            const name = document.createElement("span");
            name.dataset.accountProfileName = "123";
            name.id = "navigated-name";
            name.textContent = "Stale markup";
            document.body.appendChild(name);
        });
        await expect(page.locator("#navigated-name")).toHaveText(nickname);
    });
}

test("Cyrene aliases update dropdowns immediately while game names refresh separately", async ({
    page,
}) => {
    let alias: string | null = "Melody";
    let nickname = "melody";
    await page.route("http://profiles.test/api/hoyolab/accounts", (route) =>
        route.fulfill({
            json: { accounts: [{ uid: "123", nickname, cyrene_nickname: alias, level: 60 }] },
        }),
    );
    await page.route("http://profiles.test/", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: `<div class="custom-select"><button class="custom-select-button"><span><span data-account-profile-name="123" data-account-profile-field="display">melody</span> ? 123</span></button><button class="custom-select-option selected"><span data-account-profile-name="123" data-account-profile-field="display">melody</span></button></div><div id="overview" data-account-profile-name="123" data-account-profile-field="display">melody</div><div id="game" data-account-profile-name="123" data-account-profile-field="nickname">melody</div>`,
        }),
    );
    await page.goto("http://profiles.test/");
    const source = readFileSync(
        "website/static/build/browser/core/account-profiles.js",
        "utf8",
    ).replaceAll("export function", "function");
    await page.addScriptTag({ content: source + "\ninitialiseAccountProfiles();" });
    await expect(page.locator("#overview")).toHaveText("Melody");
    nickname = "Mellow";
    await page.evaluate(() => document.dispatchEvent(new Event("cyrene:account-renamed")));
    await expect(page.locator("#game")).toHaveText("Mellow");
    await expect(page.locator(".custom-select-option span")).toHaveText("Melody");
    await expect(page.locator("#overview")).toHaveText("Melody");
    alias = null;
    await page.evaluate(() => document.dispatchEvent(new Event("cyrene:account-renamed")));
    await expect(page.locator("#overview")).toHaveText("Mellow");
    await expect(page.locator(".custom-select-button")).toHaveText("Mellow ? 123");
});
