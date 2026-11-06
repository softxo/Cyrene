import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const markup = execFileSync(
    ".venv/Scripts/python.exe",
    ["-X", "utf8", "tests/fixtures/render_wish_banners.py"],
    { encoding: "utf8" },
);
const css = ["global", "events"]
    .map((name) => readFileSync(`website/static/build/css/${name}.css`, "utf8"))
    .join("\n");

for (const width of [390, 1500]) {
    test(`upcoming Wish artwork and start timers at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.clock.install({ time: 1800000000 * 1000 });
        await page.clock.pauseAt(1800000000 * 1000);
        await page.route("http://wishes.test/static/**", (route) =>
            route.fulfill({
                body: readFileSync("website" + new URL(route.request().url()).pathname),
                contentType: "image/webp",
            }),
        );
        await page.route("http://wishes.test/preview/**", (route) =>
            route.fulfill({
                contentType: "image/svg+xml",
                body: route
                    .request()
                    .url()
                    .match(/(?:current|full)\.svg$/)
                    ? '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640"><rect width="1280" height="640" fill="#536a83"/></svg>'
                    : '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="800"><rect width="500" height="800" fill="#536a83"/><circle cx="250" cy="200" r="100" fill="#b8c5d4"/></svg>',
            }),
        );
        await page.setContent(
            `<base href="http://wishes.test"><style>${css}</style><main class="events-page">${markup}</main>`,
        );
        await page.addScriptTag({
            content: readFileSync(
                "website/static/build/browser/pages/events/events-timers.js",
                "utf8",
            ),
        });
        await page.evaluate(() => window.updateEventTimeLeft());
        await expect(page.locator(".wish-banner-time.upcoming")).toHaveCount(4);
        await expect(page.locator('[data-wish-banner="301"] .wish-banner-time')).toHaveText(
            "1h 0m",
        );
        await expect(page.getByRole("heading", { name: "Upcoming Event Wishes" })).toBeVisible();
        const currentBox = await page.locator('[data-wish-section="current"]').boundingBox();
        const upcomingBox = await page.locator('[data-wish-section="upcoming"]').boundingBox();
        expect(upcomingBox!.y).toBeGreaterThan(currentBox!.y + currentBox!.height);
        await expect(page.locator('[data-wish-section="current"] .wish-banner-card')).toHaveCount(
            1,
        );
        await expect(page.locator('[data-wish-section="upcoming"] .wish-banner-card')).toHaveCount(
            4,
        );
        await expect(page.locator('[data-wish-banner="current"] .wish-banner-title')).toHaveText(
            '"Chanson of Many Waters"',
        );
        await expect(page.locator('[data-wish-banner="301"] .wish-banner-title')).toHaveText(
            '"Upcoming character"',
        );
        const currentArt = page.locator('[data-wish-banner="current"] .wish-banner-image');
        await page.locator('[data-wish-banner="current"]').hover();
        await expect(currentArt).toHaveCSS("transform", "none");
        const imageBox = await currentArt.boundingBox();
        const mediaBox = await page
            .locator('[data-wish-banner="current"] .wish-banner-media')
            .boundingBox();
        expect(Math.abs(mediaBox!.height - imageBox!.height)).toBeLessThan(1);
        if (width > 1100) {
            const cardBox = await page.locator('[data-wish-banner="current"]').boundingBox();
            expect(Math.abs(cardBox!.height - imageBox!.height - 2)).toBeLessThan(1);
        }
        await expect(page.locator('[data-wish-banner="current"] .cyrene-rarity-star')).toHaveCount(
            2,
        );
        const panel = page.locator('[data-wish-banner="current"] .wish-banner-featured').first();
        const label = panel.locator(".wish-banner-label");
        const panelBox = await panel.boundingBox();
        const labelBox = await label.boundingBox();
        expect(
            Math.abs(labelBox!.y + labelBox!.height / 2 - panelBox!.y - panelBox!.height / 2),
        ).toBeLessThan(1);

        await expect(
            page.locator('[data-wish-banner="301"] .wish-preview-character img'),
        ).toHaveCount(1);
        await expect(
            page.locator('[data-wish-banner="302"] .wish-preview-weapons img'),
        ).toHaveCount(2);
        await expect(
            page.locator('[data-wish-banner="500"] .wish-preview-chronicled img'),
        ).toHaveCount(5);
        await expect(page.locator('[data-wish-banner="announced"] .wish-banner-image')).toHaveCount(
            1,
        );
        await expect(
            page.locator('[data-wish-banner="announced"] .wish-banner-four-star'),
        ).toBeVisible();
        await expect(
            page.locator('[data-wish-banner="announced"] .wish-banner-label').first(),
        ).toHaveText("5");
        await expect(
            page.locator('[data-wish-banner="announced"] .wish-banner-preview-art'),
        ).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
            width,
        );
        await page.screenshot({
            path: `test-results/upcoming-wishes-${width}.png`,
            fullPage: true,
        });
        await page.clock.fastForward(3600 * 1000);
        await page.evaluate(() => window.updateEventTimeLeft());
        await expect(page.locator('[data-wish-banner="301"] .wish-banner-time')).toHaveText(
            "Available",
        );
        await expect(page.locator(".wish-banner-time.upcoming")).toHaveCount(0);
    });
}
