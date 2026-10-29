import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const python =
    process.env.PYTHON ||
    (existsSync(".venv/Scripts/python.exe") ? ".venv/Scripts/python.exe" : "python");
const fixtures = JSON.parse(
    execFileSync(python, ["-m", "tests.fixtures.security_pages"], { encoding: "utf8" }),
);
const script = (path: string) =>
    readFileSync(`website/static/build/browser/pages/${path}.js`, "utf8");
const attack = '<img src="https://attack.invalid/image" onerror="window.injected=true">';

for (const version of ["v3", "v4"]) {
    test(`CAPTCHA ${version} metadata stays data and success UI still works`, async ({ page }) => {
        const fixture = fixtures[version];
        await page.route("https://static.geetest.com/**", (route) =>
            route.fulfill({
                contentType: "application/javascript",
                body: `window.initGeetest = window.initGeetest4 = (params, callback) => {
                window.sdkParams = params;
                callback({onReady: f => f(), showCaptcha(){}, verify(){}, onError(){},
                    onSuccess: f => { window.finishCaptcha = f },
                    getValidate: () => ({geetest_challenge:'challenge', geetest_validate:'valid',
                        geetest_seccode:'code', captcha_id:'id', lot_number:'lot', pass_token:'pass',
                        gen_time:'time', captcha_output:'output'})});
            };`,
            }),
        );
        let submitted;
        await page.route(`**/challenge/${fixture.token}/send-data`, async (route) => {
            submitted = route.request().postDataJSON();
            await route.fulfill({ json: { success: true } });
        });
        await page.route("**/security-fixture", (route) =>
            route.fulfill({ contentType: "text/html", body: fixture.html }),
        );
        await page.goto("/security-fixture");
        await expect.poll(() => page.evaluate(() => Boolean(window["sdkParams"]))).toBe(true);
        expect(await page.evaluate(() => window["injected"])).toBeUndefined();
        await expect(page.locator("script")).toHaveCount(2);
        expect(
            await page.evaluate(
                (v) => window["sdkParams"][v === "v4" ? "captchaId" : "gt"],
                version,
            ),
        ).toBe(fixture.payload);
        await page.evaluate(() => window["finishCaptcha"]());
        await expect(page.getByRole("heading", { name: "CAPTCHA verified" })).toBeVisible();
        expect(submitted.session_id).toBe(fixture.payload);
    });
}

test("showcase inert formatting preserves text and C3/C5 talent rendering", async ({ page }) => {
    const blocked: string[] = [];
    await page.route("https://attack.invalid/**", (route) => {
        blocked.push(route.request().url());
        return route.abort();
    });
    await page.route("**/security-fixture", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: `
        <div class="characters-page"><div data-character-showcase>
        <div class="character-showcase-modal" tabindex="-1"></div><div data-showcase-card></div>
        <img data-showcase-portrait><h2 id="showcase-character-name"></h2>
        ${["element", "level", "status", "weapon", "stats", "artifacts", "sets", "talents", "constellations", "error"].map((x) => `<div data-showcase-${x}></div>`).join("")}
        </div></div>`,
        }),
    );
    await page.goto("/security-fixture");
    await page.addScriptTag({ content: script("characters/characters-talents") });
    // Expose closure-local production functions only in this fixture; application code has no test API.
    const source = script("characters/characters-showcase").replace(
        "let previouslyFocused = null;",
        "window.showcaseTest = {cleanGameText, renderWeapon, renderArtifacts, renderTalents, getPropertyName}; let previouslyFocused = null;",
    );
    await page.addScriptTag({ content: source });
    await page.evaluate(() => window["initCharacterShowcase"]());
    const result = await page.evaluate((payload) => {
        const api = window["showcaseTest"];
        const normal = api.cleanGameText("<color=#fff>ATK</color>\\n{LINK#123} Bonus &amp; Value");
        const malformed = [
            payload,
            "<<img src=x onerror=window.injected=true>>",
            "<CoLoR=#fff>Safe</cOlOr>",
        ].map((value) => api.cleanGameText(value));
        api.renderWeapon({
            weapon: {
                name: `<color=#fff>Sword</color> ${payload}`,
                rarity: 5,
                level: 90,
                refinement: 5,
            },
        });
        api.renderArtifacts({
            artifacts: [1, 2].map((id) => ({
                id,
                pos_name: "<color=red>Flower</color>",
                rarity: 5,
                set: { name: "<color=red>Gladiator</color>" },
                level: 20,
            })),
        });
        api.renderTalents({
            skills: [
                { name: "Normal", skill_type: 1, level: 10 },
                { name: "Skill", skill_type: 1, level: 13 },
                { name: "Burst", skill_type: 1, level: 13 },
            ],
            constellations: [
                { pos: 3, activated: true, effect: "Increases <color=#fff>Skill</color> by 3." },
                { pos: 5, activated: true, effect: "Increases Burst by 3." },
            ],
        });
        return {
            normal,
            malformed,
            property: api.getPropertyName({ name: "<color=red>HP</color>" }),
        };
    }, attack);
    expect(result.normal).toBe("ATK Bonus &amp; Value");
    expect(result.property).toBe("HP");
    await expect(page.locator(".enka-artifact-name").first()).toHaveText("Flower");
    await expect(page.locator(".enka-artifact-set-name")).toHaveText("Gladiator");
    expect(result.malformed[2]).toBe("Safe");
    await expect(page.locator(".enka-weapon-name")).toHaveText("Sword");
    await expect(page.locator(".enka-progression-level.is-max")).toHaveCount(3);
    expect(
        await page
            .locator("[data-showcase-talents] .enka-talent")
            .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("title"))),
    ).toEqual(["Normal", "Skill", "Burst"]);
    expect(await page.evaluate(() => window["injected"])).toBeUndefined();
    await expect(page.locator("[onerror]")).toHaveCount(0);
    expect(blocked).toEqual([]);
});

test("Custom Events keeps escaped DOM text inert through edit, save and reload", async ({
    page,
}) => {
    const item = {
        id: 1,
        title: attack,
        description: 'Quotes " & <b>remain text</b>',
        account_scope: "account",
        account_id: 7,
        start_at: "2026-10-29T10:00:00+00:00",
        end_at: null,
        created_at: "2026-10-29T10:00:00+00:00",
        updated_at: "2026-10-29T10:00:00+00:00",
        recurrence: { type: "none", interval: 1 },
        colour: "#7c83ff",
        reminder_minutes: null,
        progress: [{ title: attack, current: 0, target: 3 }],
        icon_url: null,
        completions: [],
    };
    let saved;
    await page.route("**/api/custom-events**", async (route) => {
        const method = route.request().method();
        if (method === "PUT" || method === "POST") {
            saved = route.request().postDataJSON();
            Object.assign(item, saved);
            await route.fulfill({ json: { success: true, event: item } });
        } else await route.fulfill({ json: { success: true, events: [item] } });
    });
    const uploadedIcon = "/static/uploads/custom-events/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png";
    await page.route("**/api/custom-events/icon", (route) =>
        route.fulfill({ json: { success: true, icon_url: uploadedIcon } }),
    );
    await page.route("**/security-fixture", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: `
        <style>[hidden]{display:none!important}</style><div class="events-page" data-account-id="7">
        <button data-custom-create>Create</button><div data-custom-event-list></div>${fixtures.eventModal}</div>`,
        }),
    );
    await page.goto("/security-fixture");
    await page.addScriptTag({ content: readFileSync("website/static/build/js/app.js", "utf8") });
    await page.addScriptTag({ content: script("events/events-custom") });
    await page.evaluate(() => window["initCustomEvents"]());
    await expect(page.locator(".events-custom-card-title")).toHaveText(attack);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator('[name="title"]')).toHaveValue(attack);
    await expect(page.locator("[data-custom-account-select] .custom-select-value")).toContainText(
        "<script>",
    );
    await expect(page.locator("[data-objective-title]")).toHaveValue(attack);
    await page.locator('[name="title"]').fill("Normal event");
    await page.locator("[data-objective-title]").fill("Collect materials");
    await page.locator(".events-custom-datetime-trigger").first().click();
    await page.getByRole("button", { name: "Today", exact: true }).first().click();
    await page.getByRole("button", { name: "Apply", exact: true }).first().click();
    const filename = '<img onerror="window.injected=true">.png';
    await page.locator("[data-custom-icon-file]").setInputFiles({
        name: filename,
        mimeType: "image/png",
        buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVmQAAAAASUVORK5CYII=",
            "base64",
        ),
    });
    await expect(page.locator("[data-custom-icon-filename]")).toHaveText(filename);
    await expect(page.locator("[data-custom-icon-image]")).toHaveAttribute("src", /^blob:/);
    await page.locator(".events-custom-save").click();
    await expect(page.locator("[data-custom-modal]")).toBeHidden();
    expect(saved.account_id).toBe(7);
    expect(saved.icon_url).toBe(uploadedIcon);
    expect(saved.progress[0].title).toBe("Collect materials");
    await expect(page.locator(".events-custom-card-title")).toHaveText("Normal event");
    await page.reload();
    await page.addScriptTag({ content: readFileSync("website/static/build/js/app.js", "utf8") });
    await page.addScriptTag({ content: script("events/events-custom") });
    await page.evaluate(() => window["initCustomEvents"]());
    await expect(page.locator(".events-custom-card-title")).toHaveText("Normal event");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await page.locator('[name="title"]').fill("Created event");
    await page.locator(".events-custom-datetime-trigger").first().click();
    await page.getByRole("button", { name: "Today", exact: true }).first().click();
    await page.getByRole("button", { name: "Apply", exact: true }).first().click();
    await page.locator("[data-custom-add-objective]").click();
    await page.locator("[data-objective-title]").fill("New objective");
    await page.locator(".events-custom-save").click();
    await expect(page.locator("[data-custom-modal]")).toBeHidden();
    await expect(page.locator(".events-custom-card-title")).toHaveText("Created event");
    expect(saved.account_scope).toBe("all");
    expect(await page.evaluate(() => window["injected"])).toBeUndefined();
    await expect(page.locator("[onerror]")).toHaveCount(0);
});
