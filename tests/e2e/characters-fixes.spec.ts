import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const character = {
    id: 10000002,
    name: "Ayaka",
    element: "Cryo",
    rarity: 5,
    owned: true,
    icon: "/static/images/characters/Element_Cryo.webp",
    level: 40,
    constellation: 0,
    friendship: 1,
    weapon: "Sword",
    release_date: "2021-07-21",
};
const unowned = { ...character, id: 10000003, name: "Unowned", owned: false, level: null };
const shell = execFileSync(
    ".venv/Scripts/python.exe",
    [
        "-c",
        String.raw`
import json,sys
from types import SimpleNamespace
from jinja2 import Environment,ChoiceLoader,DictLoader,FileSystemLoader
base='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/build/css/global.css"><link rel="stylesheet" href="/static/build/css/characters.css"></head><body><script type="module" src="/static/build/browser/core/toasts.js"></script><div style="position:fixed;top:0;left:0;right:0;height:60px;z-index:1001;pointer-events:none">Mobile header</div>{% block content %}{% endblock %}<script src="/static/build/browser/pages/characters/characters-talents.js"></script><script src="/static/build/browser/pages/characters/characters-filters.js"></script><script src="/static/build/browser/pages/characters/characters-showcase.js"></script><script src="/static/build/browser/pages/characters/characters-planner.js"></script><script src="/static/build/browser/pages/characters/characters-tabs.js"></script><script>initCharactersFilters();initCharacterShowcase();initCharacterPlanner();initCharactersTabs()</script></body></html>'''
env=Environment(loader=ChoiceLoader([DictLoader({'base.html':base}),FileSystemLoader('website/templates')]))
account={'id':1,'genshin_uid':'777000002','nickname':'Test'}
html=env.get_template('characters.html').render(request=SimpleNamespace(query_params={}),accounts=[account],selected_account=account,planner_user_id='10',characters=json.load(sys.stdin))
sys.stdout.buffer.write(html.encode('utf-8'))
`,
    ],
    { input: JSON.stringify([character, unowned]), encoding: "utf8" },
);

for (const width of [390, 1280]) {
    test(`Characters counts, layout, and explicit planner save at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let saved: any[] = [];
        let writes = 0;
        let holdSave = false;
        let releaseSave!: () => void;
        await page.route("**/static/**", (route) => {
            const path = new URL(route.request().url()).pathname;
            try {
                return route.fulfill({
                    body: readFileSync(`website${path}`),
                    contentType: path.endsWith(".css")
                        ? "text/css"
                        : path.endsWith(".js")
                          ? "text/javascript"
                          : path.endsWith(".svg")
                            ? "image/svg+xml"
                            : "image/webp",
                });
            } catch {
                return route.fulfill({ status: 404, body: "" });
            }
        });
        await page.route("**/api/**", async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname === "/api/characters/plans") {
                if (route.request().method() === "PUT") {
                    saved = route.request().postDataJSON().plans;
                    writes++;
                    if (holdSave) await new Promise<void>((resolve) => (releaseSave = resolve));
                }
                return route.fulfill({ json: { plans: saved, snapshot_exists: true } });
            }
            if (url.pathname === "/api/weapons")
                return route.fulfill({
                    json: {
                        catalogue: [
                            {
                                id: 11101,
                                name: "Dull Blade",
                                rarity: 1,
                                type: "Sword",
                                icon: "https://example.com/blade.png",
                            },
                        ],
                    },
                });
            if (url.pathname.endsWith("/showcase"))
                return route.fulfill({
                    json: {
                        data: {
                            characters: [
                                {
                                    ...character,
                                    weapon: {
                                        name: "Thrilling Tales of Dragon Slayers",
                                        rarity: 3,
                                        level: 70,
                                        icon: character.icon,
                                        main_stat: { name: "Base ATK", value: "309" },
                                        sub_stat: { name: "HP Percentage", value: "29.0%" },
                                    },
                                    skills: [10024, 10018, 10019].map((id) => ({
                                        id,
                                        skill_type: 1,
                                        level: 1,
                                        icon: character.icon,
                                    })),
                                    properties: [],
                                    constellations: [],
                                },
                            ],
                        },
                    },
                });
            if (url.pathname.endsWith("/planner-costs"))
                return route.fulfill({
                    json: {
                        costs: {
                            level:
                                url.searchParams.get("target_level") === "1"
                                    ? { status: "complete", items: [] }
                                    : undefined,
                            talents: { status: "complete", items: [] },
                        },
                    },
                });
            return route.fulfill({ json: {} });
        });
        await page.route("**/characters?*", (route) =>
            route.fulfill({ contentType: "text/html", body: shell }),
        );
        await page.goto("/characters?account_id=1");
        await expect(page.locator("[data-character-count]")).toHaveText(
            "Showing 1 of 1 characters | 2 Total characters",
        );
        await page.locator("[data-character-search]").fill("missing");
        await expect(page.locator("[data-character-count]")).toHaveText(
            "Showing 0 of 1 characters | 2 Total characters",
        );
        await page.locator("[data-character-reset]").click();
        if (width === 390) {
            const sort = await page.locator("[data-character-sort]").boundingBox();
            const rarity = await page.locator("[data-character-rarity]").boundingBox();
            expect(Math.abs(sort!.y - rarity!.y)).toBeLessThan(3);
        }
        await page.locator('[data-character-id="10000002"]').click();
        await expect(page.locator(".enka-stat-label", { hasText: "Cryo DMG Bonus" })).toBeVisible();
        await page.locator(".character-showcase-modal").evaluate(async (modal) => {
            await Promise.all(modal.getAnimations().map((animation) => animation.finished));
        });
        const stableLabel = await page.locator(".enka-stat-label").first().boundingBox();
        await page
            .locator(".enka-stat-name .enka-stat-icon")
            .first()
            .evaluate((icon) => icon.dispatchEvent(new Event("error")));
        const afterError = await page.locator(".enka-stat-label").first().boundingBox();
        expect(Math.abs(afterError!.x - stableLabel!.x)).toBeLessThan(0.5);
        await page
            .locator(".enka-stat-name .enka-stat-icon")
            .first()
            .evaluate((icon: HTMLElement) => (icon.style.visibility = ""));
        const label = await page.locator(".enka-stat-label").first().boundingBox();
        expect(label!.width).toBeGreaterThan(35);
        const talents = await page.locator(".enka-talent-column").boundingBox();
        expect(talents!.x).toBeGreaterThan(0);
        expect(talents!.x + talents!.width).toBeLessThan(width);
        for (const row of await page.locator(".enka-weapon-stat").all()) {
            const centres = await row.evaluate((element) =>
                Array.from(element.children).map((child) => {
                    const box = child.getBoundingClientRect();
                    return box.y + box.height / 2;
                }),
            );
            expect(Math.max(...centres) - Math.min(...centres)).toBeLessThan(1);
        }
        await page.screenshot({ path: `test-results/characters-showcase-${width}.png` });
        await page.locator(".character-showcase-close").click();
        await page.locator('[data-characters-tab="planner"]').click();
        await page.locator("[data-planner-add]:visible").first().click();
        await expect(page.locator("[data-planner-picker-count]")).toHaveText(
            "Showing 2 of 2 characters | 1 owned | 2 Total",
        );
        await page.screenshot({ path: `test-results/characters-picker-${width}.png` });
        if (width === 1280) {
            const reset = await page.locator("[data-planner-filter-reset]").boundingBox();
            const search = await page.locator("[data-planner-character-search]").boundingBox();
            expect(Math.abs(reset!.x + reset!.width - search!.x - search!.width)).toBeLessThan(1);
            const pill = await page.locator("[data-planner-picker-count]").boundingBox();
            const ownership = await page.locator("[data-planner-ownership-control]").boundingBox();
            expect(
                Math.abs(pill!.y + pill!.height / 2 - ownership!.y - ownership!.height / 2),
            ).toBeLessThan(1);
        }
        await page.locator("[data-planner-ownership-control] .custom-select-button").click();
        await page.locator("[data-planner-ownership-control] [data-value=unowned]").click();
        await expect(page.locator("[data-planner-picker-count]")).toHaveText(
            "Showing 1 of 2 characters | 1 owned | 2 Total",
        );
        await page.locator('[data-planner-character-id="10000003"]').click();
        await expect(page.locator("[data-planner-current-level]")).toHaveText("Lv. 1");
        await expect(
            page.locator("[data-planner-panel=level] .planner-cost-status .cyrene-check"),
        ).toBeVisible();
        await expect(page.locator("[data-planner-level]")).toHaveValue("1");
        await expect(page.locator("[data-planner-weapon-level]")).toHaveValue("1");
        await expect(page.locator("[data-planner-current-talent='1']")).toHaveText("Lv. 1");
        await page.locator('[data-planner-tab="talents"]').click();
        const current = await page.locator(".planner-talent-current > span").first().boundingBox();
        const goal = await page
            .locator(".planner-talent-levels label > span")
            .first()
            .boundingBox();
        expect(Math.abs(current!.y - goal!.y)).toBeLessThan(2);
        await page.screenshot({ path: `test-results/characters-planner-${width}.png` });
        await page.locator(".planner-editor-close").click();
        expect(writes).toBe(0);
        await expect(page.locator(".cyrene-toast")).toHaveCount(0);
        await expect(page.locator(".planner-character-card")).toHaveCount(0);
        await page.locator("[data-planner-add]:visible").first().click();
        await page.locator('[data-planner-character-id="10000003"]').click();
        await page.locator("[data-planner-level]").evaluate((select: HTMLSelectElement) => {
            select.value = "90";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await page.locator('[data-planner-tab="weapon"]').click();
        await expect(page.locator("[data-planner-cost=level] .planner-cost-retry")).toHaveClass(
            /cyrene-button/,
        );
        await expect(
            page.locator(".planner-weapon-overview .planner-level-comparison"),
        ).toBeHidden();
        await page.getByRole("button", { name: "Choose weapon", exact: true }).click();
        const trigger = await page
            .getByRole("button", { name: "Choose weapon", exact: true })
            .boundingBox();
        const menu = await page.locator(".planner-choice-menu").boundingBox();
        expect(Math.abs(trigger!.width - menu!.width)).toBeLessThan(1);
        expect(Math.abs(trigger!.x - menu!.x)).toBeLessThan(1);
        await page.screenshot({
            path: `test-results/planner-weapon-dropdown-${width}.png`,
            animations: "disabled",
        });
        await page.getByRole("button", { name: "Dull Blade", exact: true }).click();
        await expect(page.locator("[data-planner-current-weapon-name]")).toHaveText("Dull Blade");
        const alignment = await page
            .locator(".planner-weapon-overview .planner-level-comparison")
            .evaluate((box) => {
                const centre = (selector: string) => {
                    const rect = box.querySelector(selector)!.getBoundingClientRect();
                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                };
                return {
                    current: centre("strong"),
                    arrow: centre(".planner-level-arrow"),
                    goal: centre(".planner-choice-trigger"),
                    label: centre(".planner-level-value > span"),
                };
            });
        expect(Math.abs(alignment.current.x - alignment.label.x)).toBeLessThan(1);
        expect(Math.abs(alignment.arrow.y - alignment.current.y)).toBeLessThan(1);
        expect(Math.abs(alignment.arrow.y - alignment.goal.y)).toBeLessThan(1);
        await page.screenshot({
            path: `test-results/planner-comparison-${width}.png`,
            animations: "disabled",
        });
        await page.locator("[data-planner-talent]").evaluateAll((selects) =>
            selects.forEach((select) => {
                (select as HTMLSelectElement).value = "10";
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }),
        );
        holdSave = true;
        await page.locator("[data-planner-save]").click();
        await expect(page.locator("[data-planner-editor]")).toBeHidden();
        await expect(page.locator(".planner-character-card")).toHaveCount(1);
        expect(writes).toBe(1);
        await expect(page.locator(".cyrene-toast-message")).toHaveText(
            "Unowned added to Character Planner.",
        );
        await page.screenshot({
            path: `test-results/planner-toast-${width}.png`,
            animations: "disabled",
        });
        holdSave = false;
        releaseSave();
        expect(saved[0].plannedWeapon.name).toBe("Dull Blade");
        expect(saved[0].level).toBe(90);
        const groups = await page.locator(".planner-card-talent").evaluateAll((elements) =>
            elements.map((element) => {
                const rect = element.getBoundingClientRect();
                return { x: rect.x, right: rect.right, y: rect.y };
            }),
        );
        for (let index = 1; index < groups.length; index++) {
            if (Math.abs(groups[index].y - groups[index - 1].y) < 1)
                expect(groups[index].x - groups[index - 1].right).toBeGreaterThanOrEqual(9);
        }
        await page
            .locator(".planner-character-card")
            .screenshot({ path: `test-results/planner-card-${width}.png` });
        await page.reload();
        await page.locator('[data-characters-tab="planner"]').click();
        await expect(page.locator(".planner-character-card")).toHaveCount(1);
        await page.locator(".planner-card-edit").click();
        await expect(page.locator("[data-planner-level]")).toHaveValue("90");
        await expect(page.locator("[data-planner-current-level]")).toHaveText("Lv. 1");
        await page.locator("[data-planner-notes]").fill("Discard this edit");
        await page.locator(".planner-editor-close").click();
        expect(saved[0].notes).toBe("");
        expect(writes).toBe(1);
        await expect(page.locator(".cyrene-toast")).toHaveCount(0);
        await page.locator(".planner-card-edit").click();
        await page.locator("[data-planner-notes]").fill("Saved notes");
        await page.locator("[data-planner-save]").click();
        await expect(page.locator(".cyrene-toast-message")).toHaveText("Unowned's plan updated.");
        await page.getByRole("button", { name: "Dismiss notification" }).click();
        await expect(page.locator(".cyrene-toast")).toHaveCount(0);

        await page.locator(".planner-card-remove").click();
        await expect(page.locator(".character-plan-delete-dialog")).toBeVisible();
        await page.screenshot({
            path: `test-results/character-plan-delete-${width}.png`,
            animations: "disabled",
        });
        await page.locator(".character-plan-delete-dialog [data-delete-cancel]").click();
        await expect(page.locator(".character-plan-delete-dialog")).toBeHidden();
        await expect(page.locator(".planner-character-card")).toHaveCount(1);
        await page.locator(".planner-card-remove").click();
        await page.locator(".character-plan-delete-dialog [data-delete-confirm]").click();
        await expect(page.locator(".cyrene-toast-message")).toHaveText(
            "Unowned removed from Character Planner.",
        );
        await expect(page.locator(".planner-character-card")).toHaveCount(0);
        expect(saved).toEqual([]);
        expect(errors).toEqual([]);
    });
}
