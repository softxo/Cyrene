import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const html = execFileSync(
    ".venv/Scripts/python.exe",
    [
        "-X",
        "utf8",
        "-c",
        `
from jinja2 import Environment, FileSystemLoader
loader = FileSystemLoader('website/templates')
env = Environment(loader=loader)
source = loader.get_source(env, 'inventory.html')[0].replace('{% extends "base.html" %}', '')
print(env.from_string(source).render(accounts=[{'id':1,'genshin_uid':'123'}], selected_account={'id':1,'genshin_uid':'123'}))
`,
    ],
    { encoding: "utf8" },
);

for (const width of [390, 1280]) {
    test(`Inventory combines filters and resets at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.route("**/api/inventory?*", (route) =>
            route.fulfill({
                json: {
                    inventory: [
                        { name: "Mora", rarity: 3, amount: 1000, kind: "Currency" },
                        { name: "Guide to Freedom", rarity: 3, amount: 12, kind: "Talent books" },
                        {
                            name: "Philosophies of Freedom",
                            rarity: 4,
                            amount: 3,
                            kind: "Talent books",
                        },
                        { name: "Unknown material", rarity: 1, amount: 1 },
                    ],
                },
            }),
        );
        await page.route("http://inventory.test/", (route) =>
            route.fulfill({ contentType: "text/html", body: html }),
        );
        await page.goto("http://inventory.test/");
        await page.addStyleTag({
            content:
                readFileSync("website/static/build/css/global.css", "utf8") +
                readFileSync("website/static/build/css/inventory.css", "utf8"),
        });
        await page.addScriptTag({
            content: readFileSync("website/static/build/browser/pages/inventory.js", "utf8"),
        });
        await page.evaluate(() => (window as any).initInventory());
        const visible = page.locator("[data-inventory-item]:visible");
        await expect(visible).toHaveCount(4);
        await page.getByRole("button", { name: "Type All types", exact: true }).click();
        await expect(
            page.getByRole("option", { name: "Other materials", exact: true }),
        ).toHaveCount(0);
        await page.getByRole("option", { name: "Talent books", exact: true }).click();
        await expect(visible).toHaveCount(2);
        await page.getByRole("button", { name: "Rarity All rarities", exact: true }).click();
        await page.getByRole("option", { name: "3-star", exact: true }).click();
        await expect(visible).toHaveCount(1);
        await page.getByLabel("Search materials").fill("mora");
        await expect(visible).toHaveCount(0);
        await expect(page.locator("[data-inventory-empty]")).toBeVisible();
        await expect(page.locator("[data-inventory-count]")).toHaveText("0");
        await page.getByRole("button", { name: "Reset filters" }).click();
        await expect(visible).toHaveCount(4);
        await expect(page.getByRole("button", { name: "Reset filters" })).toBeDisabled();
        const controls = await page
            .locator(".inventory-filter .custom-select-button, [data-inventory-reset]")
            .evaluateAll((elements) =>
                elements.map((el) => {
                    const r = el.getBoundingClientRect();
                    return { top: r.top, height: r.height };
                }),
            );
        expect(controls[0].height).toBe(42);
        expect(controls[1].height).toBe(42);
        expect(controls[2].height).toBe(42);
        if (width > 640) expect(new Set(controls.map((control) => control.top)).size).toBe(1);
        const bounds = await page.locator(".inventory-toolbar").evaluate((el) => ({
            right: el.getBoundingClientRect().right,
            width: document.documentElement.clientWidth,
        }));
        expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    });
}
