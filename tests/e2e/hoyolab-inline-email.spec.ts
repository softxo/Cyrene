import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

for (const width of [390, 1440]) {
    test(`only CAPTCHA opens a tab and email verification stays in Accounts at ${width}px`, async ({
        page,
        context,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.clock.install({ time: new Date("2026-11-06T12:00:00Z") });
        await page.clock.pauseAt(new Date("2026-11-06T12:00:01Z"));
        const template = readFileSync("website/templates/settings.html", "utf8");
        const content = template.split("{% block content %}")[1].split("{% endblock %}")[0];
        await context.route("http://inline.test/static/**", (route) => {
            const path = new URL(route.request().url()).pathname;
            return route.fulfill({
                body: readFileSync(`website${path}`),
                contentType: path.endsWith(".css") ? "text/css" : "image/svg+xml",
            });
        });
        await page.route("http://inline.test/settings", (route) =>
            route.fulfill({
                contentType: "text/html; charset=utf-8",
                body: `<html data-theme="blue"><head><link rel="stylesheet" href="/static/build/css/global.css"><link rel="stylesheet" href="/static/build/css/settings.css"></head><body><main class="main-content">${content}</main></body></html>`,
            }),
        );
        let phase = "captcha";
        await page.route("http://inline.test/api/hoyolab/link/start", (route) =>
            route.fulfill({ json: { success: true, token: "attempt" } }),
        );
        await page.route("http://inline.test/api/hoyolab/link/status?token=attempt", (route) =>
            route.fulfill({
                json:
                    phase === "captcha"
                        ? {
                              status: "captcha",
                              challenge_url: "http://inline.test/challenge/captcha",
                          }
                        : phase === "email"
                          ? { status: "email", submission_url: "/challenge/email/send-data" }
                          : {
                                status: "select",
                                accounts: [{ game_uid: "785050004", nickname: "Mellow" }],
                            },
            }),
        );
        await context.route("http://inline.test/challenge/captcha", (route) =>
            route.fulfill({
                contentType: "text/html",
                body: '<button onclick="window.close()">CAPTCHA accepted</button>',
            }),
        );
        let submissions = 0;
        await page.route("http://inline.test/challenge/email/send-data", (route) => {
            submissions++;
            if (route.request().postDataJSON().code !== "654321")
                return route.fulfill({
                    status: 400,
                    json: { detail: "That email code is incorrect. Check it and try again." },
                });
            phase = "select";
            return route.fulfill({ json: { success: true } });
        });
        let saved = false;
        await page.route("http://inline.test/api/hoyolab/link/complete", (route) => {
            saved = true;
            return route.fulfill({ json: { success: true, reconnected: true } });
        });
        await page.goto("http://inline.test/settings");
        await page.addScriptTag({
            content:
                readFileSync("website/static/build/browser/pages/settings.js", "utf8") +
                "\ninitialiseAccountLinking();",
        });
        await page.getByRole("button", { name: "Add HoYoLAB account" }).click();
        await page.getByLabel("Email or username").fill("test@example.com");
        await page.getByLabel("Password", { exact: true }).fill("test-password");
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        const popupPromise = page.waitForEvent("popup");
        await page.getByRole("link", { name: "Complete verification" }).click();
        const popup = await popupPromise;
        await popup.getByRole("button", { name: "CAPTCHA accepted" }).click();
        await expect.poll(() => context.pages().length).toBe(1);
        phase = "email";
        await page.clock.runFor(1100);
        const input = page.getByLabel("Verification code");
        await expect(input).toBeVisible();
        await expect(page.locator("#account-link-form")).toBeHidden();
        await input.fill("123456");
        await expect(page.locator("#account-link-code-status")).toContainText("incorrect");
        await expect(input).toBeEditable();
        await page.screenshot({ path: `test-results/inline-email-${width}.png` });
        await input.fill("654321");
        await expect(page.locator(".account-link-success h4")).toHaveText("Account reconnected");
        expect(saved).toBe(true);
        expect(submissions).toBe(2);
        expect(context.pages()).toHaveLength(1);
        await expect(page).toHaveURL("http://inline.test/settings");
    });
}
