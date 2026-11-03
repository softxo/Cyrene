import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const python = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
const html = execFileSync(
    python,
    [
        "-X",
        "utf8",
        "-c",
        `
from starlette.requests import Request
from utils.web.app import templates
request=Request({'type':'http','method':'GET','path':'/settings','headers':[],'scheme':'http','server':('127.0.0.1',8000),'query_string':b''})
print(templates.env.get_template('settings.html').render(request=request))
`,
    ],
    { encoding: "utf8" },
);

for (const width of [390, 1440]) {
    test(`Discord access profiles appear beside account details at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 1000 });
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
            if (path === "/api/hoyolab/accounts")
                return route.fulfill({
                    json: {
                        accounts: [
                            {
                                uid: "777527709",
                                nickname: "Evernight",
                                level: 60,
                                discord_access: [
                                    {
                                        display_name: "Everly",
                                        username: "notinlonesplendor",
                                        avatar_url: "javascript:bad",
                                    },
                                    { display_name: "Alice", username: "narcisssorolegium" },
                                ],
                            },
                            {
                                uid: "774182513",
                                nickname: "Marionette",
                                level: 59,
                                discord_access: [{ display_name: "Discord account", username: "" }],
                            },
                        ],
                    },
                });
            if (path.startsWith("/api/")) return route.fulfill({ json: {} });
            return route.fulfill({ body: html, contentType: "text/html" });
        });
        await page.goto("http://127.0.0.1:8000/settings");
        const row = page.locator(".linked-account-row").first();
        await expect(row).toContainText("Evernight");
        await expect(row.locator(".linked-discord-profile")).toHaveCount(2);
        await expect(row).toContainText("Everly");
        await expect(row).toContainText("(@notinlonesplendor)");
        await expect(row).toContainText("Alice");
        await expect(row.locator(".linked-discord-username").first()).toHaveCSS("opacity", "0.55");
        await expect(row.locator("img").first()).toHaveAttribute(
            "src",
            "/static/images/ui/ui_icons/Discord.png",
        );
        expect(await row.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page
            .locator("#linked-account-list")
            .screenshot({ path: `test-results/settings-discord-access-${width}.png` });
        await row.getByRole("button", { name: "Manage", exact: true }).click();
        await expect(page.locator("#account-manage-modal")).toBeVisible();
    });
}
