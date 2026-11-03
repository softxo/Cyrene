import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function fixture(path: string) {
    return execFileSync(
        ".venv/Scripts/python.exe",
        [
            "-X",
            "utf8",
            "-c",
            String.raw`
import sys
from starlette.requests import Request
from utils.web.app import templates
path=sys.argv[1]
request=Request({'type':'http','method':'GET','path':path,'headers':[],'query_string':b'','scheme':'http','server':('127.0.0.1',8000)})
account={'id':1,'genshin_uid':'777000004','nickname':'Test'}
base={'element':'Cryo','rarity':5,'weapon':'Sword','icon':'/static/images/characters/Element_Cryo.webp','owned':False,'level':None,'constellation':0,'friendship':0}
characters=[dict(base,id=1,name='Ayaka',owned=True,level=90,release_date='2021-07-21'),dict(base,id=2,name='Albedo',release_date='2020-12-23'),dict(base,id=3,name='Mitya',element='Electro',weapon='Catalyst',unreleased=True,release_date='2026-11-04'),dict(base,id=4,name='Valeriy',element='Electro',rarity=4,unreleased=True,release_date='2026-11-04')]
import json
from pathlib import Path
release_dates=json.loads(Path('data/character_release_dates.json').read_text())['dates']
for id,name in enumerate(('Alyosha','Vesna','Vodyanitsa'),5):
    characters.append(dict(base,id=id,name=name,release_date=release_dates.get(name,'')))
print(templates.get_template(path.strip('/')+'.html').render(request=request,accounts=[account],selected_account=account,characters=characters,planner_user_id='10'))
`,
            path,
        ],
        { encoding: "utf8" },
    );
}
const characters = fixture("/characters");
const settings = fixture("/settings");
const previewLevels = JSON.parse(
    execFileSync(
        ".venv/Scripts/python.exe",
        [
            "-c",
            String.raw`
import asyncio,json
from utils.web.preview_materials import preview_entry
from utils.web.planner_costs import _level_cost
class PreviewDB:
    async def get(self,folder,name):
        return preview_entry(folder,name)
async def main():
    return {name:await _level_cost(PreviewDB(),name,1,90,0) for name in ('Mitya','Valeriy')}
print(json.dumps(asyncio.run(main())))
`,
        ],
        { encoding: "utf8" },
    ),
);

test("unreleased content is hidden before scripts, opted into in Settings, sorted first, and can be hidden again without deleting plans", async ({
    page,
}) => {
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
                        : path.endsWith(".png")
                          ? "image/png"
                          : "image/webp",
            });
        } catch {
            return route.fulfill({ status: 404, body: "" });
        }
    });
    let writes = 0;
    await page.route("https://static.nanoka.cc/**", (route) =>
        route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="gray"/></svg>',
        }),
    );
    await page.route("**/api/**", (route) => {
        const url = new URL(route.request().url());
        const path = url.pathname;
        if (route.request().method() === "PUT") writes++;
        if (path.endsWith("/planner-costs"))
            return route.fulfill({
                json: {
                    costs: {
                        level:
                            url.searchParams.get("target_level") === "1"
                                ? { status: "complete", items: [] }
                                : previewLevels[url.searchParams.get("character_name")!],
                        talents: { status: "complete", items: [] },
                        weapon: { status: "unavailable", items: [] },
                    },
                },
            });
        if (path === "/api/characters/plans")
            return route.fulfill({
                json: {
                    snapshot_exists: true,
                    plans: [
                        {
                            id: 3,
                            name: "Mitya",
                            element: "Electro",
                            rarity: 5,
                            icon: "/static/images/characters/Element_Cryo.webp",
                            notes: "Keep this plan",
                            level: 90,
                            talents: [1, 1, 1],
                        },
                    ],
                },
            });
        return route.fulfill({ json: { accounts: [] } });
    });
    await page.route("**/characters", (route) =>
        route.fulfill({ contentType: "text/html", body: characters }),
    );
    await page.route("**/settings", (route) =>
        route.fulfill({ contentType: "text/html", body: settings }),
    );
    let releaseFilters!: () => void;
    let holdFilters = true;
    const filters = new Promise<void>((resolve) => (releaseFilters = resolve));
    await page.route("**/characters/characters-filters.js?*", async (route) => {
        if (holdFilters) await filters;
        await route.fulfill({
            contentType: "text/javascript",
            body: readFileSync(
                "website/static/build/browser/pages/characters/characters-filters.js",
            ),
        });
    });
    await page.goto("/characters", { waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-character-id="3"]')).toBeHidden();
    holdFilters = false;
    releaseFilters();
    await expect(page.locator("[data-character-filters]")).toHaveAttribute(
        "data-initialised",
        "true",
    );
    await expect(page.locator('[data-character-id="4"]')).toBeHidden();
    await expect(page.locator("[data-character-count] [data-count-total]")).toHaveText("5");
    await page.locator('[data-characters-tab="planner"]').click();
    await expect(page.locator(".planner-character-card")).toHaveCount(0);
    await page.locator("[data-planner-add]").first().click();
    const releasedPickerNames = await page
        .locator(".planner-picker-character:visible")
        .evaluateAll((buttons) =>
            buttons.map((button) => (button as HTMLElement).dataset.plannerCharacterName),
        );
    expect(releasedPickerNames.slice(0, 3)).toEqual(["Vesna", "Vodyanitsa", "Alyosha"]);
    await page.goto("/settings");
    const toggle = page.getByRole("button", { name: "Show Unreleased content", exact: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).not.toHaveClass(/active/);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveClass(/active/);
    const rowGap = await page
        .locator(".settings-toggle")
        .evaluateAll(
            (rows) => rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom,
        );
    expect(rowGap).toBe(10);
    await page.goto("/characters");
    await expect(page.locator('[data-character-id="3"]')).toBeVisible();
    await expect(page.locator('[data-character-id="3"] .cyrene-unreleased-badge')).toHaveText(
        "Unreleased",
    );
    await expect(page.locator("[data-character-count] [data-count-total]")).toHaveText("7");
    await page.locator('[data-characters-tab="planner"]').click();
    await expect(page.locator(".planner-character-card")).toHaveCount(1);
    await page.locator("[data-planner-add]").first().click();
    await expect(page.locator(".planner-picker-character").first()).toHaveAttribute(
        "data-planner-character-name",
        "Mitya",
    );
    await expect(page.locator(".planner-picker-character").nth(1)).toHaveAttribute(
        "data-planner-character-name",
        "Valeriy",
    );
    const badgePlacement = await page
        .locator('[data-planner-character-id="3"] .character-release-badge')
        .evaluate((badge) => {
            const pill = badge.getBoundingClientRect();
            const portrait = badge.parentElement!.getBoundingClientRect();
            return {
                centreOffset: Math.abs(
                    (pill.left + pill.right - portrait.left - portrait.right) / 2,
                ),
                bottomGap: portrait.bottom - pill.bottom,
            };
        });
    expect(badgePlacement.centreOffset).toBeLessThan(1);
    expect(badgePlacement.bottomGap).toBe(4);
    await page.locator('[data-planner-character-id="3"]').click();
    await expect(page.locator('[data-planner-cost="level"]')).toContainText("Preview materials");
    await expect(
        page.locator('[data-planner-cost="level"] button[aria-label^="Crystalfold:"]'),
    ).toHaveAttribute("aria-label", /168 required.*unavailable/);
    await expect(
        page.locator(
            '[data-planner-cost="level"] button[aria-label^="Shattered Stabilizing Anchor:"]',
        ),
    ).toHaveAttribute("aria-label", /46 required/);
    const previewNote = page.locator('[data-planner-cost="level"] .planner-cost-message');
    await expect(previewNote).toHaveCSS("opacity", "0.65");
    await expect(previewNote).toHaveCSS("margin-bottom", "16px");
    for (const name of ["Crystalfold", "Shattered Stabilizing Anchor"]) {
        const icon = page.locator(`[data-planner-cost="level"] button[aria-label^="${name}:"] img`);
        await expect(icon).toHaveAttribute("src", /\/static\/images\/materials\/preview\//);
        await expect
            .poll(() =>
                icon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
            )
            .toBe(true);
    }
    await page.screenshot({
        path: "test-results/mitya-preview-materials.png",
        animations: "disabled",
    });
    await page.locator(".planner-editor-close").click();
    await page.locator("[data-planner-add]").first().click();
    await page.locator('[data-planner-character-id="4"]').click();
    await page.locator("[data-planner-level]").evaluate((select: HTMLSelectElement) => {
        select.value = "90";
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(
        page.locator('[data-planner-cost="level"] button[aria-label^="Fairy Wormwood:"]'),
    ).toHaveAttribute("aria-label", /168 required.*unavailable/);
    await expect(
        page.locator(
            '[data-planner-cost="level"] button[aria-label^="Severed Tail of the Sky-Roamer:"]',
        ),
    ).toHaveAttribute("aria-label", /46 required/);
    const wormwoodIcon = page.locator(
        '[data-planner-cost="level"] button[aria-label^="Fairy Wormwood:"] img',
    );
    await expect
        .poll(() =>
            wormwoodIcon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
    await page.locator(".planner-editor-close").click();
    await page.goto("/settings");
    await expect(toggle).toHaveClass(/active/);
    await toggle.click();
    await expect(toggle).not.toHaveClass(/active/);
    await page.goto("/characters");
    await expect(page.locator('[data-character-id="3"]')).toBeHidden();
    await page.locator('[data-characters-tab="planner"]').click();
    await expect(page.locator(".planner-character-card")).toHaveCount(0);
    expect(writes).toBe(0);
});
