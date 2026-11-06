import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const html = execFileSync("python", ["tests/fixtures/render_hoyolab_captcha.py"], {
    encoding: "utf8",
});

for (const next of ["accepted", "rejected"]) {
    test(`CAPTCHA waits for ${next} and closes only after acceptance`, async ({ page }) => {
        await page.clock.install({ time: new Date("2026-11-06T12:00:00Z") });
        await page.clock.pauseAt(new Date("2026-11-06T12:00:01Z"));
        await page.addInitScript(() => {
            window.close = () => {
                (window as any).captchaClosed = true;
            };
        });
        await page.addInitScript(
            (theme) => localStorage.setItem("theme", theme),
            next === "accepted" ? "pink" : "light-pink",
        );
        await page.setViewportSize({ width: next === "accepted" ? 390 : 1440, height: 900 });
        await page.route("http://captcha.test/static/**", (route) => {
            const path = new URL(route.request().url()).pathname;
            return route.fulfill({ contentType: "text/css", body: readFileSync(`website${path}`) });
        });
        await page.route("https://static.geetest.com/**", (route) =>
            route.fulfill({
                contentType: "text/javascript",
                body: `window.initGeetest = (options, ready) => {
                const button = document.createElement('button');
                button.textContent = 'Complete test CAPTCHA';
                document.getElementById('captcha').append(button);
                ready({ onReady(callback) { callback(); }, verify() {}, onError() {},
                    onSuccess(callback) { button.onclick = callback; },
                    getValidate() { return { geetest_challenge: 'test', geetest_validate: 'test', geetest_seccode: 'test' }; }
                });
            };`,
            }),
        );
        await page.route("http://captcha.test/challenge/test", (route) =>
            route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
        );
        let pending;
        let submissions = 0;
        await page.route("**/send-data", (route) => {
            submissions++;
            pending = route;
        });
        let statusChecks = 0;
        await page.route("http://captcha.test/api/hoyolab/link/status?token=attempt", (route) => {
            statusChecks++;
            return route.fulfill({
                json:
                    next === "email"
                        ? {
                              status: "captcha",
                              challenge_url: "http://captcha.test/challenge/email",
                          }
                        : { status: "select", accounts: [{ game_uid: "785050004" }] },
            });
        });
        await page.route("http://captcha.test/settings?link_attempt=attempt", (route) =>
            route.fulfill({ contentType: "text/html", body: "<h1>Choose account</h1>" }),
        );
        await page.route("http://captcha.test/challenge/email", (route) =>
            route.fulfill({ contentType: "text/html", body: "<h1>Check your HoYoLAB email</h1>" }),
        );
        await page.goto("http://captcha.test/challenge/test");
        await page.screenshot({ path: `test-results/captcha-theme-${next}.png` });
        await page.getByRole("button", { name: "Complete test CAPTCHA" }).click();
        await expect.poll(() => !!pending).toBe(true);
        expect(statusChecks).toBe(0);
        await expect(page.getByRole("heading", { name: "CAPTCHA verified" })).toHaveCount(0);
        if (next === "rejected") {
            await pending.fulfill({
                status: 400,
                json: { detail: "HoYoLAB rejected the completed login CAPTCHA." },
            });
            await expect(page.getByRole("alert")).toContainText("rejected");
            await expect(page).toHaveURL("http://captcha.test/challenge/test");
            expect(statusChecks).toBe(0);
        } else {
            await pending.fulfill({ json: { success: true } });
            await expect(page.getByRole("heading", { name: "CAPTCHA verified" })).toBeVisible();
            await page.evaluate(() =>
                Promise.all(
                    document.getAnimations().map((animation) => {
                        animation.finish();
                        return animation.finished;
                    }),
                ),
            );
            await page.screenshot({ path: "test-results/captcha-success-theme.png" });
            await page.clock.runFor(3100);
            expect(await page.evaluate(() => (window as any).captchaClosed)).toBe(true);
        }
        expect(statusChecks).toBe(0);
        expect(submissions).toBe(1);
    });
}
