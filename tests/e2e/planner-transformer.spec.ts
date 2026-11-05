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
    test(`Transformer states, reminder form and stable buttons at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 950 });
        const base = {
            level: 60,
            current_resin: 200,
            max_resin: 200,
            replenished_at: null,
            full_resin_at: null,
            expeditions: [],
        };
        const accounts = [
            {
                ...base,
                genshin_uid: "123",
                nickname: "Cooldown",
                transformer: { obtained: true, ready_at: Math.floor(Date.now() / 1000) + 172800 },
            },
            {
                ...base,
                genshin_uid: "124",
                nickname: "Ready account",
                transformer: { obtained: true, ready_at: 1 },
            },
            {
                ...base,
                genshin_uid: "125",
                nickname: "Locked",
                transformer: { obtained: false, ready_at: null },
            },
            { ...base, genshin_uid: "126", nickname: "Missing", transformer: null },
        ];
        await page.route("http://planner.test/api/reminders", (route) =>
            route.fulfill({
                json: {
                    accounts,
                    reminders: payload
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
        await page.route("http://planner.test/?tab=transformer", (route) =>
            route.fulfill({ contentType: "text/html", body: html }),
        );
        await page.goto("http://planner.test/?tab=transformer");
        const globalCss = readFileSync("website/static/build/css/global.css", "utf8");
        const plannerCss = readFileSync("website/static/build/css/planner.css", "utf8");
        await page.addStyleTag({ content: globalCss + plannerCss });
        await page.addScriptTag({
            content: readFileSync("website/static/build/browser/pages/planner.js", "utf8"),
        });
        await page.evaluate(() => (window as any).initPlanner());
        const panel = page.locator("#planner-panel-transformer");
        await expect(panel).toBeVisible();
        await expect(panel.locator(".planner-card")).toHaveCount(4);
        await expect(panel.locator("[data-transformer-timestamp]")).toContainText("in 47h");
        await expect(panel).toContainText("Ready");
        await expect(panel).toContainText("Not obtained");
        await expect(panel).toContainText("Unavailable");
        const button = page.locator("#planner-tab-transformer");
        const radius = await button.evaluate((el) => getComputedStyle(el).borderRadius);
        expect(radius).toBe("14px");
        const eventsStyle = await page.addStyleTag({
            content: readFileSync("website/static/build/css/events.css", "utf8"),
        });
        expect(await button.evaluate((el) => getComputedStyle(el).borderRadius)).toBe(radius);
        await eventsStyle.evaluate((el) => el.remove());
        expect(await button.evaluate((el) => getComputedStyle(el).borderRadius)).toBe(radius);
        await page.locator("#add-transformer-reminder-button").click();
        await expect(page.locator("#reminder-type")).toHaveValue("transformer");
        await expect(page.locator("#reminder-resin-configuration")).toBeHidden();
        await expect(page.locator("#reminder-expedition-note")).toContainText(
            "Parametric Transformer",
        );
        await page.locator("#reminder-account-button").click();
        await page.locator('#reminder-account-menu [data-value="123"]').click();
        await page.locator("#reminder-create-mode-select .custom-select-button").click();
        await page.locator('#reminder-create-mode-select [data-value="manual"]').click();
        await expect(page.locator("#reminder-mode-help")).toContainText("No fixed expiry");
        await expect(page.locator("#reminder-mode-help")).toContainText(
            "after successful delivery",
        );
        await page.locator("#reminder-save-button").click();
        await expect.poll(() => payload?.type).toBe("transformer");
        await expect(page.locator("#reminder-save-button")).toHaveText("Add Reminder");
        expect(payload.mode).toBe("manual");
        await expect(panel.locator(".reminder-lifetime")).toContainText("sends once");
        expect(payload.genshin_uid).toBe("123");
        expect(await panel.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false);
        const messages = await page.evaluate(async () => {
            const messages: string[] = [];
            (window as any).showCyreneToast = (text: string) => messages.push(text);
            for (const max of [200, 2000]) {
                const card = document.createElement("div");
                card.dataset.reminderId = "1";
                card.dataset.reminderAmount = "100";
                card.innerHTML = `<input data-reminder-amount min="1" max="${max}" value="${max + 1}">`;
                document.body.appendChild(card);
                await (window as any).updateReminderCard(card);
                card.remove();
            }
            return messages;
        });
        expect(messages).toEqual([
            "Enter a whole number between 1 and 200.",
            "Enter a whole number between 1 and 2000.",
        ]);
    });
}
