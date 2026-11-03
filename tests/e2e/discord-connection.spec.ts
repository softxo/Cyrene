import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const python = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
const fixtures: Record<string, string> = JSON.parse(
    execFileSync(
        python,
        [
            "-X",
            "utf8",
            "-c",
            `
import json
from starlette.requests import Request
from utils.web.app import templates
request=Request({'type':'http','method':'GET','path':'/verify','headers':[],'scheme':'http','server':('127.0.0.1',8000),'query_string':b''})
pages={}
for key,name in [('old','Example'),('new','Another account'),('signed-out',None)]:
 profile={'id':'1557792995179495497','username':'example' if key=='old' else 'another','display_name':name,'avatar_url':'/static/images/ui/ui_icons/Discord.png','account_type':'special' if key=='old' else 'premium'} if name else None
 pages[key]=templates.env.get_template('verification.html').render(request=request,next=None,discord_profile=profile)
print(json.dumps(pages))
`,
        ],
        { encoding: "utf8" },
    ),
);

for (const width of [390, 1280]) {
    test(`Connected Discord account and safe account switching at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.clock.install();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let identity = "old";
        let creates = 0;
        let polls = 0;
        let verified = false;
        let expired = false;
        let logoutFails = true;
        let logoutCalls = 0;
        await page.route("http://127.0.0.1:8000/**", async (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.startsWith("/static/"))
                return route.fulfill({
                    body: readFileSync(`website${path}`),
                    contentType: path.endsWith(".css")
                        ? "text/css"
                        : path.endsWith(".js")
                          ? "text/javascript"
                          : "image/png",
                });
            if (path === "/api/auth/logout") {
                logoutCalls++;
                if (logoutFails)
                    return route.fulfill({ status: 500, json: { detail: "Unavailable" } });
                identity = "signed-out";
                verified = false;
                return route.fulfill({ json: { success: true } });
            }
            if (path === "/api/verify/create") {
                creates++;
                return route.fulfill({ json: { token: `token-${creates}`, code: "ABC123" } });
            }
            if (path === "/api/verify/status") {
                polls++;
                if (expired) return route.fulfill({ status: 404, json: { detail: "Expired" } });
                if (verified) identity = "new";
                return route.fulfill({ json: { verified } });
            }
            if (path.startsWith("/api/")) return route.fulfill({ json: {} });
            return route.fulfill({ body: fixtures[identity], contentType: "text/html" });
        });
        await page.goto("http://127.0.0.1:8000/verify");
        await expect(page.getByRole("heading", { name: "Your Discord account" })).toBeVisible();
        await expect(page.locator(".discord-profile-name-row .discord-account-type")).toHaveText(
            "Special",
        );
        await expect(page.locator(".discord-account-special")).toHaveCSS(
            "color",
            "rgb(65, 2, 112)",
        );
        await expect(page.locator(".discord-account-special")).toHaveCSS(
            "animation-name",
            "discord-special-glimmer",
        );
        await page.screenshot({ path: `test-results/discord-special-${width}.png` });
        const authorise = page.locator("[data-discord-connected-panel] [data-discord-oauth]");
        await expect(authorise).toBeVisible();
        await expect(authorise).toContainText("Authorise a different account with Discord");
        await expect(authorise.locator(".discord-oauth-pill")).toHaveText("OAuth2");
        await expect(authorise.locator(".discord-oauth-pill")).toHaveCSS(
            "background-color",
            "rgb(32, 0, 0)",
        );
        await expect(authorise).toHaveAttribute("href", "/auth/discord?next=%2Fverify");
        expect(
            await authorise.evaluate((element) => {
                const bounds = element.getBoundingClientRect();
                const panel = element.closest(".verification-panel")!.getBoundingClientRect();
                return bounds.left >= panel.left && bounds.right <= panel.right;
            }),
        ).toBe(true);
        await expect(page.locator(".discord-profile-copy")).toContainText("Example");
        await expect(page.locator(".discord-profile-copy")).toContainText("1557792995179495497");
        await expect(page.locator("[data-verification-flow]")).toBeHidden();
        expect(creates).toBe(0);
        for (const name of [
            "Connect to a different Discord account",
            "Disconnect Discord account",
        ]) {
            const button = page.getByRole("button", { name, exact: true });
            const background = await button.evaluate(
                (el) => getComputedStyle(el, "::before").backgroundColor,
            );
            await button.hover();
            await expect
                .poll(() =>
                    button.evaluate((el) => getComputedStyle(el, "::before").backgroundColor),
                )
                .not.toBe(background);
            await expect
                .poll(() =>
                    button.evaluate((el) => {
                        const matrix = new DOMMatrixReadOnly(
                            getComputedStyle(el, "::before").transform,
                        );
                        return (
                            Math.round(
                                ((1 - matrix.a) * el.getBoundingClientRect().width) / 2 - 1,
                            ) + "px"
                        );
                    }),
                )
                .toBe("0px");
            await expect(button).toHaveCSS("transform", "none");
            await page.mouse.down();
            await expect
                .poll(() =>
                    button.evaluate((el) => {
                        const matrix = new DOMMatrixReadOnly(
                            getComputedStyle(el, "::before").transform,
                        );
                        return (
                            Math.round(
                                ((1 - matrix.a) * el.getBoundingClientRect().width) / 2 - 1,
                            ) + "px"
                        );
                    }),
                )
                .toBe("1px");
            await page.mouse.move(0, 0);
            await page.mouse.up();
            await expect
                .poll(() =>
                    button.evaluate((el) => {
                        const matrix = new DOMMatrixReadOnly(
                            getComputedStyle(el, "::before").transform,
                        );
                        return (
                            Math.round(
                                ((1 - matrix.a) * el.getBoundingClientRect().width) / 2 - 1,
                            ) + "px"
                        );
                    }),
                )
                .toBe("-1px");
            await page.mouse.move(0, 0);
        }

        await page
            .locator(".verification-panel:visible")
            .screenshot({ path: `test-results/discord-connected-${width}.png` });
        await page.getByRole("button", { name: "Connect to a different Discord account" }).click();
        await expect(page.locator("#verification-code")).toHaveText("ABC123");
        await expect(
            page.getByText("Your current account stays connected", { exact: false }),
        ).toBeVisible();
        const back = page.getByRole("button", { name: "Back", exact: true });
        await expect(back).toHaveClass(/cyrene-button/);
        await expect(back).toHaveCSS("border-radius", "14px");
        await back.hover();
        await expect
            .poll(() =>
                back.evaluate((el) => {
                    const matrix = new DOMMatrixReadOnly(
                        getComputedStyle(el, "::before").transform,
                    );
                    return (
                        Math.round(((1 - matrix.a) * el.getBoundingClientRect().width) / 2 - 1) +
                        "px"
                    );
                }),
            )
            .toBe("0px");
        await page.mouse.down();
        await expect
            .poll(() =>
                back.evaluate((el) => {
                    const matrix = new DOMMatrixReadOnly(
                        getComputedStyle(el, "::before").transform,
                    );
                    return (
                        Math.round(((1 - matrix.a) * el.getBoundingClientRect().width) / 2 - 1) +
                        "px"
                    );
                }),
            )
            .toBe("1px");
        await page.mouse.move(0, 0);
        await page.mouse.up();
        await expect
            .poll(() =>
                back.evaluate((el) => {
                    const matrix = new DOMMatrixReadOnly(
                        getComputedStyle(el, "::before").transform,
                    );
                    return (
                        Math.round(((1 - matrix.a) * el.getBoundingClientRect().width) / 2 - 1) +
                        "px"
                    );
                }),
            )
            .toBe("-1px");
        await page.getByRole("button", { name: "Back", exact: true }).click();
        await expect(page.locator(".discord-profile-copy")).toContainText("Example");
        const stopped = polls;
        await page.clock.fastForward(5000);
        expect(polls).toBe(stopped);
        await page.getByRole("button", { name: "Connect to a different Discord account" }).click();
        await expect.poll(() => creates).toBe(2);
        await expect(page.locator("#verification-code")).toHaveText("ABC123");
        verified = true;
        await page.clock.fastForward(2100);
        await expect(page.locator("#verification-success")).toBeVisible();
        await page.clock.fastForward(2300);
        await expect(page.locator(".discord-profile-copy")).toContainText("Another account");
        await expect(page.locator(".discord-profile-name-row .discord-account-type")).toHaveText(
            "Premium",
        );
        await expect(page.locator(".discord-account-premium")).toHaveCSS(
            "color",
            "rgb(212, 175, 55)",
        );
        await expect(page.locator("[data-verification-flow]")).toBeHidden();
        await page.reload();
        await expect(page.locator(".discord-profile-copy")).toContainText("Another account");
        expect(creates).toBe(2);

        const disconnect = page.getByRole("button", {
            name: "Disconnect Discord account",
            exact: true,
        });
        await disconnect.click();
        await expect(page.getByRole("alert")).toContainText("Couldn't disconnect");
        await expect(page.locator(".discord-profile-copy")).toContainText("Another account");
        logoutFails = false;
        await disconnect.click();
        await expect.poll(() => logoutCalls).toBe(2);
        await expect(page.getByRole("heading", { name: "Verify your account" })).toBeVisible();
        const oauthAlternative = page.locator("[data-verification-flow] [data-discord-oauth]");
        await expect(oauthAlternative).toBeVisible();
        expect(
            await oauthAlternative.evaluate((element) => {
                const status = document
                    .querySelector("#verification-status")!
                    .getBoundingClientRect();
                return element.getBoundingClientRect().top > status.bottom;
            }),
        ).toBe(true);
        await page.screenshot({ path: `test-results/discord-verification-${width}.png` });
        await expect(page.locator("#verification-code")).toHaveText("ABC123");
        await expect.poll(() => creates).toBe(3);
        await page.reload();
        await expect(page.locator("#verification-code")).toHaveText("ABC123");
        expect(creates).toBe(3);
        expired = true;
        await page.clock.fastForward(2100);
        await expect(page.getByRole("button", { name: "Generate a new code" })).toBeVisible();
        expired = false;
        await page.getByRole("button", { name: "Generate a new code" }).click();
        await expect.poll(() => creates).toBe(4);
        await expect(page.locator("#verification-code")).toHaveText("ABC123");
        await page
            .locator('a[href="/settings"]')
            .first()
            .evaluate((link: HTMLAnchorElement) => link.click());
        await expect(page).toHaveURL(/settings$/);
        const afterNavigation = polls;
        await page.clock.fastForward(6000);
        expect(polls).toBe(afterNavigation);
        expect(errors).toEqual([]);
    });
}
