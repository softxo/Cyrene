import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

function emailPage() {
    const template = readFileSync("website/templates/hoyolab_email_challenge.html", "utf8");
    const content = template
        .split("{% block content %}")[1]
        .split("{% endblock %}")[0]
        .replace("{{ submission_url }}", "/challenge/test/send-data")
        .replace("{{ link_token }}", "attempt");
    return `<html data-theme="blue"><head><meta charset="UTF-8"><link rel="stylesheet" href="/static/build/css/global.css"></head><body><main class="main-content">${content}</main></body></html>`;
}

for (const width of [390, 1440]) {
    test(`email code corrects errors, saves account, animates and returns at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.clock.install({ time: new Date("2026-11-06T12:00:00Z") });
        await page.clock.pauseAt(new Date("2026-11-06T12:00:01Z"));
        await page.route("http://login.test/static/**", (route) => {
            const path = new URL(route.request().url()).pathname;
            return route.fulfill({
                body: readFileSync(`website${path}`),
                contentType: path.endsWith(".css") ? "text/css" : "image/svg+xml",
            });
        });
        await page.route("http://login.test/challenge/test", (route) =>
            route.fulfill({ contentType: "text/html", body: emailPage() }),
        );
        let submissions = 0;
        await page.route("http://login.test/challenge/test/send-data", (route) => {
            submissions++;
            return route.request().postDataJSON().code === "654321"
                ? route.fulfill({ json: { success: true } })
                : route.fulfill({
                      status: 400,
                      json: { detail: "That email code is incorrect. Check it and try again." },
                  });
        });
        await page.route("http://login.test/api/hoyolab/link/status?token=attempt", (route) =>
            route.fulfill({
                json: {
                    status: "select",
                    accounts: [{ game_uid: "785050004", nickname: "Mellow" }],
                },
            }),
        );
        let saveRoute;
        await page.route("http://login.test/api/hoyolab/link/complete", (route) => {
            saveRoute = route;
        });
        await page.route("http://login.test/settings", (route) =>
            route.fulfill({ contentType: "text/html", body: "<h1>Accounts</h1>" }),
        );
        await page.goto("http://login.test/challenge/test");
        const input = page.locator("#email-code");
        await input.fill("12345");
        expect(submissions).toBe(0);
        await input.press("6");
        await expect(page.getByRole("status")).toContainText("incorrect");
        await expect(input).toBeEditable();
        await expect(input).toHaveAttribute("aria-invalid", "true");
        await input.fill("654321");
        await expect.poll(() => !!saveRoute).toBe(true);
        await expect(page.locator(".verification-success")).toBeHidden();
        expect(submissions).toBe(2);
        await saveRoute.fulfill({ json: { success: true, reconnected: true } });
        await expect(page.getByRole("heading", { name: "Account reconnected" })).toBeVisible();
        await expect(page.locator(".verified-check use")).toHaveAttribute(
            "href",
            "/static/images/ui/check.svg#check",
        );
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
            true,
        );
        await page.clock.runFor(1400);
        await page.evaluate(() =>
            Promise.all(
                document.getAnimations().map((animation) => {
                    animation.finish();
                    return animation.finished;
                }),
            ),
        );
        await page.screenshot({ path: `test-results/email-success-${width}.png` });
        await page.clock.runFor(1000);
        await expect(page).toHaveURL("http://login.test/settings");
    });
}

test("returning to Accounts resumes role selection and persists the selected account", async ({
    page,
}) => {
    const template = readFileSync("website/templates/settings.html", "utf8");
    const content = template.split("{% block content %}")[1].split("{% endblock %}")[0];
    await page.route("http://accounts.test/settings?link_attempt=attempt", (route) =>
        route.fulfill({
            contentType: "text/html",
            body: `<html><head><meta charset="UTF-8"></head><body>${content}</body></html>`,
        }),
    );
    await page.route("http://accounts.test/api/hoyolab/link/status?token=attempt", (route) =>
        route.fulfill({
            json: {
                status: "select",
                accounts: [
                    { game_uid: "785050004", nickname: "Mellow", level: 60 },
                    { game_uid: "600000001", nickname: "Other", level: 55 },
                ],
            },
        }),
    );
    let savedUid = "";
    await page.route("http://accounts.test/api/hoyolab/link/complete", (route) => {
        savedUid = route.request().postDataJSON().uid;
        return route.fulfill({ json: { success: true, reconnected: false } });
    });
    await page.goto("http://accounts.test/settings?link_attempt=attempt");
    await page.addScriptTag({
        content:
            readFileSync("website/static/build/browser/pages/settings.js", "utf8") +
            "\ninitialiseAccountLinking();",
    });
    await expect(page.locator(".account-choice")).toHaveCount(2);
    await expect(page).toHaveURL("http://accounts.test/settings");
    await page.getByRole("button", { name: /Mellow/ }).click();
    await expect(page.locator(".account-link-success h4")).toHaveText("Account linked");
    expect(savedUid).toBe("785050004");
});
