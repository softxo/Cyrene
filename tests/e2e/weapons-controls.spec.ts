import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const python = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
const html = execFileSync(
    python,
    [
        "-X",
        "utf8",
        "-c",
        `
from utils.web.app import templates
from starlette.requests import Request
r=Request({'type':'http','path':'/weapons','headers':[],'query_string':b''}); r.path='/weapons'
print(templates.get_template('weapons.html').render(request=r,accounts=[{'id':1,'nickname':'Test','genshin_uid':123}],selected_account={'id':1,'nickname':'Test','genshin_uid':123}))
`,
    ],
    { encoding: "utf8" },
);

test.beforeEach(async ({ page }) => {
    const weapons = Array.from({ length: 255 }, (_, i) => ({
        id: i + 1,
        name: i === 1 ? "Absolution" : `Weapon ${i}`,
        rarity: i === 0 ? 2 : 4,
        type: "Catalyst",
        icon: "https://assets.test/icon.svg",
        level: 70,
        refinement: 2,
        equipped: "Character",
        character_rarity: 5,
        character_icon: "https://assets.test/icon.svg",
        tag: {
            label:
                i === 1 ? "Clorinde's Signature" : "A character with a very long name's Signature",
            kind: "signature",
            source: "Gacha",
        },
    }));
    await page.route("**/static/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({
            body: readFileSync(`website${path}`),
            contentType: path.endsWith(".css")
                ? "text/css"
                : path.endsWith(".webp")
                  ? "image/webp"
                  : "text/javascript",
        });
    });
    await page.route("https://assets.test/**", (route) =>
        route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="24" fill="#abc"/></svg>',
        }),
    );
    await page.route("**/api/weapons?*", (route) =>
        route.fulfill({ json: { owned: weapons, catalogue: weapons } }),
    );
    await page.route("**/api/weapons/manual?*", (route) =>
        route.fulfill({ json: { weapons: [] } }),
    );
    await page.route("**/weapons", (route) =>
        route.fulfill({ contentType: "text/html", body: html }),
    );
    await page.route("**/characters", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: '<html><body><main class="main-content">Characters</main></body></html>',
        }),
    );
    await page.route("**/api/weapons/scanned?*", (route) =>
        route.fulfill({ json: { weapons: [] } }),
    );
    await page.goto("/weapons");
    await expect(page.locator(".weapon-card")).toHaveCount(255);
});

test("level choices follow ascension caps and clicking the trigger again closes the popup", async ({
    page,
}) => {
    await page.locator('[data-weapons-tab="catalogue"]').click();
    const addAction = page.getByRole("button", { name: "Add to Owned", exact: true }).first();
    await expect(addAction).toHaveClass(/cyrene-button/);
    expect(await addAction.evaluate((el) => getComputedStyle(el, "::before").borderStyle)).toBe(
        "solid",
    );
    await page
        .locator(".weapon-card")
        .filter({ has: page.getByRole("heading", { name: "Weapon 0", exact: true }) })
        .getByRole("button", { name: "Add to Owned", exact: true })
        .click();
    const trigger = page.locator('[data-weapon-choice="level"]');
    await trigger.click();
    await expect(page.locator(".planner-choice-option")).toHaveText([
        "Lv. 1",
        "Lv. 20",
        "Lv. 40",
        "Lv. 50",
        "Lv. 60",
        "Lv. 70",
    ]);
    await trigger.click();
    await expect(page.locator("#weapon-choice-popup")).not.toBeVisible();
    await trigger.click();
    await page.getByRole("button", { name: "Lv. 70", exact: true }).click();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Add to Owned", exact: true }).nth(1).click();
    await trigger.click();
    await expect(page.locator(".planner-choice-option")).toHaveText([
        "Lv. 1",
        "Lv. 20",
        "Lv. 40",
        "Lv. 50",
        "Lv. 60",
        "Lv. 70",
        "Lv. 80",
        "Lv. 90",
    ]);
    await page.keyboard.press("Escape");
    const refinement = page.locator('[data-weapon-choice="refinement"]');
    await refinement.click();
    await refinement.click();
    await expect(page.locator("#weapon-choice-popup")).not.toBeVisible();
});

test("filtering reuses cards and releases the page when navigating away", async ({ page }) => {
    const first = await page.locator(".weapon-card").first().elementHandle();
    await page.locator("[data-weapons-search]").fill("Weapon 0");
    await expect(page.locator(".weapon-card:visible")).toHaveCount(1);
    expect(await first!.evaluate((node) => node === document.querySelector(".weapon-card"))).toBe(
        true,
    );
    await page.locator("[data-weapons-search]").fill("");
    await expect(page.locator(".weapon-card:visible")).toHaveCount(255);
    await page.locator('a[href="/characters"]').click();
    await expect(page.locator(".main-content")).toHaveText("Characters");
    expect(await page.evaluate(() => typeof window.disposeWeapons)).toBe("undefined");
});

test("tags stay compact and centred, with character rarity independent of weapon rarity", async ({
    page,
}) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const card = page.locator(".weapon-card").first();
    const tag = card.locator(".weapon-tag");
    await expect(tag).toHaveCSS("white-space", "normal");
    await expect(tag).not.toHaveCSS("text-overflow", "ellipsis");
    const bounds = await tag.boundingBox();
    const body = await card.locator(".weapon-body").boundingBox();
    expect(bounds!.height).toBeLessThan(76);
    expect(Math.abs(bounds!.x + bounds!.width / 2 - body!.x - body!.width / 2)).toBeLessThan(1);
    expect(body!.y + body!.height - bounds!.y - bounds!.height).toBeLessThanOrEqual(9);
    await expect(card.locator(".weapon-character")).toHaveAttribute("data-rarity", "5");
    expect((await card.locator(".weapon-character").boundingBox())!.height).toBeGreaterThanOrEqual(
        38,
    );
    expect((await card.locator(".weapon-refinement").boundingBox())!.height).toBeLessThan(30);
    await expect(page.locator(".weapons-help-trigger")).toHaveCSS("height", "16px");
    await expect(page.locator(".weapons-help-trigger")).toHaveCSS("width", "16px");
});

test("modal closes on backdrop click and help uses the Events anchored popover", async ({
    page,
}) => {
    await page.locator(".weapons-help-trigger").hover();
    const help = page.locator("#weapons-data-help");
    await expect(help).toHaveClass(/is-visible/);
    await expect(help).toHaveAttribute("data-side", "top");
    await expect(help).toHaveCSS("position", "fixed");
    await page.keyboard.press("Escape");
    await expect(help).not.toBeVisible();
    await page.locator('[data-weapons-tab="catalogue"]').click();
    await page
        .locator(".weapon-card")
        .filter({ has: page.getByRole("heading", { name: "Weapon 0", exact: true }) })
        .getByRole("button", { name: "Add to Owned", exact: true })
        .click();
    await page.locator('[data-weapon-choice="level"]').click();
    await page.getByRole("button", { name: "Lv. 1", exact: true }).click();
    await page.locator("#weapon-add-title").click();
    await expect(page.locator("[data-weapon-dialog]")).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(page.locator("[data-weapon-dialog]")).not.toBeVisible();
});

test("mixed weapon names and tags keep card bottoms aligned", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page
        .locator(".weapon-card")
        .nth(1)
        .locator("h2")
        .evaluate((el) => {
            el.textContent = "Tome of the Eternal Flow";
        });
    await page
        .locator(".weapon-card")
        .nth(2)
        .locator(".weapon-tag")
        .evaluate((el) => {
            el.textContent = "Gacha";
        });
    const boxes = await page.locator(".weapon-card").evaluateAll((cards) =>
        cards.slice(0, 6).map((card) => {
            const r = card.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom };
        }),
    );
    for (const box of boxes.filter((box) => box.top === boxes[0].top))
        expect(Math.abs(box.bottom - boxes[0].bottom)).toBeLessThan(1);
});

test("search finds signature owners and uses a compact focus indicator", async ({ page }) => {
    const search = page.locator("[data-weapons-search]");
    await search.fill("clorinde");
    await expect(page.locator(".weapon-card:visible h2")).toHaveText(["Absolution"]);
    await expect(search).toHaveCSS("outline-style", "none");
    await page.locator('[data-weapons-tab="catalogue"]').click();
    await expect(page.locator(".weapon-card:visible h2")).toHaveText(["Absolution"]);
    await search.fill("ABSOLUTION");
    await expect(page.locator(".weapon-card:visible h2")).toHaveText(["Absolution"]);
});

test("owned order uses rarity then level with release ties across all sources", async ({
    page,
}) => {
    const base = { icon: "https://assets.test/icon.svg", type: "Sword", level: 90, refinement: 1 };
    await page.route("**/api/weapons?*", (route) =>
        route.fulfill({
            json: {
                owned: [
                    { ...base, id: 1, name: "Older five-star", rarity: 5, release_version: "6.9" },
                    { ...base, id: 2, name: "New four-star", rarity: 4, release_version: "7.1" },
                    { ...base, id: 3, name: "Newest five-star", rarity: 5, release_version: "7.0" },
                    {
                        ...base,
                        id: 5,
                        name: "Low five-star",
                        rarity: 5,
                        level: 1,
                        release_version: "8.0",
                    },
                    {
                        ...base,
                        id: 6,
                        name: "Low four-star",
                        rarity: 4,
                        level: 30,
                        release_version: "8.0",
                    },
                ],
                catalogue: [],
            },
        }),
    );
    await page.route("**/api/weapons/manual?*", (route) =>
        route.fulfill({
            json: {
                weapons: [
                    {
                        ...base,
                        id: 4,
                        copy_id: "manual",
                        name: "Manual five-star",
                        level: 80,
                        rarity: 5,
                        release_version: "6.10",
                    },
                ],
            },
        }),
    );
    await page.route("**/api/weapons/scanned?*", (route) =>
        route.fulfill({
            json: {
                weapons: [
                    {
                        ...base,
                        id: 7,
                        name: "Imported three-star",
                        rarity: 3,
                        level: 50,
                        scan_copy_id: "sort:0",
                    },
                ],
            },
        }),
    );
    await page.locator("[data-weapons-retry]").click();
    await expect(page.locator(".weapon-card h2")).toHaveText([
        "Newest five-star",
        "Older five-star",
        "Manual five-star",
        "Low five-star",
        "New four-star",
        "Low four-star",
        "Imported three-star",
    ]);
});

test("manual marker reveals deletion and requires confirmation", async ({ page }) => {
    let deletes = 0;
    await page.route("**/api/weapons/manual?*", (route) =>
        route.fulfill({
            json: {
                weapons: [
                    {
                        id: 1000,
                        copy_id: "copy-to-delete",
                        name: "Manual weapon",
                        rarity: 5,
                        type: "Sword",
                        icon: "https://assets.test/icon.svg",
                        level: 70,
                        refinement: 1,
                    },
                ],
            },
        }),
    );
    await page.route("**/api/weapons/manual/copy-to-delete?*", (route) => {
        deletes++;
        return route.fulfill({ json: { ok: true } });
    });
    await page.locator("[data-weapons-retry]").click();
    const card = page
        .locator(".weapon-card")
        .filter({ has: page.getByRole("heading", { name: "Manual weapon", exact: true }) });
    const marker = card.getByRole("button", { name: "Manually added weapon options" });
    await expect(card.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
    await marker.hover();
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator("[data-weapon-delete-dialog]")).toBeVisible();
    expect(deletes).toBe(0);
    await page.locator("[data-weapon-delete-cancel]").click();
    await expect(card).toBeVisible();
    await expect(card.locator(".weapon-manual-control")).not.toHaveClass(/is-open/);
    const centre = await card.locator(".weapon-art").boundingBox();
    const button = await marker.boundingBox();
    expect(Math.abs(button!.x + button!.width / 2 - centre!.x - centre!.width / 2)).toBeLessThan(1);
    expect(deletes).toBe(0);
    await marker.hover();
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    await page.locator("[data-weapon-delete-confirm]").click();
    await expect(card).toHaveCount(0);
    expect(deletes).toBe(1);
});

test("weapon scan import preserves manual copies and matches equipped copies once", async ({
    page,
}) => {
    const base = {
        id: 14402,
        name: "The Widsith",
        icon: "https://assets.test/icon.svg",
        type: "Catalyst",
        rarity: 4,
        level: 70,
        refinement: 2,
    };
    let stored: Record<string, unknown>[] = [];
    let imports = 0;
    await page.route("**/api/weapons?*", (route) =>
        route.fulfill({
            json: {
                owned: [{ ...base, equipped: "Lisa", character_rarity: 4 }],
                catalogue: [base],
            },
        }),
    );
    await page.route("**/api/weapons/manual?*", (route) =>
        route.fulfill({
            json: { weapons: [{ ...base, id: 99, name: "Manual copy", copy_id: "manual" }] },
        }),
    );
    await page.route("**/api/weapons/scanned?*", (route) =>
        route.fulfill({ json: { weapons: stored } }),
    );
    await page.route("**/api/weapons/import/preview?*", (route) =>
        route.fulfill({ json: { count: 2, uid: "700000001" } }),
    );
    await page.route("**/api/weapons/import?*", (route) => {
        imports++;
        stored = [
            { ...base, scan_copy_id: "scan:0", equipped: "Lisa" },
            { ...base, scan_copy_id: "scan:1" },
        ];
        return route.fulfill({ json: { weapons: stored } });
    });
    await page.locator("[data-weapons-retry]").click();
    await expect(page.locator(".weapon-card")).toHaveCount(2);
    const file = {
        name: "weapons.json",
        mimeType: "application/json",
        buffer: Buffer.from(
            JSON.stringify({
                format: "GOOD",
                cyrene: { uid: "700000001", complete: true },
                weapons: [{}, {}],
            }),
        ),
    };
    await page.locator("[data-weapons-import-file]").setInputFiles(file);
    await expect(page.locator("[data-weapon-import-summary]")).toContainText(
        "2 weapons for UID 700000001",
    );
    const confirmation = page.locator("[data-weapon-import-dialog]");
    await expect(confirmation).toBeVisible();
    expect(await confirmation.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(
        "linear-gradient",
    );
    await expect(confirmation).toHaveCSS("border-top-style", "solid");
    await expect(confirmation).toHaveCSS("border-top-left-radius", "22px");
    await confirmation.screenshot({ path: "test-results/weapon-import-dialog.png" });
    await page.locator("[data-weapon-import-cancel]").click();
    expect(imports).toBe(0);
    for (let i = 0; i < 2; i++) {
        await page.locator("[data-weapons-import-file]").setInputFiles(file);
        await page.locator("[data-weapon-import-confirm]").click();
        await expect(page.locator(".weapon-card")).toHaveCount(3);
        await expect(page.locator(".weapon-card h2")).toHaveText([
            "Manual copy",
            "The Widsith",
            "The Widsith",
        ]);
    }
    await page.reload();
    await expect(page.locator(".weapon-card")).toHaveCount(3);
    await expect(page.locator("[data-weapons-count]")).toContainText("1 equipped weapons");
    await expect(page.locator("[data-weapons-count]")).toContainText("1 unequipped");
    await expect(page.locator('.weapon-manual-control[data-origin="manual"]')).toHaveCount(1);
    await expect(page.locator('.weapon-manual-control[data-origin="imported"]')).toHaveCount(2);
});

test("complete scan replaces displayed inventory, resolves Traveler and supports imported deletion", async ({
    page,
}) => {
    const base = {
        id: 11499,
        name: "Silver Light",
        type: "Sword",
        rarity: 4,
        level: 80,
        refinement: 1,
        icon: "https://assets.test/icon.svg",
    };
    let stored = [
        { ...base, scan_copy_id: "scan:0", equipped: "Test" },
        { ...base, scan_copy_id: "scan:1", equipped: "" },
    ];
    await page.route("**/api/weapons?*", (route) =>
        route.fulfill({
            json: {
                owned: [
                    {
                        ...base,
                        equipped: "Traveler",
                        character_rarity: 5,
                        character_icon: "https://assets.test/icon.svg",
                    },
                ],
                catalogue: [base],
            },
        }),
    );
    await page.route("**/api/weapons/scanned?*", (route) =>
        route.fulfill({ json: { scan_id: "scan", weapons: stored } }),
    );
    let deletions = 0;
    await page.route("**/api/weapons/scanned/scan%3A0?*", (route) => {
        deletions++;
        stored = stored.filter((row) => row.scan_copy_id !== "scan:0");
        return route.fulfill({ json: { ok: true } });
    });
    await page.locator("[data-weapons-retry]").click();
    await expect(page.locator(".weapon-card")).toHaveCount(2);
    await expect(page.locator(".weapon-card h2")).toHaveText(["Silver Light", "Silver Light"]);
    await expect(page.getByLabel("Equipped by Traveler")).toHaveCount(1);
    await expect(page.getByLabel("Equipped by Test")).toHaveCount(0);
    const imported = page
        .locator(".weapon-card")
        .filter({ has: page.getByLabel("Equipped by Traveler") });
    await expect(imported.locator(".weapon-manual-letter")).toHaveText("I");
    await imported.getByRole("button", { name: "Imported weapon options" }).hover();
    await imported.getByRole("button", { name: "Delete", exact: true }).click();
    await page.locator("[data-weapon-delete-cancel]").click();
    expect(deletions).toBe(0);
    await imported.getByRole("button", { name: "Imported weapon options" }).hover();
    await imported.getByRole("button", { name: "Delete", exact: true }).click();
    await page.locator("[data-weapon-delete-confirm]").click();
    await expect(page.locator(".weapon-card")).toHaveCount(1);
    expect(deletions).toBe(1);
    await page.reload();
    await expect(page.locator(".weapon-card")).toHaveCount(1);
});

test("HoYoLAB overrides stale imported progression and equipment while preserving copies", async ({
    page,
}) => {
    const base = {
        id: 11499,
        name: "Silver Light",
        type: "Sword",
        rarity: 4,
        icon: "https://assets.test/icon.svg",
    };
    await page.route("**/api/weapons/scanned?*", (route) =>
        route.fulfill({
            json: {
                scan_id: "scan",
                weapons: [
                    { ...base, scan_copy_id: "scan:0", level: 60, refinement: 1 },
                    { ...base, scan_copy_id: "scan:1", level: 20, refinement: 1 },
                    {
                        ...base,
                        id: 100,
                        name: "Old sword",
                        scan_copy_id: "scan:2",
                        level: 40,
                        refinement: 1,
                        equipped: "Lisa",
                        character_icon: "https://assets.test/icon.svg",
                    },
                ],
            },
        }),
    );
    await page.route("**/api/weapons?*", (route) =>
        route.fulfill({
            json: {
                catalogue: [],
                owned: [
                    {
                        ...base,
                        level: 90,
                        refinement: 5,
                        equipped: "Test",
                        character_icon: "https://assets.test/icon.svg",
                        character_rarity: 5,
                    },
                    {
                        ...base,
                        id: 101,
                        name: "New sword",
                        level: 80,
                        refinement: 2,
                        equipped: "Lisa",
                        character_icon: "https://assets.test/icon.svg",
                    },
                ],
            },
        }),
    );
    await page.locator("[data-weapons-retry]").click();
    await expect(page.locator(".weapon-card")).toHaveCount(4);
    const traveler = page
        .locator(".weapon-card")
        .filter({ has: page.getByLabel("Equipped by Traveler") });
    await expect(traveler).toContainText("Lv. 90");
    await expect(traveler).toContainText("R5");
    await expect(traveler.locator(".weapon-manual-letter")).toHaveText("I");
    const old = page
        .locator(".weapon-card")
        .filter({ has: page.getByRole("heading", { name: "Old sword", exact: true }) });
    await expect(old.getByLabel("Equipped by Lisa")).toHaveCount(0);
    await expect(
        page
            .locator(".weapon-card")
            .filter({ has: page.getByRole("heading", { name: "New sword", exact: true }) })
            .getByLabel("Equipped by Lisa"),
    ).toHaveCount(1);
    await expect(
        page
            .locator(".weapon-card")
            .filter({ has: page.getByRole("heading", { name: "Silver Light", exact: true }) }),
    ).toHaveCount(2);
});

test("import action follows account dropdown across screen sizes", async ({ page }) => {
    for (const width of [390, 900, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        const account = await page.locator(".characters-account-form").boundingBox();
        const action = await page.locator("[data-weapons-import]").boundingBox();
        expect(
            action!.x >= account!.x + account!.width - 1 ||
                action!.y >= account!.y + account!.height - 1,
        ).toBeTruthy();
        expect(action!.x + action!.width).toBeLessThanOrEqual(width);
    }
});
