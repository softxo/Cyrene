import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const shell = (path: "weapons" | "characters") => `<!doctype html><html><head>
<link rel="stylesheet" href="/static/build/css/global.css">
<link rel="stylesheet" data-page-style="/${path}" href="/static/build/css/${path}.css">
</head><body><nav><a href="/weapons">Weapons</a><a href="/characters">Characters</a></nav>
<main class="main-content"><div class="page characters-page ${path}-page">
<div class="characters-toolbar ${path}-toolbar">
<div class="characters-search"><label>Search</label><input type="search"></div>
<div class="characters-filter characters-icon-filter"><label>Type</label><div class="characters-icon-buttons"><button class="characters-icon-button">All</button></div></div>
<div class="characters-filter characters-icon-filter"><label>Rarity</label><div class="characters-icon-buttons"><button class="characters-icon-button">All</button></div></div>
<button class="characters-reset-filters">Refresh</button>
</div></div></main><script type="module" src="/static/build/js/app.js"></script></body></html>`;

for (const width of [390, 900, 1440]) {
    test(`Weapons toolbar keeps its layout after visiting Characters at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.route("**/static/build/**", (route) => {
            const path = new URL(route.request().url()).pathname;
            return route.fulfill({
                contentType: path.endsWith(".css") ? "text/css" : "text/javascript",
                body:
                    path.endsWith(".css") || path.endsWith("/app.js")
                        ? readFileSync(`website${path}`)
                        : "",
            });
        });
        for (const path of ["weapons", "characters"] as const) {
            await page.route(`**/${path}`, (route) =>
                route.fulfill({ contentType: "text/html", body: shell(path) }),
            );
        }
        await page.goto("/weapons");
        const layout = () =>
            page.locator(".weapons-toolbar").evaluate((element) => {
                const style = getComputedStyle(element);
                const search = element.querySelector(".characters-search")!;
                return {
                    columns: style.gridTemplateColumns,
                    height: element.getBoundingClientRect().height,
                    searchColumn: getComputedStyle(search).gridColumn,
                };
            });
        const initial = await layout();
        for (let i = 0; i < 2; i++) {
            await page.getByRole("link", { name: "Characters", exact: true }).click();
            await expect(page.locator(".characters-toolbar")).not.toHaveClass(/weapons-toolbar/);
            await page.getByRole("link", { name: "Weapons", exact: true }).click();
            await expect(page.locator(".weapons-toolbar")).toBeVisible();
            expect(await layout()).toEqual(initial);
        }
    });
}
