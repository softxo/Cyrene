import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const html = execFileSync(
    "python",
    [
        "-c",
        `from jinja2 import Environment, FileSystemLoader
from pathlib import Path
e = Environment(loader=FileSystemLoader('website/templates'))
s = Path('website/templates/achievements.html').read_text(encoding='utf-8').replace('{% extends "base.html" %}', '')
print(e.from_string(s).render(accounts=[dict(id=1, genshin_uid='123')], selected_account=dict(id=1, genshin_uid='123')))
`,
    ],
    { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
);
const achievement = (name: string, category: string, version: string, completed = false) => ({
    name,
    category,
    version,
    tiers: [{ tier: 1, genshin_id: name, description: name, completed, reward: 5, progress: 1 }],
});
const data = {
    achievements: [
        achievement("Finished", "The Art of Adventure", "1.0", true),
        achievement("Other match", "The Hero's Journey", "7.2"),
        achievement("Local completed", "Wonders of the World", "3.2", true),
        ...Array.from({ length: 30 }, (_, i) =>
            achievement(`Local ${i}`, "Wonders of the World", "7.1"),
        ),
    ],
    categories: {
        "The Art of Adventure": { completed: 1, total: 1 },
        "The Hero's Journey": { completed: 0, total: 1 },
        "Wonders of the World": { completed: 1, total: 31 },
    },
    overall: { completed: 1, total: 32 },
};
const iconManifest = JSON.parse(readFileSync("data/achievement_category_icons.json", "utf8"));
for (const [name, category] of Object.entries(data.categories)) {
    (category as any).icon_url = iconManifest[name.toLowerCase().replace(/[^a-z0-9]/g, "")];
}
for (const width of [390, 1485]) {
    test(`Achievement filters, global search and scrolling at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.route("http://achievements.test/**", (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.startsWith("/static/") && existsSync(`website${path}`)) {
                return route.fulfill({ path: `website${path}` });
            }
            return route.fulfill(
                path.includes("/api/")
                    ? { json: data }
                    : { contentType: "text/html; charset=utf-8", body: html },
            );
        });
        await page.goto("http://achievements.test/");
        for (const css of ["global", "achievements"]) {
            await page.addStyleTag({
                content: readFileSync(`website/static/build/css/${css}.css`, "utf8"),
            });
        }
        await page.addScriptTag({
            content: readFileSync("website/static/build/browser/pages/achievements.js", "utf8"),
        });
        await page.evaluate(() => (window as any).initAchievements());
        await expect(page.locator(".achievement-category.category-completed")).toHaveCount(1);
        const assertHoverSetting = async (selector: string) => {
            const control = page.locator(selector).first();
            await page.evaluate(() => {
                document.documentElement.dataset.hoverEffects = "on";
            });
            await control.hover();
            await expect
                .poll(() => control.evaluate((el) => getComputedStyle(el).transform))
                .not.toBe("none");
            await page.evaluate(() => {
                document.documentElement.dataset.hoverEffects = "off";
            });
            await expect(control).toHaveCSS("transform", "none");
            await page.emulateMedia({ reducedMotion: "reduce" });
            await page.evaluate(() => {
                document.documentElement.dataset.hoverEffects = "on";
            });
            await expect(control).toHaveCSS("transform", "none");
            await page.emulateMedia({ reducedMotion: "no-preference" });
        };
        await assertHoverSetting(".achievement-category");
        const mainHideCompleted = page.locator("#achievement-categories .checkbox-control");
        const mainPartial = page.locator(".achievement-category", {
            hasText: "Wonders of the World",
        });
        await mainHideCompleted.click();
        await expect(page.locator(".achievement-category.category-completed")).toHaveCount(0);
        await expect(mainPartial.locator(".achievement-category-count")).toHaveText("1/31");
        await page.locator("#achievement-search").fill("Local completed");
        await expect(mainPartial).toBeVisible();
        await page.locator("#achievement-search").fill("");
        await mainHideCompleted.click();
        await expect(page.locator(".achievement-category.category-completed")).toHaveCount(1);
        const primary = page.locator("#achievement-version-select");
        await primary.locator(".custom-select-button").click();
        await primary.locator('[data-value="7.1"]').click();
        await primary.locator('[data-value="7.2"]').click();
        await expect(primary.locator(".custom-select-option.selected")).toHaveCount(2);
        await primary.locator(".achievement-version-reset").click();
        await expect(primary.locator(".custom-select-value")).toHaveText("All Versions");
        await page.locator(".section-header").click();
        await page.locator(".achievement-category", { hasText: "The Art of Adventure" }).click();
        const completedCurrent = page.locator(
            ".achievement-sidebar-item.category-completed.active",
        );
        await expect(completedCurrent).toHaveAttribute("aria-current", "page");
        await assertHoverSetting("#achievement-back");
        await assertHoverSetting(".achievement-complete-button");
        await page.locator(".achievement-notes-button").first().click();
        const blurDuringOpening = await page
            .locator("#achievement-notes-modal")
            .evaluate(async (shell) => {
                await new Promise<void>((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
                );
                const backdrop = shell.querySelector(".achievement-notes-modal-backdrop")!;
                const transition = backdrop
                    .getAnimations()
                    .find(
                        (animation) =>
                            (animation as CSSTransition).transitionProperty === "backdrop-filter",
                    );
                if (transition) {
                    transition.pause();
                    transition.currentTime = 110;
                }
                return {
                    opacity: getComputedStyle(shell).opacity,
                    blur: parseFloat(
                        getComputedStyle(backdrop).backdropFilter.replace("blur(", ""),
                    ),
                    animated: Boolean(transition),
                };
            });
        expect(blurDuringOpening.opacity).toBe("1");
        expect(blurDuringOpening.animated).toBe(true);
        expect(blurDuringOpening.blur).toBeGreaterThan(0);
        expect(blurDuringOpening.blur).toBeLessThan(6);
        await page
            .locator("#achievement-notes-modal")
            .evaluate((shell) =>
                shell.getAnimations({ subtree: true }).forEach((animation) => animation.finish()),
            );
        await page.locator("#achievement-notes-modal-close").click();
        await expect(page.locator("#achievement-notes-modal")).toBeHidden();
        await expect(completedCurrent.locator(".achievement-category-complete-mark")).toBeVisible();
        await page.screenshot({
            path: `test-results/achievements-completed-current-${width}.png`,
            fullPage: true,
        });
        await page
            .locator(".achievement-sidebar-item", { hasText: "Wonders of the World" })
            .click();
        await expect(page.locator(".achievement-sidebar-item[aria-current=page]")).toHaveCount(1);
        await expect(
            page.locator(
                ".achievement-sidebar-item.category-completed .achievement-category-current-label",
            ),
        ).toHaveCount(0);
        await expect(page.locator(".achievement-sidebar-item.category-completed")).toHaveCount(1);
        const wonders = page.locator(".achievement-sidebar-item", {
            hasText: "Wonders of the World",
        });
        await expect(wonders.locator("small")).toHaveText("1/31");
        await page.locator(".achievement-browser-controls .checkbox-control").click();
        await expect(wonders.locator("small")).toHaveText("0/30");
        await expect(page.locator(".achievement-sidebar-item.category-completed")).toHaveCount(0);
        const search = page.locator(".achievement-browser-controls input[type=search]");
        await search.fill("Other match");
        await expect(page.locator(".achievement-item")).toHaveCount(1);
        await expect(page.locator(".achievement-item")).toContainText("Other match");
        await expect(page.locator(".achievement-sidebar-item.search-match")).toHaveCount(1);
        await expect(page.locator(".achievement-sidebar-item.search-match")).toContainText(
            "The Hero's Journey",
        );
        await expect(page.locator(".achievement-search-match-label")).toHaveText("Search match");
        await page.screenshot({
            path: `test-results/achievements-search-${width}.png`,
            fullPage: true,
        });
        await search.fill("");
        await expect(page.locator(".achievement-item")).toHaveCount(30);
        const before = await page.locator(".achievement-content-header").boundingBox();
        await page.locator("#achievement-list").evaluate((el) => {
            el.scrollTop = 400;
        });
        expect(
            await page.locator("#achievement-list").evaluate((el) => el.scrollTop),
        ).toBeGreaterThan(0);
        expect((await page.locator(".achievement-content-header").boundingBox())?.y).toBe(
            before?.y,
        );
        const secondary = page.locator(
            ".achievement-browser-controls [data-achievement-version-select]",
        );
        await secondary.locator(".custom-select-button").click();
        await secondary.locator('[data-value="7.2"]').click();
        await secondary.locator('[data-value="7.1"]').click();
        await secondary.locator('[data-value="3.2"]').click();
        await expect(secondary.locator(".custom-select-option.selected")).toHaveCount(3);
        await expect(secondary.locator(".custom-select-value")).toHaveText("7.2, 7.1, 3.2");
        const fits = await secondary
            .locator(".custom-select-value")
            .evaluate((el) => el.scrollWidth <= el.clientWidth);
        expect(fits).toBe(true);
        const countFits = await wonders.locator("small").evaluate((el) => {
            el.textContent = "1026/1026";
            return el.scrollWidth <= el.clientWidth;
        });
        expect(countFits).toBe(true);
        await page.screenshot({
            path: `test-results/achievements-versions-${width}.png`,
            fullPage: true,
        });
        await secondary.locator(".achievement-version-reset").click();
        await expect(secondary.locator(".custom-select-value")).toHaveText("All Versions");
        await page.screenshot({ path: `test-results/achievements-${width}.png`, fullPage: true });
    });
}

test("Large achievement categories render progressively and remain searchable", async ({
    page,
}) => {
    const large = {
        achievements: Array.from({ length: 1200 }, (_, i) =>
            achievement(`Large ${i}`, "Wonders of the World", "7.2"),
        ),
        categories: { "Wonders of the World": { total: 1200, completed: 0 } },
    };
    await page.route("http://achievements-large.test/**", (route) =>
        route.fulfill(
            new URL(route.request().url()).pathname.includes("/api/")
                ? { json: large }
                : { contentType: "text/html", body: html },
        ),
    );
    await page.goto("http://achievements-large.test/");
    for (const css of ["global", "achievements"])
        await page.addStyleTag({
            content: readFileSync(`website/static/build/css/${css}.css`, "utf8"),
        });
    await page.addScriptTag({
        content: readFileSync("website/static/build/browser/pages/achievements.js", "utf8"),
    });
    await page.evaluate(() => (window as any).initAchievements());
    await expect(page.locator(".achievement-category")).toHaveCount(1);
    const duration = await page.locator(".achievement-category").evaluate((el) => {
        const start = performance.now();
        (el as HTMLElement).click();
        return performance.now() - start;
    });
    console.log(
        `Large category initial render: ${duration.toFixed(1)}ms; cards: ${await page.locator(".achievement-item").count()}`,
    );
    await expect(page.locator(".achievement-item")).toHaveCount(40);
    for (let count = 80; count <= 120; count += 40) {
        await page.locator("#achievement-list").evaluate((el) => {
            el.scrollTop = el.scrollHeight;
        });
        await expect(page.locator(".achievement-item")).toHaveCount(count);
    }
    await page.locator(".achievement-browser-controls input[type=search]").fill("Large 1199");
    await expect(page.locator(".achievement-item")).toHaveCount(1);
    await expect(page.locator(".achievement-item")).toContainText("Large 1199");
});

test("Category series retain their intended order in the grid and sidebar", async ({ page }) => {
    const expected = [
        "Wonders of the World",
        "Domains and Spiral Abyss: Series I",
        "Sumeru: The Rainforest of Lore",
        "Sumeru: The Gilded Desert - Series I",
        "Sumeru: The Gilded Desert - Series II",
        "Genius Invokation TCG",
        "Snezhnaya: Sacred city of ice and pale star (I)",
        "Snezhnaya: Sacred City of Ice and Pale Star (II)",
        "Snezhnaya: Sacred City of Ice and Pale Star (III)",
        "Land of Surging Shadows (I)",
        "Land of Surging Shadows (II)",
    ];
    const payload = {
        achievements: [...expected].reverse().map((name) => achievement(name, name, "7.2")),
        categories: Object.fromEntries(
            [...expected].reverse().map((name) => [name, { total: 1, completed: 0 }]),
        ),
    };
    await page.route("http://achievement-order.test/**", (route) =>
        route.fulfill(
            new URL(route.request().url()).pathname.includes("/api/")
                ? { json: payload }
                : { contentType: "text/html", body: html },
        ),
    );
    await page.goto("http://achievement-order.test/");
    await page.addScriptTag({
        content: readFileSync("website/static/build/browser/pages/achievements.js", "utf8"),
    });
    await page.evaluate(() => (window as any).initAchievements());
    await expect(page.locator(".achievement-category h3")).toHaveText(expected);
    await page.locator(".achievement-category").first().click();
    await expect(page.locator(".achievement-sidebar-name")).toHaveText(expected);
});
