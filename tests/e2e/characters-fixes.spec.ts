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
base='''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/static/build/css/global.css"><link rel="stylesheet" href="/static/build/css/characters.css"></head><body><script type="module" src="/static/build/browser/core/toasts.js"></script><div style="position:fixed;top:0;left:0;right:0;height:60px;z-index:1001;pointer-events:none">Mobile header</div>{% block content %}{% endblock %}<script src="/static/build/browser/pages/characters/characters-talents.js"></script><script src="/static/build/browser/pages/characters/characters-filters.js"></script><script src="/static/build/browser/pages/characters/characters-showcase.js"></script><script src="/static/build/browser/core/planner-materials.js"></script><script src="/static/build/browser/pages/characters/characters-planner.js"></script><script src="/static/build/browser/pages/characters/characters-tabs.js"></script><script>initCharactersFilters();initCharacterShowcase();initCharacterPlanner();initCharactersTabs()</script></body></html>'''
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
        let releasePlans!: () => void;
        const initialPlans = new Promise<void>((resolve) => (releasePlans = resolve));
        let saved: any[] = [];
        let writes = 0;
        let failShowcase = false;
        let holdNextShowcase = false;
        let releaseShowcase!: () => void;
        const costRequests: URL[] = [];
        let showcaseCalls = 0;
        let equippedLevel = 70;
        let equippedRefinement = 3;
        let totalFixture = false;
        let htmlCostResponse = false;
        let holdNextCost = false;
        let releaseCost!: () => void;
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
        await page.route("https://assets.test/**", (route) =>
            route.fulfill({
                body: readFileSync(`website/static/images/characters/Element_Cryo.webp`),
                contentType: "image/webp",
            }),
        );
        await page.route("**/api/**", async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname === "/api/characters/plans") {
                if (route.request().method() === "GET") await initialPlans;
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
                                icon: "https://assets.test/blade.webp",
                                tag: {
                                    label: "Exploration",
                                    source: "Exploration",
                                    kind: "source",
                                },
                            },
                            {
                                id: 11509,
                                name: "Mistsplitter Reforged",
                                rarity: 5,
                                type: "Sword",
                                icon: "https://assets.test/mistsplitter.webp",
                                tag: {
                                    label: "Ayaka's Signature",
                                    source: "Gacha",
                                    kind: "signature",
                                },
                            },
                            {
                                id: 15501,
                                name: "Skyward Harp",
                                rarity: 5,
                                type: "Bow",
                                icon: character.icon,
                            },
                        ],
                    },
                });
            if (url.pathname.endsWith("/showcase")) {
                showcaseCalls++;
                if (failShowcase)
                    return route.fulfill({
                        status: 502,
                        json: { error: "HoYoLAB temporarily unavailable." },
                    });
                if (holdNextShowcase) {
                    holdNextShowcase = false;
                    await new Promise<void>((resolve) => (releaseShowcase = resolve));
                }
                return route.fulfill({
                    json: {
                        data: {
                            characters: [
                                {
                                    ...character,
                                    weapon: {
                                        id: 14302,
                                        type: 10,
                                        ascension: 4,
                                        refinement: equippedRefinement,
                                        name: "Thrilling Tales of Dragon Slayers",
                                        rarity: 3,
                                        level: equippedLevel,
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
            }
            if (url.pathname.endsWith("/planner-costs")) {
                costRequests.push(url);
                if (holdNextCost) {
                    holdNextCost = false;
                    await new Promise<void>((resolve) => (releaseCost = resolve));
                }
                if (htmlCostResponse)
                    return route.fulfill({
                        status: 502,
                        contentType: "text/html",
                        body: "<!doctype html><html><body>Bad gateway</body></html>",
                    });
                if (totalFixture)
                    return route.fulfill({
                        json: {
                            costs: {
                                level: {
                                    status: "ok",
                                    items: [
                                        {
                                            id: 202,
                                            name: "Mora",
                                            amount: 1234,
                                            rarity: 3,
                                            icon: character.icon,
                                        },
                                    ],
                                },
                                talents: { status: "complete", items: [] },
                                weapon: { status: "complete", items: [] },
                            },
                        },
                    });

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
            }
            return route.fulfill({ json: {} });
        });
        await page.route("**/characters?*", (route) =>
            route.fulfill({ contentType: "text/html", body: shell }),
        );
        await page.goto("/characters?account_id=1");
        await page.locator('[data-characters-tab="planner"]').click();
        await expect(page.locator("[data-planner-empty]")).toBeHidden();
        await expect(page.locator("[data-planner-loading]")).toBeVisible();
        releasePlans();
        await expect(page.locator("[data-planner-loading]")).toBeHidden();
        await page.locator('[data-characters-tab="characters"]').click();
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
        await expect(page.locator(".planner-picker-rarity .cyrene-rarity-star")).toHaveCount(2);
        const backgrounds = await page
            .locator(".planner-picker-character .planner-picker-portrait")
            .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundImage));
        expect(backgrounds.every((background) => background.includes("linear-gradient"))).toBe(
            true,
        );
        const purpleBackground = await page
            .locator(".planner-picker-character")
            .last()
            .evaluate((node) => {
                const previous = (node as HTMLElement).dataset.plannerCharacterRarity;
                (node as HTMLElement).dataset.plannerCharacterRarity = "4";
                const colour = getComputedStyle(
                    node.querySelector(".planner-picker-portrait")!,
                ).backgroundImage;
                (node as HTMLElement).dataset.plannerCharacterRarity = previous;
                return colour;
            });
        expect(purpleBackground).not.toBe(backgrounds[0]);
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
        const weaponModal = page.getByRole("dialog", { name: "Choose weapon", exact: true });
        await expect(weaponModal).toBeVisible();
        const bounds = await weaponModal.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await expect(weaponModal.locator(".weapon-card")).toHaveCount(2);
        if (width === 1280) {
            const controls = await weaponModal
                .locator(".planner-weapon-picker-filters > *")
                .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().bottom));
            expect(Math.max(...controls) - Math.min(...controls)).toBeLessThan(1);
        }
        const cardBounds = await weaponModal.locator(".weapon-card").evaluateAll((cards) =>
            cards.map((card) => {
                const rect = card.getBoundingClientRect();
                return { x: rect.x, y: rect.y };
            }),
        );
        expect(Math.abs(cardBounds[0].y - cardBounds[1].y)).toBeLessThan(1);
        expect(cardBounds[1].x).toBeGreaterThan(cardBounds[0].x);

        await page.getByRole("searchbox", { name: "Search weapons" }).fill("missing");
        await expect(weaponModal.locator(".weapon-card")).toHaveCount(0);
        await expect(weaponModal.locator("[role=status]")).toHaveText(
            "Showing 0 of 2 weapons | 2 Total",
        );
        await page.getByRole("searchbox", { name: "Search weapons" }).fill("Ayaka");
        await expect(weaponModal.locator(".weapon-card")).toHaveCount(1);
        await expect(weaponModal.locator(".weapon-tag")).toHaveText("Ayaka's Signature");
        await page.getByRole("searchbox", { name: "Search weapons" }).fill("");
        await page.getByRole("button", { name: "Weapon rarity", exact: true }).click();
        await page.getByRole("option", { name: "5-star", exact: true }).click();
        await expect(weaponModal.locator(".weapon-card")).toHaveCount(1);
        await weaponModal.getByRole("button", { name: "Reset", exact: true }).click();
        await expect(weaponModal.locator(".weapon-card")).toHaveCount(2);
        await page.screenshot({
            path: `test-results/planner-weapon-modal-${width}.png`,
            animations: "disabled",
        });
        await page.keyboard.press("Escape");
        await expect(weaponModal).toBeHidden();
        await expect(page.locator("[data-planner-editor]")).toBeVisible();
        await page.getByRole("button", { name: "Choose weapon", exact: true }).click();
        await page.getByRole("button", { name: "Dull Blade", exact: true }).click();
        await expect(page.locator("[data-planner-current-weapon-name]")).toHaveText("Dull Blade");
        const currentWeaponLevel = page.locator(
            ".planner-current-weapon-level-field .planner-choice-trigger",
        );
        await expect(currentWeaponLevel).toBeEnabled();
        await currentWeaponLevel.click();
        await expect(page.locator(".planner-choice-menu .planner-choice-option")).toHaveText([
            "Lv. 1",
            "Lv. 20",
            "Lv. 40",
            "Lv. 50",
            "Lv. 60",
            "Lv. 70",
        ]);
        await page
            .locator(".planner-choice-menu .planner-choice-option")
            .filter({ hasText: "Lv. 20" })
            .click();
        await expect(page.locator("[data-planner-current-weapon-level]")).toHaveText("Lv. 20");
        await expect(page.locator("[data-planner-current-weapon-level-input]")).toHaveValue("20");
        await page.locator("[data-planner-weapon-level]").evaluate((select: HTMLSelectElement) => {
            select.value = "1";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await expect(page.locator("[data-planner-current-weapon-level-input]")).toHaveValue("20");
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
            selects.forEach((select, index) => {
                (select as HTMLSelectElement).value = index === 1 ? "10" : "1";
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
        const row = await page.locator(".planner-card-talents").boundingBox();
        expect(
            Math.abs((groups[0].x + groups[2].right) / 2 - (row!.x + row!.width / 2)),
        ).toBeLessThan(1);
        for (const circle of await page.locator(".planner-card-talent-key").all()) {
            const alignment = await circle.evaluate((key) => {
                const outer = key.getBoundingClientRect();
                const inner = key.querySelector("svg")!.getBoundingClientRect();
                return {
                    x: Math.abs(outer.left + outer.width / 2 - inner.left - inner.width / 2),
                    y: Math.abs(outer.top + outer.height / 2 - inner.top - inner.height / 2),
                };
            });
            expect(alignment.x).toBeLessThan(0.1);
            expect(alignment.y).toBeLessThan(0.1);
        }
        for (let index = 1; index < groups.length; index++) {
            if (Math.abs(groups[index].y - groups[index - 1].y) < 1)
                expect(groups[index].x - groups[index - 1].right).toBeCloseTo(10, 0);
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
        await page.locator("[data-planner-add]:visible").first().click();
        await page.locator("[data-planner-ownership-control] .custom-select-button").click();
        await page.locator("[data-planner-ownership-control] [data-value=all]").click();
        if (width === 1280) totalFixture = true;
        await page.locator('[data-planner-character-id="10000002"]').click();
        await expect(page.locator("[data-planner-current-level]")).toHaveText("Lv. 40");
        if (width === 1280) {
            await expect(page.locator("[data-planner-cost=level] .planner-cost-entry")).toHaveCount(
                1,
            );
            const showcaseBeforeTotal = showcaseCalls;
            failShowcase = true;
            const total = page.locator("[data-planner-total-content]");
            await page.locator("[data-planner-total]").click();
            await expect(total.locator(".planner-cost-entry")).toHaveCount(1);
            expect(showcaseCalls).toBe(showcaseBeforeTotal);
            htmlCostResponse = true;
            await page.locator("[data-planner-level]").evaluate((select: HTMLSelectElement) => {
                select.value = "80";
                select.dispatchEvent(new Event("change", { bubbles: true }));
            });
            await expect(total).toContainText(
                "Couldn't load material data from the server. Please try again.",
            );
            await expect(total).not.toContainText("Unexpected token");
            await expect(total).not.toContainText("doctype");
            htmlCostResponse = false;
            await total.getByRole("button", { name: "Try again", exact: true }).click();
            await expect(total.locator(".planner-cost-entry")).toHaveCount(1);
            await page.locator("[data-planner-total]").click();
            const level90RequestsBefore = costRequests.filter(
                (url) =>
                    url.pathname.includes("10000002") &&
                    url.searchParams.get("target_level") === "90",
            ).length;
            holdNextCost = true;
            await page.locator("[data-planner-level]").evaluate((select: HTMLSelectElement) => {
                select.value = "90";
                select.dispatchEvent(new Event("change", { bubbles: true }));
            });
            await expect.poll(() => typeof releaseCost).toBe("function");
            await page.locator("[data-planner-total]").click();
            releaseCost();
            await expect(total.locator(".planner-cost-entry")).toHaveCount(1);
            expect(
                costRequests.filter(
                    (url) =>
                        url.pathname.includes("10000002") &&
                        url.searchParams.get("target_level") === "90",
                ),
            ).toHaveLength(level90RequestsBefore + 1);
            await page.screenshot({
                path: "test-results/planner-total-recovery.png",
                animations: "disabled",
            });
            await page.locator("[data-planner-total]").click();
            failShowcase = false;
        }

        await page.locator('[data-planner-tab="weapon"]').click();
        await expect(page.locator("[data-planner-current-weapon-name]")).toHaveText(
            "Thrilling Tales of Dragon Slayers",
        );
        await expect(page.locator("[data-planner-current-weapon-level]")).toHaveText("Lv. 70");
        await page.getByRole("button", { name: "Choose weapon", exact: true }).click();
        await page.getByRole("button", { name: "Dull Blade", exact: true }).click();
        await expect(page.locator("[data-planner-current-weapon-name]")).toHaveText("Dull Blade");
        await expect(page.locator("[data-planner-current-weapon-level]")).toHaveText("Lv. 1");
        await expect(page.locator("[data-planner-current-level]")).toHaveText("Lv. 40");

        failShowcase = true;
        await page.getByRole("button", { name: "Sync from HoYoLAB", exact: true }).click();
        await expect(page.locator("[data-planner-weapon-status]")).toHaveText(
            "HoYoLAB temporarily unavailable.",
        );
        await expect(page.locator("[data-planner-current-weapon-name]")).toHaveText("Dull Blade");
        await expect(
            page.getByRole("button", { name: "Sync from HoYoLAB", exact: true }),
        ).toBeEnabled();
        failShowcase = false;
        await page.getByRole("button", { name: "Sync from HoYoLAB", exact: true }).click();
        await expect(page.locator("[data-planner-weapon-status]")).toBeEmpty();
        await expect(page.locator("[data-planner-current-weapon-name]")).toHaveText(
            "Thrilling Tales of Dragon Slayers",
        );
        await expect(page.locator("[data-planner-current-weapon-level]")).toHaveText("Lv. 70");
        await expect(page.locator("[data-planner-weapon-level]")).toHaveValue("70");
        await expect
            .poll(() =>
                costRequests.some(
                    (url) =>
                        url.searchParams.get("weapon_name") ===
                            "Thrilling Tales of Dragon Slayers" &&
                        url.searchParams.get("current_weapon_level") === "70" &&
                        url.searchParams.get("weapon_ascension") === "4",
                ),
            )
            .toBe(true);
        await page.screenshot({
            path: `test-results/planner-synced-weapon-${width}.png`,
            animations: "disabled",
        });
        await page.locator("[data-planner-save]").click();
        await expect(page.locator("[data-planner-editor]")).toBeHidden();
        await expect(page.locator(".planner-card-equipped-weapon")).toContainText(
            "Thrilling Tales of Dragon Slayers",
        );
        await expect(page.locator(".planner-card-no-weapon")).toHaveCount(0);
        await page.reload();
        await page.locator('[data-characters-tab="planner"]').click();
        await page.locator(".planner-card-edit").click();
        await page.locator('[data-planner-tab="weapon"]').click();
        await expect(page.locator("[data-planner-current-weapon-level]")).toHaveText("Lv. 70");
        holdNextShowcase = true;
        await page.getByRole("button", { name: "Sync from HoYoLAB", exact: true }).click();
        await expect(page.getByRole("button", { name: "Syncing...", exact: true })).toBeDisabled();
        await page.getByRole("button", { name: "Choose weapon", exact: true }).click();
        await page.getByRole("button", { name: "Dull Blade", exact: true }).click();
        await expect(page.locator("[data-planner-current-weapon-level]")).toHaveText("Lv. 1");
        releaseShowcase();
        await expect(page.locator("[data-planner-current-weapon-name]")).toHaveText("Dull Blade");
        await page.locator(".planner-editor-close").click();
        await page.locator(".planner-card-edit").click();
        await page.locator('[data-planner-tab="weapon"]').click();
        await expect(page.locator("[data-planner-current-weapon-level]")).toHaveText("Lv. 70");
        await page.locator(".planner-editor-close").click();
        await page.locator("[data-planner-add]:visible").first().click();
        await page.locator('[data-planner-character-id="10000003"]').click();
        await page.locator("[data-planner-save]").click();
        await expect(page.locator(".planner-character-card")).toHaveCount(2);
        await page.evaluate(() => (document.documentElement.dataset.hoverEffects = "off"));
        await page.locator(".planner-character-card").first().hover();
        await expect(page.locator(".planner-character-card").first()).toHaveCSS(
            "transform",
            "none",
        );
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.evaluate(() => (document.documentElement.dataset.hoverEffects = "on"));
        await expect(page.locator(".planner-character-card").first()).toHaveCSS(
            "transform",
            "none",
        );
        const firstCard = page.locator(".planner-character-card").first();
        const secondCard = page.locator(".planner-character-card").nth(1);
        await secondCard.scrollIntoViewIfNeeded();
        const firstRect = await firstCard.boundingBox();
        const secondRect = await secondCard.boundingBox();
        await page.mouse.move(firstRect!.x + 40, firstRect!.y + 55);
        await page.mouse.down();
        await page.waitForTimeout(300);
        await expect(page.locator(".planner-card-drag-preview")).toBeVisible();
        await page.mouse.move(secondRect!.x + 40, secondRect!.y + 55, { steps: 5 });
        await page.mouse.up();
        await expect(page.locator(".planner-card-drag-preview")).toHaveCount(0);
        await expect(page.locator(".planner-character-card").first()).toHaveAttribute(
            "data-plan-id",
            "10000003",
        );
        await expect.poll(() => String(saved[0]?.id)).toBe("10000003");
        await page.reload();
        await page.locator('[data-characters-tab="planner"]').click();
        await expect(page.locator(".planner-character-card").first()).toHaveAttribute(
            "data-plan-id",
            "10000003",
        );
        await page.locator(".planner-character-card").first().focus();
        await page.keyboard.press("Alt+ArrowRight");
        await expect(page.locator(".planner-character-card").first()).toHaveAttribute(
            "data-plan-id",
            "10000002",
        );
        await page.locator('[data-plan-id="10000002"] .planner-card-edit').click();
        await page.locator('[data-planner-tab="weapon"]').click();
        await page.getByRole("button", { name: "Choose weapon", exact: true }).click();
        await page.getByRole("button", { name: "Dull Blade", exact: true }).click();
        await expect(page.locator("[data-planner-current-weapon-level]")).toHaveText("Lv. 1");
        await page.locator("[data-planner-save]").click();
        await expect
            .poll(() => saved.find((plan) => String(plan.id) === "10000002")?.weaponSource)
            .toBe("manual");
        await page.reload();
        await page.locator('[data-characters-tab="planner"]').click();
        await expect(
            page.locator('[data-plan-id="10000002"] .planner-card-equipped-weapon'),
        ).toContainText("Dull Blade");
        await page.locator('[data-plan-id="10000002"] .planner-card-edit').click();
        await page.locator('[data-planner-tab="weapon"]').click();
        await expect(page.locator("[data-planner-current-weapon-level]")).toHaveText("Lv. 1");
        // Older and manually selected snapshots of the equipped weapon must also follow HoYoLAB.
        for (const source of ["manual", undefined]) {
            saved = saved.map((plan) =>
                String(plan.id) === "10000002"
                    ? {
                          ...plan,
                          weaponSource: source,
                          plannedWeapon: {
                              id: 14302,
                              name: "Thrilling Tales of Dragon Slayers",
                              type: "Sword",
                              rarity: 3,
                              icon: "https://assets.test/weapon.webp",
                              level: 70,
                              refinement: 3,
                          },
                          currentWeaponName: "Thrilling Tales of Dragon Slayers",
                          currentWeaponLevel: 70,
                      }
                    : plan,
            );
            equippedLevel = 80;
            equippedRefinement = 5;
            await page.reload();
            await page.locator('[data-characters-tab="planner"]').click();
            await expect
                .poll(
                    () =>
                        saved.find((plan) => String(plan.id) === "10000002")?.plannedWeapon
                            ?.refinement,
                )
                .toBe(5);
            await expect
                .poll(() => saved.find((plan) => String(plan.id) === "10000002")?.weaponSource)
                .toBe("hoyolab");
            await page.locator('[data-plan-id="10000002"] .planner-card-edit').click();
            await page.locator('[data-planner-tab="weapon"]').click();
            await expect(page.locator("[data-planner-current-weapon-level]")).toHaveText("Lv. 80");
            await page.keyboard.press("Escape");
        }
        expect(errors).toEqual([]);
    });
}
