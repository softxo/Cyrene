import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("Characters refreshes progression without replacing controls or editing a draft", async ({
    page,
}) => {
    await page.clock.install();
    const roster = (level: number) => `<main class="characters-page">
        <input name="account_id" value="1"><input data-character-search value="Ayaka">
        <div class="characters-grid"><article class="character-card" data-character-id="2" data-owned="true" data-level="${level}">Lv. ${level}</article></div>
        <button data-planner-character-id="2" data-planner-character-level="${level}">Ayaka</button>
        <div class="planner-editor" hidden><input value="unsaved goal"></div>
        </main>`;
    let level = 40;
    let requests = 0;
    await page.route("**/characters?*", (route) => {
        requests++;
        return route.fulfill({ contentType: "text/html", body: roster(level) });
    });
    await page.route("**/characters", (route) =>
        route.fulfill({ contentType: "text/html", body: roster(level) }),
    );
    await page.goto("/characters");
    await page.addScriptTag({
        content: readFileSync(
            "website/static/build/browser/pages/characters/characters.js",
            "utf8",
        ),
    });
    await page.evaluate(() => (window as any).initCharactersAutoRefresh());
    level = 90;
    await page.clock.runFor(120_001);
    await expect(page.locator(".character-card")).toHaveText("Lv. 90");
    await expect(page.locator("[data-planner-character-id]")).toHaveAttribute(
        "data-planner-character-level",
        "90",
    );
    await expect(page.locator("[data-character-search]")).toHaveValue("Ayaka");
    await page.locator(".planner-editor").evaluate((el) => ((el as HTMLElement).hidden = false));
    level = 80;
    await page.clock.runFor(120_001);
    expect(requests).toBe(1);
    await expect(page.locator(".planner-editor input")).toHaveValue("unsaved goal");
    await page.locator(".planner-editor").evaluate((el) => ((el as HTMLElement).hidden = true));
    await page.clock.runFor(120_001);
    await expect(page.locator(".character-card")).toHaveText("Lv. 80");
});
