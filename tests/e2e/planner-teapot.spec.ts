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
env = Environment(loader=FileSystemLoader('website/templates'))
source = env.loader.get_source(env, 'planner.html')[0].replace('{% extends "base.html" %}', '')
print(env.from_string(source).render(accounts=[]))
`,
    ],
    { encoding: "utf8" },
);

for (const width of [390, 1485]) {
    test(`Serenitea Pot tracks currency and creates reminders at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 950 });
        const accounts = [
            {
                genshin_uid: "777000001",
                nickname: "Test account",
                level: 60,
                current_resin: 200,
                max_resin: 200,
                replenished_at: null,
                full_resin_at: null,
                expeditions: [],
                teapot: {
                    current: 1200,
                    maximum: 2000,
                    full_at: Math.floor(Date.now() / 1000) + 3600,
                },
            },
            {
                genshin_uid: "777000002",
                nickname: "Unavailable account",
                level: 55,
                current_resin: 200,
                max_resin: 200,
                replenished_at: null,
                full_resin_at: null,
                expeditions: [],
                teapot: null,
            },
        ];
        let completed = false;
        await page.route("http://planner.test/api/reminders", (route) =>
            route.fulfill({
                json: {
                    accounts,
                    reminders:
                        payload && !completed
                            ? [
                                  {
                                      id: 1,
                                      type: payload.type,
                                      mode: payload.mode,
                                      genshin_uid: payload.genshin_uid,
                                      config: payload.config,
                                  },
                              ]
                            : [],
                },
            }),
        );
        let payload: any;
        await page.route("http://planner.test/api/reminders", (route) => {
            if (route.request().method() === "GET") return route.fallback();
            payload = route.request().postDataJSON();
            return route.fulfill({ json: { success: true, id: 1 } });
        });
        await page.route("http://planner.test/?tab=teapot", (route) =>
            route.fulfill({ contentType: "text/html", body: html }),
        );
        await page.goto("http://planner.test/?tab=teapot");
        await page.addStyleTag({
            content:
                readFileSync("website/static/build/css/global.css", "utf8") +
                readFileSync("website/static/build/css/planner.css", "utf8"),
        });
        await page.addScriptTag({
            content: readFileSync("website/static/build/browser/pages/planner.js", "utf8"),
        });
        await page.evaluate(() => {
            (window as any).initPlanner();
        });
        const panel = page.locator("#planner-panel-teapot");
        await expect(panel).toBeVisible();
        await expect(panel.locator("#teapot-accounts .planner-card")).toHaveCount(2);
        await expect(panel.locator("[data-teapot-timestamp]")).toContainText("in 59m");
        await expect(panel.locator("#teapot-accounts")).toContainText("1200");
        await expect(panel.locator("#teapot-accounts")).toContainText("Unavailable");
        await page.locator("#add-teapot-reminder-button").click();
        await expect(page.locator("#reminder-type")).toHaveValue("teapot");
        await expect(page.locator("#reminder-type-select .custom-select-button")).toHaveText(
            "Serenitea Pot",
        );
        await expect(page.locator("#reminder-currency-label")).toHaveText("Realm Currency");
        await page.locator("#reminder-type-select .custom-select-button").click();
        const teapotOption = page.locator('#reminder-type-menu [data-value="teapot"]');
        await expect(teapotOption).toBeEnabled();
        await page.locator('#reminder-type-menu [data-value="resin"]').click();
        await expect(page.locator("#reminder-currency-label")).toHaveText("Resin");
        await page.locator("#reminder-type-select .custom-select-button").click();
        await teapotOption.click();
        await expect(page.locator("#reminder-type-select .custom-select-button")).toHaveText(
            "Serenitea Pot",
        );
        await expect(page.locator("#reminder-currency-label")).toHaveText("Realm Currency");

        await expect(page.locator("#reminder-resin-configuration")).toBeVisible();
        await expect(page.locator("#reminder-amount")).toBeDisabled();
        await page.locator("#reminder-account-button").click();
        await page.locator('#reminder-account-menu [data-value="777000001"]').click();
        await expect(page.locator("#reminder-amount")).toHaveValue("2000");
        await expect(page.locator("#reminder-amount")).toHaveAttribute("max", "2000");
        await page.getByRole("button", { name: "Decrease Realm Currency", exact: true }).click();
        await expect(page.locator("#reminder-amount")).toHaveValue("1999");
        await page.locator("#reminder-amount").fill("1400");
        await page.evaluate(() => {
            (document.querySelector("#reminder-account") as HTMLInputElement).value = "777000001";
        });
        await page.locator("#reminder-create-mode-select .custom-select-button").click();
        await page.locator('#reminder-create-mode-select [data-value="manual"]').click();
        await expect(page.locator("#reminder-mode-help")).toContainText("No fixed expiry");
        await expect(page.locator("#reminder-mode-help")).toContainText(
            "after successful delivery",
        );
        await page.locator("#reminder-save-button").click();
        await expect.poll(() => payload?.type).toBe("teapot");
        expect(payload.mode).toBe("manual");
        await expect(panel.locator(".reminder-lifetime")).toContainText("sends once");
        expect(payload.genshin_uid).toBe("777000001");
        expect(payload.config.amount).toBe(1400);
        completed = true;
        await page.evaluate(async () => {
            (document.activeElement as HTMLElement)?.blur();
            await (window as any).refreshResin();
        });
        await expect(panel.locator(".reminder-card")).toHaveCount(0);

        await expect(page.locator("#reminder-save-button")).toHaveText("Add Reminder");
        await page.evaluate(() => {
            document
                .querySelectorAll<HTMLElement>("[data-teapot-timestamp]")
                .forEach((el) => (el.dataset.teapotTimestamp = "1"));
        });
        await expect(panel.locator("[data-teapot-timestamp]")).toHaveText("Full");
        expect(await panel.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
    });
}
