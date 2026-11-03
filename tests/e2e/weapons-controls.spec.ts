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
    await page.route("**/api/weapons/plans?*", (route) => route.fulfill({ json: { plans: [] } }));
    await page.route("**/api/inventory?*", (route) => route.fulfill({ json: { inventory: [] } }));
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
                : path.endsWith(".svg")
                  ? "image/svg+xml"
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

for (const width of [390, 1440]) {
    test(`Planner aligns pills, locks live levels and crafts compact materials at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 1000 });
        const base = {
            type: "Sword",
            rarity: 5,
            icon: "https://assets.test/icon.svg",
            tag: { kind: "source", label: "Gacha", source: "Gacha" },
        };
        const live = {
            ...base,
            id: 11501,
            name: "Live sword with a long name",
            level: 90,
            refinement: 1,
            equipped: "Jean",
            character_icon: "https://assets.test/icon.svg",
        };
        const imports = [
            {
                ...base,
                id: 11502,
                name: "Imported",
                level: 20,
                refinement: 1,
                scan_copy_id: "scan:0",
            },
            {
                ...base,
                id: 11503,
                name: "Another very long sword name",
                level: 20,
                refinement: 1,
                scan_copy_id: "scan:1",
            },
        ];
        await page.route("**/api/weapons?*", (route) =>
            route.fulfill({ json: { owned: [live], catalogue: [live, ...imports] } }),
        );
        await page.route("**/api/weapons/scanned?*", (route) =>
            route.fulfill({ json: { weapons: imports } }),
        );
        await page.route("**/api/inventory?*", (route) =>
            route.fulfill({
                json: {
                    inventory: [
                        { id: 101, amount: 30 },
                        { id: 102, amount: 1 },
                        { id: 103, amount: 0 },
                    ],
                },
            }),
        );
        await page.route("**/api/weapons/planner-costs?*", (route) =>
            route.fulfill({
                json: {
                    costs: {
                        level: {
                            status: "ok",
                            items: [
                                { id: 202, name: "Mora", amount: 18_814_814, rarity: 3 },
                                { id: 101, name: "Lower material", amount: 3, rarity: 2 },
                                {
                                    id: 102,
                                    name: "Middle material",
                                    amount: 2,
                                    rarity: 3,
                                    crafting_lower: [{ id: 101 }],
                                },
                                {
                                    id: 103,
                                    name: "Higher material",
                                    amount: 2,
                                    rarity: 4,
                                    crafting_lower: [{ id: 101 }, { id: 102 }],
                                },
                            ],
                        },
                        refinements: { status: "complete", items: [] },
                    },
                },
            }),
        );
        await page.reload();
        await expect(page.locator("[data-weapons-count] strong")).toHaveText(["1", "2"]);
        await page.getByRole("tab", { name: "Catalogue", exact: true }).click();
        await expect(page.locator("[data-weapons-count] strong")).toHaveText(["3"]);
        await page.getByRole("tab", { name: "Planner", exact: true }).click();
        await expect(page.getByRole("heading", { name: "No weapons planned yet" })).toBeVisible();
        await expect(page.locator("[data-wp-saved-total]")).toHaveCount(0);
        await page
            .locator("#weapons-planner")
            .screenshot({ path: `test-results/weapon-planner-empty-${width}.png` });
        await page.getByRole("button", { name: "Add your first weapon", exact: true }).click();
        const picker = page.locator("[data-wp-picker]");
        const aligned = await picker.locator(".weapon-plan-picker-card").evaluateAll((cards) =>
            cards.map((card) => ({
                top: card.getBoundingClientRect().top,
                pill: card.querySelector(".weapon-progression-pill")!.getBoundingClientRect().top,
                tag: card.querySelector(".weapon-tag")!.getBoundingClientRect().top,
            })),
        );
        for (const row of aligned)
            for (const other of aligned.filter((item) => Math.abs(item.top - row.top) < 1)) {
                expect(Math.abs(row.pill - other.pill)).toBeLessThan(1);
                expect(Math.abs(row.tag - other.tag)).toBeLessThan(1);
            }
        await picker.screenshot({ path: `test-results/weapon-picker-aligned-${width}.png` });
        await picker
            .getByRole("button")
            .filter({ has: page.getByRole("heading", { name: live.name, exact: true }) })
            .click();
        const editor = page.locator("[data-wp-editor]");
        for (const field of ["currentLevel", "targetLevel", "currentRefinement"])
            await expect(editor.locator(`[data-wp-choice="${field}"]`)).toBeHidden();
        await expect(editor.locator('[data-wp-readonly="currentLevel"]')).toHaveText("Lv. 90");
        await expect(editor.locator('[data-wp-readonly="targetLevel"]')).toHaveText("Lv. 90");
        const mora = editor.locator('[data-wp-cost="level"] .planner-cost-entry').filter({
            has: page.getByRole("button", { name: "Mora. Required: 18,814,814", exact: true }),
        });
        await expect(mora.locator(".planner-cost-quantity")).toContainText("×18.8m");
        const high = editor.locator('[data-wp-cost="level"] .planner-cost-entry').filter({
            has: page.getByRole("button", {
                name: "Higher material. Required: 2",
                exact: true,
            }),
        });
        await expect(high.locator(".planner-cost-quantity")).toHaveClass(/is-short/);
        await editor.getByRole("button", { name: "Toggle Crafting", exact: true }).click();
        await expect(high.locator(".planner-cost-tile")).toHaveClass(/is-craft-enough/);
        await expect(high.locator(".planner-cost-owned")).toHaveText("0 → 2");
        await editor.getByRole("button", { name: "Total", exact: true }).click();
        const total = editor.locator("[data-wp-editor-total]");
        await expect(total).toHaveCSS("overflow-y", "visible");
        const required = total.locator(".planner-cost-required").first();
        await expect(required).toHaveText("×18.8m");
        const requiredBounds = await required.boundingBox();
        const tileBounds = await total.locator(".planner-cost-tile").first().boundingBox();
        expect(requiredBounds!.x).toBeGreaterThanOrEqual(tileBounds!.x);
        expect(await total.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(
            true,
        );
        await editor.evaluate(async (node) => {
            await Promise.all(
                node
                    .getAnimations({ subtree: true })
                    .map((animation) => animation.finished.catch(() => {})),
            );
        });
        await editor.screenshot({ path: `test-results/weapon-planner-crafting-${width}.png` });
        await editor.getByRole("button", { name: "Total", exact: true }).click();
        await editor.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.locator("[data-wp-add]").click();
        await picker
            .getByRole("button")
            .filter({ has: page.getByRole("heading", { name: "Imported", exact: true }) })
            .click();
        await editor.locator('[data-wp-choice="currentLevel"]').click();
        await expect(page.locator("#wp-choice-popup .planner-choice-option")).toHaveText([
            "Lv. 20",
            "Lv. 40",
            "Lv. 50",
            "Lv. 60",
            "Lv. 70",
            "Lv. 80",
            "Lv. 90",
        ]);
        await page
            .locator("#wp-choice-popup")
            .getByRole("button", { name: "Lv. 40", exact: true })
            .click();
        await editor.locator('[data-wp-choice="targetLevel"]').click();
        await expect(page.locator("#wp-choice-popup .planner-choice-option")).toHaveText([
            "Lv. 40",
            "Lv. 50",
            "Lv. 60",
            "Lv. 70",
            "Lv. 80",
            "Lv. 90",
        ]);
    });
}

for (const width of [390, 1440]) {
    test(`Plan card actions, hold-to-drag order, editor layout and toasts at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 1100 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const weapon = {
            id: 14525,
            name: "First weapon",
            type: "Catalyst",
            rarity: 5,
            icon: "https://assets.test/icon.svg",
            level: 1,
            refinement: 1,
        };
        let plans = [
            {
                key: "first",
                weapon,
                source: "unowned",
                currentLevel: 1,
                targetLevel: 90,
                currentRefinement: 1,
                targetRefinement: 5,
                ascension: null,
            },
            {
                key: "second",
                weapon: { ...weapon, id: 11501, name: "Second weapon", type: "Sword" },
                source: "unowned",
                currentLevel: 1,
                targetLevel: 90,
                currentRefinement: 1,
                targetRefinement: 5,
                ascension: null,
            },
        ];
        let writes = 0;
        let fail = false;
        await page.route("**/api/weapons/plans?*", (route) => {
            if (route.request().method() === "PUT") {
                if (fail)
                    return route.fulfill({
                        status: 503,
                        json: { detail: "Save unavailable. Retry." },
                    });
                writes++;
                plans = route.request().postDataJSON().plans;
            }
            return route.fulfill({ json: { plans } });
        });
        await page.route("**/api/weapons/planner-costs?*", (route) =>
            route.fulfill({
                json: {
                    costs: {
                        level: {
                            status: "ok",
                            preview: true,
                            items: Array.from({ length: 12 }, (_, index) => ({
                                id: 101 + index,
                                name: `Material ${index}`,
                                amount: index ? 41 : 1_131_520,
                                rarity: 4,
                                icon: "https://assets.test/icon.svg",
                            })),
                        },
                        refinements: { status: "complete", items: [] },
                    },
                },
            }),
        );
        await page.reload();
        await page.getByRole("tab", { name: "Planner", exact: true }).click();
        const cards = page.locator("[data-wp-plans] .weapon-plan-card");
        await expect(cards).toHaveCount(2);
        await expect(cards.first().getByRole("button")).toHaveCount(2);
        await expect(cards.first().locator(".weapon-plan-card-heading > span")).toHaveText(
            "Catalyst",
        );
        const sizes = await cards.first().evaluate((node) => ({
            heading: node.querySelector(".weapon-plan-card-heading")!.getBoundingClientRect()
                .height,
            rows: [...node.querySelectorAll(".planner-card-goals")].map(
                (row) => row.getBoundingClientRect().height,
            ),
        }));
        for (const row of sizes.rows) expect(row).toBeGreaterThan(sizes.heading);
        await page
            .locator("#weapons-planner")
            .screenshot({ path: `test-results/weapon-plan-card-actions-${width}.png` });
        const source = await cards.first().locator(".planner-card-identity").boundingBox();
        const target = await cards.last().locator(".planner-card-identity").boundingBox();
        await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
        await page.mouse.down();
        await expect(cards.first()).toHaveClass(/is-dragging/);
        await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
            steps: 8,
        });
        await page.mouse.up();
        await expect(cards.locator("h3")).toHaveText(["Second weapon", "First weapon"]);
        await expect(page.locator(".cyrene-toast-message").last()).toHaveText(
            "Weapon plans reordered.",
        );
        expect(plans.map((plan) => plan.key)).toEqual(["second", "first"]);
        await page.reload();
        await page.getByRole("tab", { name: "Planner", exact: true }).click();
        await expect(cards.locator("h3")).toHaveText(["Second weapon", "First weapon"]);
        await cards.first().focus();
        await page.keyboard.press("Alt+ArrowDown");
        await expect(cards.locator("h3")).toHaveText(["First weapon", "Second weapon"]);
        if (width === 390) {
            const touch = await page.context().newCDPSession(page);
            const from = await cards.first().locator(".planner-card-identity").boundingBox();
            const to = await cards.last().locator(".planner-card-identity").boundingBox();
            await touch.send("Input.dispatchTouchEvent", {
                type: "touchStart",
                touchPoints: [{ x: from!.x + 20, y: from!.y + 10 }],
            });
            await expect(cards.first()).toHaveClass(/is-dragging/);
            await touch.send("Input.dispatchTouchEvent", {
                type: "touchMove",
                touchPoints: [{ x: to!.x + 20, y: to!.y + 10 }],
            });
            await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            await expect(cards.locator("h3")).toHaveText(["Second weapon", "First weapon"]);
            await cards.first().focus();
            await page.keyboard.press("Alt+ArrowDown");
            await expect(cards.locator("h3")).toHaveText(["First weapon", "Second weapon"]);
            await touch.detach();
        }
        const written = writes;
        const first = await cards.first().locator(".planner-card-identity").boundingBox();
        const second = await cards.last().locator(".planner-card-identity").boundingBox();
        await page.mouse.move(first!.x + 10, first!.y + 10);
        await page.mouse.down();
        await expect(cards.first()).toHaveClass(/is-dragging/);
        await page.mouse.move(second!.x + 10, second!.y + 10, { steps: 8 });
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect(cards.locator("h3")).toHaveText(["First weapon", "Second weapon"]);
        expect(writes).toBe(written);
        await cards
            .first()
            .getByRole("button", { name: "Edit First weapon's plan", exact: true })
            .click();
        const editor = page.locator("[data-wp-editor]");
        await expect(editor.locator("[data-wp-delete]")).toHaveCount(0);
        for (const field of ["currentLevel", "targetLevel"]) {
            const trigger = editor.locator(`[data-wp-choice="${field}"]`);
            await trigger.click();
            await expect(trigger).toHaveAttribute("aria-expanded", "true");
            await trigger.click();
            await expect(page.locator("#wp-choice-popup")).not.toBeVisible();
            await expect(trigger).toHaveAttribute("aria-expanded", "false");
            await trigger.click();
            await expect(
                page.locator("#wp-choice-popup .planner-choice-option").first(),
            ).toHaveText("Lv. 1");
            await page
                .locator("#wp-choice-popup")
                .getByRole("button", { name: "Lv. 1", exact: true })
                .click();
        }
        const panel = editor.locator("[data-wp-editor-panel]");
        await expect(panel).toHaveCSS("overflow-x", "visible");
        await editor.locator('[data-wp-cost="level"] .planner-cost-tile').last().hover();
        expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
        await editor.locator(".planner-editor-header").hover();
        const message = await editor
            .locator('[data-wp-cost="level"] .planner-cost-message')
            .boundingBox();
        const grid = await editor
            .locator('[data-wp-cost="level"] .planner-cost-grid')
            .boundingBox();
        expect(grid!.y - message!.y - message!.height).toBeGreaterThanOrEqual(10);
        await editor.getByRole("button", { name: "Total", exact: true }).click();
        await editor.evaluate(async (node) => {
            await Promise.all(
                node
                    .getAnimations({ subtree: true })
                    .map((animation) => animation.finished.catch(() => {})),
            );
        });
        const mainBounds = await panel.boundingBox();
        const totalBounds = await editor.locator("[data-wp-total-panel]").boundingBox();
        expect(Math.abs(totalBounds!.height - Math.max(280, mainBounds!.height - 72))).toBeLessThan(
            1,
        );
        expect(Math.abs(totalBounds!.width - Math.min(390, width - 24))).toBeLessThan(1);
        await editor.screenshot({ path: `test-results/weapon-editor-layout-${width}.png` });
        await editor.getByRole("button", { name: "Total", exact: true }).click();
        await editor.getByRole("button", { name: "Save Plan", exact: true }).click();
        await expect(page.locator(".cyrene-toast-message").last()).toHaveText("Weapon plan saved.");
        expect(plans.map((plan) => plan.key)).toEqual(["first", "second"]);
        await cards
            .first()
            .getByRole("button", { name: "Delete First weapon's plan", exact: true })
            .click();
        const confirmation = page.locator("[data-wp-delete-dialog]");
        await confirmation.getByRole("button", { name: "Keep plan", exact: true }).click();
        await expect(cards).toHaveCount(2);
        await cards
            .first()
            .getByRole("button", { name: "Delete First weapon's plan", exact: true })
            .click();
        fail = true;
        await confirmation.getByRole("button", { name: "Delete plan", exact: true }).click();
        await expect(page.locator('.cyrene-toast[data-kind="error"]')).toBeVisible();
        await expect(page.locator("[data-cyrene-toasts]")).toHaveAttribute("popover", "manual");
        await page.locator('.cyrene-toast[data-kind="error"] .cyrene-toast-close').click();
        await expect(cards).toHaveCount(2);
        fail = false;
        await confirmation.getByRole("button", { name: "Delete plan", exact: true }).click();
        await expect(cards).toHaveCount(1);
        await expect(page.locator(".cyrene-toast-message").last()).toHaveText(
            "Weapon plan deleted.",
        );
        expect(errors).toEqual([]);
    });
}

test("Import opens instructions before choosing a file", async ({ page }) => {
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Import weapon inventory" });
    await expect(modal).toBeVisible();
    await expect(modal.getByRole("link", { name: "Cyrene Releases on GitHub" })).toHaveAttribute(
        "href",
        "https://github.com/softxo/Cyrene/releases",
    );
    await expect(modal.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
    await expect(modal.getByRole("button", { name: "Choose JSON file" })).toBeVisible();
    await page.locator("[data-weapons-import-file]").setInputFiles({
        name: "bad.json",
        mimeType: "application/json",
        buffer: Buffer.from("not JSON"),
    });
    await expect(modal.locator("[data-weapon-import-status]")).not.toBeEmpty();
    await expect(modal.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
});

test("inventory actions only appear on Owned and Other is absent from Tags", async ({ page }) => {
    await expect(page.locator('.weapons-tag-filter [role=option][data-value="Other"]')).toHaveCount(
        0,
    );
    for (const name of ["Catalogue", "Planner", "Owned"]) {
        await page.getByRole("tab", { name, exact: true }).click();
        for (const selector of ["[data-weapons-import]", "[data-weapons-reset]"]) {
            if (name === "Owned") await expect(page.locator(selector)).toBeVisible();
            else await expect(page.locator(selector)).toBeHidden();
        }
    }
});

for (const width of [390, 1440]) {
    test(`Add Weapon filters include unowned weapons and owned copies have portrait pills at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 1000 });
        const base = { type: "Sword", rarity: 4, icon: "https://assets.test/icon.svg" };
        const owned = {
            ...base,
            id: 11401,
            name: "Favonius Sword",
            level: 70,
            refinement: 2,
            equipped: "Jean",
            character_icon: "https://assets.test/icon.svg",
            tag: { kind: "source", label: "Gacha", source: "Gacha" },
        };
        const unowned = {
            ...base,
            id: 11413,
            name: "Festering Desire",
            tag: { kind: "source", label: "Event", source: "Event" },
        };
        await page.route("**/api/weapons?*", (route) =>
            route.fulfill({ json: { owned: [owned], catalogue: [owned, unowned] } }),
        );
        await page.route("**/api/weapons/planner-costs?*", (route) =>
            route.fulfill({
                json: {
                    costs: {
                        level: { status: "complete", items: [] },
                        refinements: { status: "complete", items: [] },
                    },
                },
            }),
        );
        await page.reload();
        await page.getByRole("tab", { name: "Planner", exact: true }).click();
        await page.locator("[data-wp-add]").click();
        const picker = page.locator("[data-wp-picker]");
        await expect(picker).toHaveClass(/planner-picker-dialog/);
        await expect(picker.locator(".weapon-plan-picker-card")).toHaveCount(2);
        const pill = picker.locator(".weapon-progression-pill");
        await expect(pill).toContainText("Lv. 70");
        await expect(pill).toContainText("R2");
        await expect(pill).toContainText("Jean");
        await expect(pill.locator(".weapon-progression-character img")).toHaveAttribute(
            "src",
            "https://assets.test/icon.svg",
        );
        const ownership = picker.locator('[data-wp-select="ownership"]');
        await ownership.locator(".custom-select-button").click();
        await ownership.getByRole("option", { name: "Not owned", exact: true }).click();
        await expect(picker.locator(".weapon-plan-picker-card h3")).toHaveText([
            "Festering Desire",
        ]);
        const tag = picker.locator('[data-wp-select="tag"]');
        await tag.locator(".custom-select-button").click();
        await tag.getByRole("option", { name: "Event", exact: true }).click();
        await picker.getByRole("button", { name: "Sword", exact: true }).click();
        await picker.getByRole("button", { name: "4-star", exact: true }).click();
        await picker.getByRole("searchbox", { name: "Search weapons" }).fill("Festering");
        await expect(picker.locator(".weapon-plan-picker-card")).toHaveCount(1);
        await picker.screenshot({ path: `test-results/weapon-picker-filters-${width}.png` });
        await picker.locator("[data-wp-filter-reset]").click();
        await expect(picker.locator(".weapon-plan-picker-card")).toHaveCount(2);
        await picker.screenshot({ path: `test-results/weapon-picker-copies-${width}.png` });
        await picker
            .getByRole("button")
            .filter({ has: page.getByRole("heading", { name: "Festering Desire", exact: true }) })
            .click();
        const editor = page.locator("[data-wp-editor]");
        await expect(editor.locator("[data-wp-editor-panel]")).toHaveClass(/planner-editor-dialog/);
        await expect(editor.locator('[data-wp-choice="currentLevel"]')).toHaveText("Lv. 1");
        await expect(editor.locator('[data-wp-choice="currentRefinement"]')).toHaveText("R1");
        await expect(editor.locator('[data-wp-tab="level"]')).toHaveClass(/planner-tab/);
        await editor
            .locator("[data-wp-editor-panel]")
            .screenshot({ path: `test-results/weapon-editor-unowned-${width}.png` });
        const panel = await editor.locator("[data-wp-editor-panel]").boundingBox();
        expect(panel!.x).toBeGreaterThanOrEqual(0);
        expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
        await editor.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(editor).toBeHidden();
    });
}

test("Tags filter combines with search, type and rarity on both collection tabs", async ({
    page,
}) => {
    const base = {
        type: "Sword",
        rarity: 4,
        icon: "https://assets.test/icon.svg",
        level: 70,
        refinement: 1,
    };
    const weapons = [
        {
            ...base,
            id: 1,
            name: "Signature sword",
            tag: { kind: "signature", label: "Owner's Signature", source: "Gacha" },
        },
        {
            ...base,
            id: 2,
            name: "Event sword",
            tag: { kind: "source", label: "Event", source: "Event" },
        },
        {
            ...base,
            id: 3,
            name: "Gacha sword",
            tag: { kind: "source", label: "Gacha", source: "Gacha" },
        },
    ];
    await page.route("**/api/weapons?*", (route) =>
        route.fulfill({ json: { owned: weapons, catalogue: weapons } }),
    );
    await page.locator("[data-weapons-retry]").click();
    const filter = page.locator(".weapons-tag-filter");
    await filter.getByRole("button", { name: "Tags All tags" }).click();
    await filter.getByRole("option", { name: "Gacha", exact: true }).click();
    await expect(page.locator("#weapons-results .weapon-card:visible h2")).toHaveText([
        "Gacha sword",
        "Signature sword",
    ]);
    await page.locator('[data-weapons-tab="catalogue"]').click();
    await page.locator("[data-weapons-search]").fill("Owner");
    await page.getByRole("button", { name: "Sword", exact: true }).click();
    await page.getByRole("button", { name: "4-star weapons", exact: true }).click();
    await expect(page.locator("#weapons-results .weapon-card:visible h2")).toHaveText([
        "Signature sword",
    ]);
    await filter.locator(".custom-select-button").click();
    await filter.getByRole("option", { name: "Event", exact: true }).click();
    await expect(page.locator("#weapons-results .weapon-card:visible")).toHaveCount(0);
});

for (const width of [390, 1440]) {
    test(`Weapon Planner saves goals, combines costs, reloads and survives inventory reset at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 1000 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let plans: any[] = [];
        let resets = 0;
        let failReset = false;
        const base = {
            id: 11401,
            name: "Favonius Sword",
            type: "Sword",
            rarity: 4,
            icon: "https://assets.test/icon.svg",
            level: 70,
            refinement: 2,
        };
        let manual = [{ ...base, copy_id: "manual", name: "Manual sword" }];
        let scanned = [{ ...base, scan_copy_id: "scan:0", name: "Imported sword", id: 11402 }];
        await page.route("**/api/weapons?*", (route) =>
            route.fulfill({ json: { owned: [{ ...base, equipped: "Jean" }], catalogue: [base] } }),
        );
        await page.route("**/api/weapons/manual?*", (route) =>
            route.fulfill({ json: { weapons: manual } }),
        );
        await page.route("**/api/weapons/scanned?*", (route) =>
            route.fulfill({ json: { weapons: scanned } }),
        );
        await page.route("**/api/weapons/plans?*", (route) => {
            if (route.request().method() === "PUT") plans = route.request().postDataJSON().plans;
            return route.fulfill({ json: { plans } });
        });
        await page.route("**/api/weapons/inventory?*", (route) => {
            if (failReset) return route.fulfill({ status: 503, json: { detail: "Retry" } });
            resets++;
            manual = [];
            scanned = [];
            return route.fulfill({ json: { ok: true } });
        });
        await page.route("**/api/weapons/planner-costs?*", (route) => {
            const plan = route.request().postDataJSON();
            const mora = (amount: number) => ({ id: 202, name: "Mora", amount });
            const copies = plan.targetRefinement - plan.currentRefinement;
            return route.fulfill({
                json: {
                    costs: {
                        level: {
                            status: "ok",
                            items: [mora((plan.targetLevel - plan.currentLevel) * 100)],
                        },
                        refinements: {
                            status: "ok",
                            items: [
                                mora(copies * 1000),
                                ...(copies
                                    ? [
                                          {
                                              id: "weapon:11401",
                                              name: "Favonius Sword (R1 copy)",
                                              amount: copies,
                                          },
                                      ]
                                    : []),
                            ],
                        },
                    },
                },
            });
        });
        await page.reload();
        await page.getByRole("tab", { name: "Planner", exact: true }).click();
        const planner = page.locator("#weapons-planner");
        await expect(page.locator(".weapons-toolbar")).toBeHidden();
        await planner.getByRole("button", { name: "Add Weapon", exact: true }).click();
        const picker = page.locator("[data-wp-picker]");
        await picker
            .getByRole("button")
            .filter({ has: page.getByRole("heading", { name: "Favonius Sword", exact: true }) })
            .first()
            .click();
        const editor = page.locator("[data-wp-editor]");
        await expect(editor.locator('[data-wp-choice="currentLevel"]')).toHaveText("Lv. 70");
        await editor.locator('[data-wp-choice="targetLevel"]').click();
        await page
            .locator("#wp-choice-popup")
            .getByRole("button", { name: "Lv. 80", exact: true })
            .click();
        await editor.getByRole("tab", { name: "Refinements", exact: true }).click();
        await editor.locator('[data-wp-choice="targetRefinement"]').click();
        await page
            .locator("#wp-choice-popup")
            .getByRole("button", { name: "R4", exact: true })
            .click();
        await expect(editor.locator('[data-wp-cost="refinements"]')).toContainText(
            "Required: 2,000",
        );
        await editor.getByRole("button", { name: "Total", exact: true }).click();
        await expect(editor.locator("[data-wp-editor-total]")).toContainText("Required: 3,000");
        await editor.screenshot({ path: `test-results/weapon-planner-editor-${width}.png` });
        await editor.getByRole("button", { name: "Total", exact: true }).click();
        await editor.getByRole("button", { name: "Save Plan", exact: true }).click();
        await expect(planner.locator(".weapon-plan-card")).toHaveCount(1);
        expect(plans[0].targetRefinement).toBe(4);
        await planner.getByRole("button", { name: "Add Weapon", exact: true }).click();
        await picker
            .getByRole("button")
            .filter({ has: page.getByRole("heading", { name: "Favonius Sword", exact: true }) })
            .first()
            .click();
        await editor.locator('[data-wp-choice="targetLevel"]').click();
        await page
            .locator("#wp-choice-popup")
            .getByRole("button", { name: "Lv. 80", exact: true })
            .click();
        await editor.getByRole("button", { name: "Save Plan", exact: true }).click();
        await expect(planner.locator(".weapon-plan-card")).toHaveCount(2);
        await expect(planner.getByRole("button", { name: "Total", exact: true })).toHaveCount(0);
        await expect(page.locator("[data-wp-saved-total]")).toHaveCount(0);
        await expect(planner.locator(".weapon-plan-card").first()).toHaveClass(
            /planner-character-card/,
        );
        await page.reload();
        await page.getByRole("tab", { name: "Planner", exact: true }).click();
        await expect(planner.locator(".weapon-plan-card")).toHaveCount(2);
        await page.getByRole("tab", { name: "Owned", exact: true }).click();
        await page.getByRole("button", { name: "Reset", exact: true }).click();
        const reset = page.locator("[data-weapons-reset-dialog]");
        await expect(reset).toContainText("saved plans are kept");
        await reset.getByRole("button", { name: "Cancel", exact: true }).click();
        expect(resets).toBe(0);
        await page.getByRole("button", { name: "Reset", exact: true }).click();
        failReset = true;
        await reset.getByRole("button", { name: "Reset inventory", exact: true }).click();
        await expect(reset.locator("[data-weapons-reset-status]")).toContainText("Couldn't reset");
        expect(manual).toHaveLength(1);
        failReset = false;
        await reset.getByRole("button", { name: "Reset inventory", exact: true }).click();
        await expect(reset).toBeHidden();
        await expect(planner.locator(".weapon-plan-card")).toHaveCount(2);
        await page.getByRole("tab", { name: "Owned", exact: true }).click();
        await expect(page.locator("#weapons-results .weapon-card")).toHaveCount(1);
        await expect(page.getByLabel("Equipped by Jean")).toBeVisible();
        await page.reload();
        await expect(page.locator("#weapons-results .weapon-card")).toHaveCount(1);
        await page.getByRole("tab", { name: "Planner", exact: true }).click();
        await expect(planner.locator(".weapon-plan-card")).toHaveCount(2);
        await planner
            .locator(".weapon-plan-card")
            .first()
            .getByRole("button", { name: "Delete Favonius Sword's plan", exact: true })
            .click();
        await page
            .locator("[data-wp-delete-dialog]")
            .getByRole("button", { name: "Delete plan", exact: true })
            .click();
        await expect(planner.locator(".weapon-plan-card")).toHaveCount(1);
        expect(errors).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
    });
}

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
    await expect(page.locator('.weapon-manual-control[data-origin="imported"]')).toHaveCount(1);
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
    await page.route("**/api/weapons/scanned/scan%3A1?*", (route) => {
        deletions++;
        stored = stored.filter((row) => row.scan_copy_id !== "scan:1");
        return route.fulfill({ json: { ok: true } });
    });
    await page.locator("[data-weapons-retry]").click();
    await expect(page.locator(".weapon-card")).toHaveCount(2);
    await expect(page.locator(".weapon-card h2")).toHaveText(["Silver Light", "Silver Light"]);
    await expect(page.getByLabel("Equipped by Traveler")).toHaveCount(1);
    await expect(page.getByLabel("Equipped by Test")).toHaveCount(0);
    const imported = page
        .locator(".weapon-card")
        .filter({ has: page.locator('.weapon-manual-control[data-origin="imported"]') });
    await expect(
        page.getByLabel("Equipped by Traveler").locator("..").locator(".weapon-manual-letter"),
    ).toHaveCount(0);
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
    await expect(traveler.locator(".weapon-manual-letter")).toHaveCount(0);
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
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
        const account = await page.locator(".characters-account-form").boundingBox();
        const action = await page.locator("[data-weapons-import]").boundingBox();
        expect(
            action!.x >= account!.x + account!.width - 1 ||
                action!.y >= account!.y + account!.height - 1,
        ).toBeTruthy();
        expect(action!.x + action!.width).toBeLessThanOrEqual(width);
    }
});

test("7.2 weapon appears in Catalogue with Mitya's signature tag and respects preview preference", async ({
    page,
}) => {
    const catalogue = JSON.parse(
        execFileSync(
            python,
            [
                "-c",
                "import json; from utils.web.weapons import catalogue_weapon_rows; print(json.dumps(catalogue_weapon_rows([])))",
            ],
            { encoding: "utf8" },
        ),
    );
    await page.route("**/api/weapons?*", (route) =>
        route.fulfill({ json: { owned: [], catalogue } }),
    );
    await page.goto("/weapons");
    await page.evaluate(() => (document.documentElement.dataset.showUnreleased = "true"));
    await page.locator('[data-weapons-tab="catalogue"]').click();
    await expect(page.locator(".weapon-card:visible")).toHaveCount(1);
    await expect(page.locator(".weapon-card h2")).toHaveText("Starsealed Edict");
    await expect(page.locator(".weapon-tag")).toHaveText("Mitya's Signature");
    await page.locator("[data-weapons-search]").fill("Mitya");
    await expect(page.locator(".weapon-card:visible")).toHaveCount(1);
    if (catalogue[0].unreleased) {
        const badge = page.locator(".weapon-unreleased");
        await expect(badge).toHaveText("Unreleased");
        const badgeBox = await badge.boundingBox();
        const artBox = await page.locator(".weapon-art").boundingBox();
        expect(
            Math.abs(badgeBox!.x + badgeBox!.width / 2 - artBox!.x - artBox!.width / 2),
        ).toBeLessThan(1);
        expect(badgeBox!.y - artBox!.y).toBeLessThan(10);
        await page.evaluate(() => (document.documentElement.dataset.showUnreleased = "false"));
        await page.locator("[data-weapons-search]").fill("Starsealed");
        await expect(page.locator(".weapon-card:visible")).toHaveCount(0);
    }
});
