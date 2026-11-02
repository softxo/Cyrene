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
import json,re
from utils.web.app import templates
from starlette.requests import Request
account={'id':1,'nickname':'Evernight','genshin_uid':777527709}
accounts=[account,{'id':2,'nickname':'Moon','genshin_uid':777527710}]
r=Request({'type':'http','path':'/events','headers':[],'query_string':b''})
source=templates.env.loader.get_source(templates.env,'events.html')[0]
cut=source.rfind('{% if not overview %}',0,source.index('class="events-featured"'))
source=source[:cut]+'''<section class="events-limited-filter-header"><h2>Limited-Time Events</h2>{{ limited_event_filters() }}</section></div>{% endblock %}'''
events=templates.env.from_string(source).render(request=r,accounts=accounts,selected_account=account,tab='all')
home=templates.env.get_template('home.html').render(request=r,accounts=accounts)
print(json.dumps({'events':re.sub(r'<script\\b[\\s\\S]*?</script>','',events,flags=re.I),'home':re.sub(r'<script\\b[\\s\\S]*?</script>','',home,flags=re.I)}))
`,
        ],
        { encoding: "utf8" },
    ),
);
const extra = `<section style="margin:24px"><div class="planner-grid" data-polish-grid><article class="planner-card"><h2>Evernight</h2><p>UID: 777527709</p></article></div><div class="achievement-search-wrapper"><span class="achievement-search-icon"></span><input type="search" id="achievement-polish" class="cyrene-input achievement-search" placeholder="Search achievements..."></div><div class="characters-search"><label for="character-polish">Characters</label><input type="search" id="character-polish"></div><div class="inventory-search"><label for="inventory-polish">Inventory</label><input type="search" id="inventory-polish"></div><form data-polish-form><input type="search" id="plain-polish" aria-label="Search" placeholder="Search..."></form><div class="event-insight weapons-help" data-popover-placement="top" style="margin:150px 20px 20px"><button class="weapons-help-trigger" aria-label="Weapon information">?</button><div class="event-insight-popover" popover="manual" role="dialog"><div class="event-insight-content"><strong>Equipped Weapons Only</strong><p>Only equipped weapons sync from HoYoLAB.</p></div></div></div></section>`;
const scripts = `<script src="/static/build/browser/pages/events/events-dropdown.js"></script><script src="/static/build/browser/pages/events/events-rewards.js"></script><script type="module">import {initialiseButtonMotion} from '/static/build/browser/core/button-motion.js';import {initialiseSearchControls} from '/static/build/browser/core/search-controls.js';import {initialiseSelectControls} from '/static/build/browser/core/select-controls.js';initialiseButtonMotion();initialiseSearchControls();initialiseSelectControls();window.initialiseEventsDropdown();window.initialiseDropdownClose();</script>`;
for (const width of [390, 1280]) {
    test(`Control polish, account first click, search clearing and stable tooltip at ${width}px`, async ({
        page,
        browserName,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("http://127.0.0.1:8000/**", (route) => {
            const path = new URL(route.request().url()).pathname;
            if (path.startsWith("/static/"))
                return route.fulfill({
                    body: readFileSync(`website${path}`),
                    contentType: path.endsWith(".css")
                        ? "text/css"
                        : path.endsWith(".js")
                          ? "text/javascript"
                          : path.endsWith(".woff2")
                            ? "font/woff2"
                            : "image/png",
                });
            let html = path === "/" ? fixtures.home : fixtures.events;
            html = html
                .replace(
                    "</head>",
                    `<link rel="stylesheet" href="/static/build/css/characters.css"><link rel="stylesheet" href="/static/build/css/achievements.css"><link rel="stylesheet" href="/static/build/css/inventory.css"><link rel="stylesheet" href="/static/build/css/weapons.css"><link rel="stylesheet" href="/static/build/css/planner.css"></head>`,
                )
                .replace("</main>", extra + "</main>")
                .replace("</body>", scripts + "</body>");
            return route.fulfill({ contentType: "text/html", body: html });
        });
        await page.goto("/events");
        await page.evaluate(() => {
            document.documentElement.dataset.theme = "pink";
        });
        const account = page.locator("#events-account");
        const trigger = account.locator(".custom-select-button");
        // A legacy listener must not undo the shared toggle on the first click.
        await trigger.evaluate((button) =>
            button.addEventListener("click", () =>
                button.closest(".custom-select")!.classList.toggle("open"),
            ),
        );
        await expect(trigger).toContainText(/Evernight\s*\u00b7\s*777527709/);
        await expect(trigger).not.toContainText("\u2014");
        for (let i = 0; i < 3; i++) {
            await trigger.click();
            await expect(account).toHaveClass(/open/);
            await expect(trigger).toHaveAttribute("aria-expanded", "true");
            await expect(account.locator(".custom-select-menu")).toBeVisible();
            await trigger.click();
            await expect(account).not.toHaveClass(/open/);
        }
        await trigger.focus();
        await page.keyboard.press("ArrowDown");
        await expect(account).toHaveClass(/open/);
        await page.keyboard.press("Escape");
        await expect(account).not.toHaveClass(/open/);
        await expect(trigger).toBeFocused();
        // Simulate the fresh markup supplied by SPA navigation or account refresh.
        await account.evaluate((el) => el.replaceWith(el.cloneNode(true)));
        await trigger.click();
        await expect(account).toHaveClass(/open/);
        await trigger.click();
        await expect(account).not.toHaveClass(/open/);
        const controlHeights = await page
            .locator(".events-controls-right")
            .evaluate((el) =>
                [
                    el.querySelector(".custom-select-button")!,
                    el.querySelector(".events-layout-switch")!,
                ].map((node) => node.getBoundingClientRect().height),
            );
        expect(controlHeights[0]).toBe(controlHeights[1]);
        const active = page.locator(".events-account-tab.active");
        await expect(active).toHaveCSS("font-weight", "700");
        expect(await active.evaluate((el) => getComputedStyle(el, "::after").height)).toBe("1px");
        const gear = page.getByRole("button", { name: "Choose Limited event categories" });
        const centre = await gear.evaluate((el) => {
            const r = el.getBoundingClientRect(),
                svg = el.querySelector("svg")!,
                s = svg.getBoundingClientRect(),
                art = svg.getBBox();
            return {
                x: r.x + r.width / 2 - s.x - s.width / 2,
                y: r.y + r.height / 2 - s.y - s.height / 2,
                artX: art.x + art.width / 2,
                artY: art.y + art.height / 2,
            };
        });
        expect(Math.abs(centre.x)).toBeLessThan(0.1);
        expect(Math.abs(centre.y)).toBeLessThan(0.1);
        expect(centre.artX).toBeCloseTo(12, 1);
        expect(centre.artY).toBeCloseTo(12, 1);
        const card = page.locator("[data-polish-grid] .planner-card");
        expect((await card.boundingBox())!.width).toBeLessThanOrEqual(380);
        expect((await card.boundingBox())!.width).toBeGreaterThan(250);
        const search = page.locator("#character-polish");
        await expect(search.locator("..")).toHaveClass("cyrene-search");
        await expect(page.locator(".achievement-search-icon")).toHaveCount(0);
        const styles = [];
        for (const id of [
            "achievement-polish",
            "character-polish",
            "inventory-polish",
            "plain-polish",
        ]) {
            const input = page.locator("#" + id);
            styles.push(
                await input.evaluate((el) => {
                    const s = getComputedStyle(el);
                    return [s.height, s.padding, s.fontSize, s.fontWeight, s.borderRadius];
                }),
            );
            await input.fill("Evernight");
            const clear = input.locator("..").getByRole("button", { name: "Clear search" });
            await expect(clear).toBeVisible();
            await expect(clear.locator("svg")).toHaveCount(1);
            await clear.click();
            await expect(input).toHaveValue("");
            await expect(input).toBeFocused();
            await expect(clear).toBeHidden();
        }
        for (const style of styles) expect(style).toEqual(styles[0]);
        await page.locator("#plain-polish").fill("reset me");
        await page.locator("[data-polish-form]").evaluate((el: HTMLFormElement) => el.reset());
        await expect(page.locator("#plain-polish").locator("..").getByRole("button")).toBeHidden();
        await page.locator("[data-polish-form]").evaluate((el) => {
            const input = document.createElement("input");
            input.type = "search";
            input.id = "dynamic-search";
            input.value = "new";
            el.append(input);
        });
        await expect(page.locator("#dynamic-search").locator("..")).toHaveClass("cyrene-search");
        await page.locator("#dynamic-search").locator("..").getByRole("button").click();
        await expect(page.locator("#dynamic-search")).toHaveValue("");
        const help = page.locator(".weapons-help");
        await help.scrollIntoViewIfNeeded();
        await help.locator("button").click();
        const popup = help.locator(".event-insight-popover");
        await expect(popup).toHaveClass(/is-visible/);
        await expect(popup).toHaveCSS("transform", "none");
        const before = (await popup.boundingBox())!;
        await page.waitForTimeout(220);
        const after = (await popup.boundingBox())!;
        expect(Math.abs(after.y - before.y)).toBeLessThan(0.2);
        const anchor = await help.locator("button").boundingBox();
        const arrow = await popup.evaluate((el) => {
            const s = getComputedStyle(el, "::before");
            return (
                el.getBoundingClientRect().left +
                (el as HTMLElement).clientLeft +
                parseFloat(s.left)
            );
        });
        expect(Math.abs(arrow - (anchor!.x + anchor!.width / 2))).toBeLessThan(0.5);
        await popup
            .locator("p")
            .evaluate((el) => (el.textContent += " Extra content. ".repeat(12)));
        await expect
            .poll(async () => {
                const a = (await help.locator("button").boundingBox())!,
                    b = (await popup.boundingBox())!;
                return Math.round((a.y - b.y - b.height) * 10) / 10;
            })
            .toBe(10);
        await page.keyboard.press("Escape");
        await page.screenshot({
            path: `test-results/control-polish-${browserName}-${width}.png`,
            fullPage: true,
        });
        await page.goto("/");
        const roster = page.getByRole("link", { name: "Login Discord", exact: true });
        await expect(roster).toHaveAttribute("href", "/verify");
        await expect(roster).not.toContainText("\u2192");
        expect(errors).toEqual([]);
    });
}
