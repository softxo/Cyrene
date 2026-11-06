import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const markup = execFileSync(
    ".venv/Scripts/python.exe",
    ["-X", "utf8", "tests/fixtures/render_event_cards.py"],
    { encoding: "utf8" },
);
const script = (name: string) =>
    readFileSync(`website/static/build/browser/pages/events/${name}.js`, "utf8");
const styles = () =>
    ["global", "events"]
        .map((name) => readFileSync(`website/static/build/css/${name}.css`, "utf8"))
        .join("\n");

async function setup(page) {
    await page.clock.install({ time: 1800000000 * 1000 });
    await page.route("http://events.test/static/**", async (route) => {
        try {
            const path = new URL(route.request().url()).pathname;
            const contentType = path.endsWith(".webp")
                ? "image/webp"
                : path.endsWith(".png")
                  ? "image/png"
                  : "application/octet-stream";
            await route.fulfill({ contentType, body: readFileSync(`website${path}`) });
        } catch {
            await route.abort();
        }
    });
    await page.setContent(
        `<base href="http://events.test"><style>${styles()}</style><main class="events-page">${markup}</main>`,
    );
    await page.addScriptTag({ content: script("events-timers") });
    await page.addScriptTag({ content: script("events-rewards") });
    await page.addScriptTag({ content: script("events-activity") });
    await page.evaluate(() => {
        window.updateEventTimeLeft();
        window.initialiseActivityCheckmarks();
    });
}

test("unknown daily opening dates stay muted and cannot be checked", async ({ page }) => {
    await setup(page);
    const daily = page.locator('[data-limited-event-id="daily"]');
    await expect(daily).toHaveClass(/upcoming/);
    await expect(daily.locator("[data-daily-event-reset]")).toHaveCount(0);
    await expect(daily.locator("[data-timer-value]")).toHaveText("Soon");
    await expect(daily.locator(".event-checkmark")).toBeDisabled();
    await daily.getByRole("button", { name: "Event opening information" }).hover();
    await expect(daily.getByRole("dialog", { name: "Event opening information" })).toBeVisible();
    await expect(daily.locator("[data-opening-explanation]")).toContainText(
        "has not been published",
    );
});

test("image-only schedules show approximate days and retain the upcoming state", async ({
    page,
}) => {
    await setup(page);
    const card = page.locator('[data-limited-event-id="approximate"]');
    await expect(card.locator("[data-timer-value]")).toHaveText("~2d");
    await card.getByRole("button", { name: "Event opening information" }).hover();
    await expect(card.locator("[data-opening-explanation]")).toContainText("approximate");
    await page.clock.fastForward(3 * 86400 * 1000);
    await page.evaluate(() => window.updateEventTimeLeft());
    await expect(card).toHaveClass(/upcoming/);
    await expect(card.locator(".event-checkmark")).toBeDisabled();
});

test("opening countdown preserves help and enables tracking only after opening", async ({
    page,
}) => {
    await setup(page);
    const scheduled = page.locator('[data-limited-event-id="scheduled"]');
    await expect(scheduled.locator("[data-timer-value]")).toHaveText("1d 0h 0m");
    await expect(scheduled.locator(".event-checkmark")).toBeDisabled();
    await scheduled.getByRole("button", { name: "Event opening information" }).hover();
    await expect(
        scheduled.getByRole("dialog", { name: "Event opening information" }),
    ).toBeVisible();
    const help = scheduled.getByRole("dialog", { name: "Event opening information" });
    const bottomGap = await help.evaluate(
        (el) =>
            el.getBoundingClientRect().bottom -
            el.querySelector("p")!.getBoundingClientRect().bottom,
    );
    expect(bottomGap).toBeLessThanOrEqual(14);
    await page.screenshot({ path: "test-results/event-opening-help.png" });
    await page.clock.fastForward(86400 * 1000);
    await page.evaluate(() => window.updateEventTimeLeft());
    await expect(scheduled).not.toHaveClass(/upcoming/);
    await expect(scheduled.locator(".event-checkmark")).toBeEnabled();
    await expect(scheduled.getByRole("button", { name: "Event opening information" })).toBeHidden();
});

for (const width of [390, 1280, 1500]) {
    test(`compact rewards expose the full list in a click pop-up at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await setup(page);
        const card = page.locator('[data-limited-event-id="fixture"]');
        await expect(
            card.locator(".event-limited-rewards > .event-limited-reward:visible"),
        ).toHaveCount(width > 1200 ? 10 : 4);
        const box = await card.boundingBox();
        expect(box!.height).toBeLessThan(width > 1200 ? 110 : 240);
        const more = card.getByRole("button", { name: /Show all rewards/ });
        await expect(card.locator(".event-limited-reward-amount").first()).toHaveText("\u00d73");
        if (width > 1200) {
            const rewardBox = await card
                .locator(".event-limited-rewards > .event-limited-reward")
                .first()
                .boundingBox();
            const buttonBox = await more.boundingBox();
            const timerBox = await card.locator(".event-time-left").boundingBox();
            const nameBox = await card.locator(".event-list-name").boundingBox();
            const centre = (box) => box.y + box.height / 2;
            for (const aligned of [buttonBox, timerBox, nameBox])
                expect(Math.abs(centre(aligned) - centre(rewardBox))).toBeLessThan(1.5);
        }
        await more.click();
        const popup = card.getByRole("dialog", { name: /All rewards/ });
        await expect(popup).toBeVisible();
        await expect(popup.locator(".event-limited-reward")).toHaveCount(30);
        const popupBox = await popup.boundingBox();
        expect(popupBox!.x).toBeGreaterThanOrEqual(0);
        expect(popupBox!.x + popupBox!.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `test-results/event-rewards-${width}.png` });
        await page.keyboard.press("Escape");
        await expect(popup).toBeHidden();
        await page.screenshot({ path: `test-results/event-rows-${width}.png` });
    });
}

test("upcoming timers share a width and hidden help cannot open a popup", async ({ page }) => {
    await setup(page);
    const widths = await page
        .locator(".event-time-left.upcoming")
        .evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().width));
    expect(new Set(widths).size).toBe(1);
    await page.locator('[data-limited-event-id="scheduled"] .event-upcoming-help').hover();
    await expect(page.locator(".event-opening-popover:popover-open")).toHaveCount(1);
    await page.locator('[data-limited-event-id="fixture"] .event-time-left').hover();
    await page.waitForTimeout(250);
    await expect(page.locator(".event-opening-popover:popover-open")).toHaveCount(0);
});

test("reward popup closes on page scroll", async ({ page }) => {
    await setup(page);
    await page.evaluate(() => (document.body.style.minHeight = "2000px"));
    await page.getByRole("button", { name: /Show all rewards/ }).click();
    await expect(page.locator(".event-all-rewards .event-insight-popover")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 150));
    await expect(page.locator(".event-all-rewards .event-insight-popover")).toBeHidden();
});

test("Ley Line rewards always display the double reward badge", async ({ page }) => {
    await setup(page);
    const amounts = page.locator('[data-limited-event-id="daily"] .event-limited-reward-amount');
    await expect(amounts).toHaveText(["\u00d72", "\u00d72"]);
});

for (const width of [390, 768, 1500]) {
    test(`daily overview pills remain separate at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await setup(page);
        await page.evaluate(() => {
            document.querySelector("main")!.innerHTML =
                `<div class="events-overview-panel active" data-overview-panel="daily"><div class="overview-account-row overview-daily-row"><div class="overview-account-name"><strong><span data-account-profile-name="123" data-account-profile-field="display">Fixture</span></strong><span>123456789</span></div><div class="overview-encounter-points">1234.5</div><div class="overview-account-status"><div class="overview-daily-progress"><span class="event-list-status event-list-status-with-claim">4 / 4 | Unclaimed</span><span class="event-time-left">12h 34m</span><button class="event-checkmark"></button></div></div></div></div>`;
        });
        const ep = await page.locator(".overview-encounter-points").boundingBox();
        const status = await page.locator(".event-list-status-with-claim").boundingBox();
        expect(ep!.x + ep!.width <= status!.x || ep!.y + ep!.height <= status!.y).toBeTruthy();
        if (width > 700) expect(status!.x - ep!.x - ep!.width).toBe(12);
        const name = page.locator(".overview-account-name strong");
        await expect(name).toHaveCSS("font-size", "16px");
        await expect(name).toHaveCSS("opacity", "1");
        await expect(name.locator("span")).toHaveCSS("font-size", "16px");
        await expect(name.locator("span")).toHaveCSS("opacity", "1");
        await page.screenshot({ path: `test-results/daily-overview-${width}.png` });
    });
}

test("Upcoming events are excluded from completion counts before and after refresh", async ({
    page,
}) => {
    await setup(page);
    await page.evaluate(() => {
        const main = document.querySelector("main")!;
        main.innerHTML = `<section data-limited-account-group><span data-limited-account-count>2/6 complete</span><div class="events-custom-list">${[0, 1, 2, 3, 4, 5].map((i) => `<article data-limited-category="Quest" class="event-list-item events-limited-overview-event ${i < 2 ? "completed" : ""} ${i >= 3 ? "upcoming" : ""}"></article>`).join("")}</div></section>`;
    });
    await page.addScriptTag({ content: script("events-filters") });
    await expect(page.locator("[data-limited-account-count]")).toHaveText("2/3 complete");
    await page.evaluate(() => {
        const replacement = document.querySelector("[data-limited-account-group]")!.cloneNode(true);
        document.querySelector("[data-limited-account-group]")!.replaceWith(replacement);
    });
    await expect(page.locator("[data-limited-account-count]")).toHaveText("2/3 complete");
});

test("Limited Overview cards match Normal height", async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await setup(page);
    await page.evaluate(() => {
        const original = document.querySelector('[data-limited-event-id="fixture"]')!;
        const wrapper = document.createElement("div");
        wrapper.className = "events-custom-overview";
        const copy = original.cloneNode(true) as HTMLElement;
        copy.classList.add("events-limited-overview-event");
        copy.dataset.limitedEventId = "overview-copy";
        wrapper.append(copy);
        document.querySelector("main")!.append(wrapper);
    });
    const normal = await page.locator('[data-limited-event-id="fixture"]').boundingBox();
    const overview = await page.locator('[data-limited-event-id="overview-copy"]').boundingBox();
    expect(overview!.height).toBe(normal!.height);
});
