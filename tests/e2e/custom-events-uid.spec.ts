import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { customEventsListResponseSchema } from "../../website/src/schemas/events";
const python = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
const fixtures = JSON.parse(
    execFileSync(
        python,
        [
            "-X",
            "utf8",
            "-c",
            `
import asyncio,json,re
from unittest.mock import AsyncMock,patch
from starlette.requests import Request
from utils.web import app as web
accounts=[dict(id=1,nickname='Paragraph',genshin_uid='777000001',genshin_server='os_euro'),dict(id=2,nickname='Melody',genshin_uid='777000002',genshin_server='os_euro')]
async def main():
 result={}
 with patch.object(web,'get_accounts',AsyncMock(return_value=accounts)),patch.object(web,'get_account_client',AsyncMock(return_value=None)),patch.object(web,'get_event_activity_checks',AsyncMock(return_value={})):
  for name,overview,selected in [('overview',True,1),('normal',False,1),('second',False,2)]:
   context=await web.get_events_data(20,selected,overview)
   r=Request({'type':'http','path':'/events','headers':[],'query_string':b''})
   html=web.templates.env.get_template('events.html').render(request=r,**context)
   result[name]=re.sub(r'<script\\b[\\s\\S]*?</script>','',html,flags=re.I)
 return result
print(json.dumps(asyncio.run(main())))
`,
        ],
        { encoding: "utf8" },
    ),
);
const script = `<script type="module" src="/static/build/browser/core/toasts.js"></script><script type="module">import { initialiseSelectControls } from "/static/build/browser/core/select-controls.js"; import { initialiseColourPickers } from "/static/build/browser/core/colour-pickers.js"; initialiseSelectControls(); initialiseColourPickers();</script><script>window.CyreneSchemas={customEventsListResponseSchema:{safeParse:data=>({success:true,data})},customEventCompletionResponseSchema:{safeParse:data=>({success:true,data})}};</script><script src="/static/build/browser/pages/events/events-tabs.js"></script><script src="/static/build/browser/pages/events/events-custom.js"></script><script>window.initialiseAccountTabs();window.initialiseOverviewTabs();initCustomEvents();</script>`;
for (const width of [390, 1280]) {
    test(`Custom objectives display and persist in both layouts at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 1000 });
        let failMelody = false;
        const progress = new Map([
            [1, 2],
            [2, 1],
        ]);
        const completed = new Set<number>();
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("http://127.0.0.1:8000/**", (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith("/static/"))
                return route.fulfill({
                    body: readFileSync("website" + url.pathname),
                    contentType: url.pathname.endsWith(".css")
                        ? "text/css"
                        : url.pathname.endsWith(".js")
                          ? "text/javascript"
                          : url.pathname.endsWith(".svg")
                            ? "image/svg+xml"
                            : "image/png",
                });
            if (url.pathname === "/api/custom-events") {
                const id = Number(url.searchParams.get("account_id"));
                if (id === 2 && failMelody)
                    return route.fulfill({
                        status: 503,
                        json: { detail: "Temporarily unavailable" },
                    });
                const event = {
                    id: 100 + id,
                    title: id === 1 ? "Reputation [Sumeru]" : "Reputation [Liyue]",
                    description: null,
                    account_scope: "account",
                    account_id: id,
                    genshin_uid: id === 1 ? "777000001" : "777000002",
                    genshin_server: "os_euro",
                    start_at: "2026-11-01T04:00:00+00:00",
                    end_at: null,
                    created_at: "2026-11-01T00:00:00+00:00",
                    updated_at: "2026-11-01T00:00:00+00:00",
                    recurrence: { type: "none" },
                    colour: "#ff88aa",
                    reminder_minutes: null,
                    progress: [{ title: "Reputation", target: 5, current: progress.get(id) }],
                    icon_url: null,
                    completions: completed.has(id)
                        ? [
                              {
                                  occurrence_start: "2026-11-01T04:00:00+00:00",
                                  completed: true,
                                  completed_at: "2026-11-02T10:00:00+00:00",
                              },
                          ]
                        : [],
                };
                const json = { success: true, events: [event] };
                expect(customEventsListResponseSchema.safeParse(json).success).toBe(true);
                return route.fulfill({ json });
            }
            if (url.pathname.endsWith("/progress")) {
                const body = route.request().postDataJSON();
                progress.set(body.account_id, progress.get(body.account_id)! + body.amount);
                return route.fulfill({
                    json: { success: true, current: progress.get(body.account_id) },
                });
            }
            if (url.pathname.endsWith("/completion")) {
                const body = route.request().postDataJSON();
                if (body.completed) completed.add(body.account_id);
                else completed.delete(body.account_id);
                return route.fulfill({ json: { success: true, completed: body.completed } });
            }
            const html = fixtures[url.searchParams.has("overview") ? "overview" : "normal"];
            return route.fulfill({
                contentType: "text/html",
                body: html.replace("</body>", script + "</body>"),
            });
        });
        await page.goto("/events?overview=true&overview_tab=custom");
        const first = page.locator('[data-custom-event-id="101"]');
        const second = page.locator('[data-custom-event-id="102"]');
        await expect(first).toBeVisible();
        await expect(second).toBeVisible();
        await expect(first).toContainText("0/1 objectives");
        await first.locator("summary").click();
        await expect(
            first.getByRole("button", { name: "Increase Reputation progress for this account" }),
        ).toHaveCSS("width", "26px");
        await expect(
            first.getByRole("button", { name: "Increase Reputation progress for this account" }),
        ).toHaveCSS("height", "26px");

        await first
            .getByRole("button", { name: "Increase Reputation progress for this account" })
            .click();
        await expect(first.locator('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "3");
        await expect(page.locator(".cyrene-toast-message").last()).toHaveText(
            "Objective progress saved.",
        );
        await page.reload();
        await first.locator("summary").click();
        await expect(first.locator('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "3");
        await first.getByRole("button", { name: "Mark Complete", exact: true }).click();
        await expect(first).toHaveClass(/is-completed/);
        await expect(page.locator(".cyrene-toast-message").last()).toHaveText(
            "Reputation [Sumeru]: marked complete.",
        );
        await expect(first.locator(".events-custom-completion")).toHaveText("Complete");
        await expect(first.locator(".events-custom-completion")).toHaveCSS(
            "color",
            "rgb(114, 238, 162)",
        );
        await expect(first.locator(".events-custom-countdown")).not.toHaveClass(
            /event-completion-pill/,
        );
        await expect(first.locator("[data-countdown-target]")).toHaveCount(1);
        await expect(second).not.toHaveClass(/is-completed/);
        await page.goto("/events?account_id=1&tab=custom");
        await expect(page.locator(".events-custom-card")).toContainText("Reputation [Sumeru]");
        await expect(page.locator(".events-custom-card")).toContainText("3/5");
        await expect(
            page.locator(".events-custom-card .events-custom-progress-button").first(),
        ).toHaveCSS("width", "26px");
        failMelody = true;
        await page.goto("/events?overview=true&overview_tab=custom");
        await expect(first).toBeVisible();
        await expect(page.locator('[data-custom-event-list][data-account-id="2"]')).toContainText(
            "Couldn't Load Custom Events",
        );
        expect(errors).toEqual([]);
    });
}

for (const width of [390, 1280]) {
    test(`Custom editor controls and account context at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        const event = {
            id: 102,
            title: "Account activity",
            description: "Local notes",
            account_scope: "account",
            account_id: 2,
            start_at: "2026-11-08T12:17:00Z",
            end_at: null,
            recurrence: { type: "daily", interval: 2 },
            colour: "#ff88aa",
            reminder_minutes: 1440,
            progress: [{ title: "Collect", current: 2, target: 5 }],
            completions: [],
            icon_url: null,
        };
        let saved = null;
        let removed = false;
        let completed = false;
        await page.route("http://127.0.0.1:8000/**", async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.pathname.startsWith("/static/"))
                return route.fulfill({
                    body: readFileSync("website" + url.pathname),
                    contentType: url.pathname.endsWith(".css")
                        ? "text/css"
                        : url.pathname.endsWith(".js")
                          ? "text/javascript"
                          : url.pathname.endsWith(".svg")
                            ? "image/svg+xml"
                            : "image/png",
                });
            if (url.pathname === "/api/custom-events")
                return route.fulfill({
                    json: {
                        success: true,
                        events: removed
                            ? []
                            : [
                                  {
                                      ...event,
                                      completions: completed
                                          ? [{ occurrence_start: event.start_at, completed: true }]
                                          : [],
                                  },
                              ],
                    },
                });
            if (request.method() === "PUT") {
                saved = request.postDataJSON();
                Object.assign(event, saved);
                return route.fulfill({ json: { success: true, event } });
            }
            if (request.method() === "DELETE") {
                expect(url.searchParams.get("account_id")).toBe("2");
                removed = true;
                return route.fulfill({ json: { success: true, deleted_id: 102 } });
            }
            if (url.pathname.endsWith("/completion")) {
                completed = request.postDataJSON().completed;
                return route.fulfill({ json: { success: true, completed } });
            }
            const schemas = `<script>window.CyreneSchemas = new Proxy({}, { get: () => ({ safeParse: data => ({ success: true, data }) }) });</script>`;
            return route.fulfill({
                contentType: "text/html",
                body: fixtures.second.replace(
                    "</body>",
                    schemas +
                        script.replace(/<script>window.CyreneSchemas=.*?<\/script>/, "") +
                        "</body>",
                ),
            });
        });
        await page.goto("/events?account_id=2&tab=custom");
        const card = page.locator(".events-custom-card").first();
        await expect(card.locator(".events-custom-completion")).toHaveText("Incomplete");
        await expect(card.locator(".events-custom-completion")).toHaveClass(/event-list-status/);
        await expect(card.locator(".events-custom-completion")).not.toHaveClass(/not-claimed/);
        expect(
            await card
                .locator(".events-custom-completion")
                .evaluate((el) =>
                    el.nextElementSibling?.classList.contains("events-custom-countdown"),
                ),
        ).toBe(true);
        await card.getByRole("button", { name: "Mark Complete", exact: true }).click();
        await expect(card.locator(".events-custom-completion")).toHaveText("Complete");
        await expect(card.locator("[data-countdown-target]")).toHaveCount(1);
        await card.screenshot({ path: `test-results/custom-status-${width}.png` });
        await card.getByRole("button", { name: "Edit", exact: true }).click();
        const modal = page.locator("[data-custom-modal]");
        await expect(modal).toBeVisible();
        await expect(modal.locator('[name="account_id"]')).toHaveValue("2");
        await expect(
            modal.locator("[data-custom-account-select] [data-account-id]").first(),
        ).toHaveAttribute("data-account-id", "2");
        const current = modal.getByRole("spinbutton", { name: "Current progress" });
        await expect(current).toHaveValue("2");
        await expect(current).toHaveCSS("border-top-width", "0px");
        await expect(current).toHaveCSS("border-radius", "0px");
        const currentWrapper = current.locator("..");
        await currentWrapper.getByRole("button", { name: "Increase value" }).click();
        await expect(current).toHaveValue("3");
        await currentWrapper.getByRole("button", { name: "Decrease value" }).focus();
        await page.keyboard.press("Enter");
        await expect(current).toHaveValue("2");
        const interval = modal.locator('[name="recurrence_interval"]');
        await expect(interval).toHaveCSS("border-top-width", "0px");
        await expect(interval).toHaveCSS("border-radius", "0px");
        await interval.locator("..").getByRole("button", { name: "Increase value" }).click();
        await expect(interval).toHaveValue("3");
        const scheduleHeight = await modal
            .locator('[data-custom-dropdown="recurrence_type"] > button')
            .evaluate((el) => el.getBoundingClientRect().height);
        expect(
            await interval.locator("..").evaluate((el) => el.getBoundingClientRect().height),
        ).toBe(scheduleHeight);
        const titleHeight = await modal
            .getByRole("textbox", { name: "Objective name" })
            .evaluate((el) => el.getBoundingClientRect().height);
        expect(await currentWrapper.evaluate((el) => el.getBoundingClientRect().height)).toBe(
            titleHeight,
        );
        await modal.locator(".events-custom-datetime-trigger").first().click();
        const calendar = modal.locator(".events-custom-calendar").first();
        await expect(calendar).toHaveAttribute("data-modal-panel", "");
        await expect
            .poll(() => calendar.evaluate((el) => el.getAnimations().length))
            .toBeGreaterThan(0);
        await calendar.getByRole("textbox", { name: "Minute", exact: true }).fill("37");
        await calendar.locator(".events-custom-calendar-month").click();
        await expect(calendar).toBeVisible();
        await expect(calendar.getByRole("textbox", { name: "Minute", exact: true })).toHaveValue(
            "37",
        );
        await calendar.getByRole("button", { name: "Apply", exact: true }).click();
        await modal.locator(".events-custom-datetime-trigger").first().click();
        await expect(calendar.getByRole("textbox", { name: "Minute", exact: true })).toHaveValue(
            "37",
        );
        await calendar.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect
            .poll(() => calendar.evaluate((el) => el.getAnimations().length))
            .toBeGreaterThan(0);
        await expect(calendar).toBeHidden();

        const reminder = modal.locator('[data-custom-dropdown="reminder_minutes"]');
        await reminder.locator(".custom-select-button").click();
        const option = reminder.getByRole("option", { name: "1 day before", exact: true });
        await expect(option).toBeInViewport({ ratio: 1 });
        const menuBounds = await reminder.getByRole("listbox").boundingBox();
        const panelBounds = await modal.locator(".events-custom-dialog").boundingBox();
        expect(menuBounds!.y + menuBounds!.height).toBeLessThanOrEqual(
            panelBounds!.y + panelBounds!.height - 8,
        );
        await page.screenshot({
            path: `test-results/custom-reminder-${width}.png`,
            fullPage: true,
        });
        await option.click();
        await expect(reminder.getByRole("listbox")).toBeHidden();
        await reminder.locator(".custom-select-button").click();
        await expect(reminder.getByRole("listbox")).toBeVisible();
        await reminder.locator(".custom-select-button").click();
        await expect(reminder.getByRole("listbox")).toBeHidden();
        expect(await modal.locator("form").evaluate((el) => el.style.paddingBottom)).toBe("");
        const colour = modal.locator('input[type="color"]');
        await expect(colour).toBeVisible();
        await expect(modal.locator(".cyrene-colour-trigger, .cyrene-colour-popover")).toHaveCount(
            0,
        );
        await colour.click();
        await expect.poll(() => colour.evaluate((el) => el.matches(":open"))).toBe(true);
        await colour.click();
        await expect.poll(() => colour.evaluate((el) => el.matches(":open"))).toBe(false);
        await expect(colour).toBeVisible();
        await colour.click();
        await expect.poll(() => colour.evaluate((el) => el.matches(":open"))).toBe(true);
        await colour.click();
        await expect.poll(() => colour.evaluate((el) => el.matches(":open"))).toBe(false);
        await colour.fill("#12abef");
        await modal
            .getByRole("button", { name: "Choose image", exact: true })
            .scrollIntoViewIfNeeded();
        await modal.locator("[data-custom-icon-file]").setInputFiles({
            name: "a-very-long-custom-event-icon-filename-that-must-stay-on-one-line.png",
            mimeType: "image/png",
            buffer: Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
                "base64",
            ),
        });
        const filename = modal.locator("[data-custom-icon-filename]");
        await expect(filename).toHaveCSS("white-space", "nowrap");
        await page.screenshot({ path: `test-results/custom-editor-${width}.png`, fullPage: true });
        await modal.getByRole("button", { name: "Remove icon", exact: true }).click();
        await modal.getByRole("button", { name: "Save Changes", exact: true }).click();
        await expect(modal).toBeHidden();
        expect(saved.progress[0].current).toBe(2);
        expect(saved.account_id).toBe(2);
        await card.getByRole("button", { name: "Delete", exact: true }).click();
        const confirmation = page.locator(".events-custom-delete-dialog");
        await expect(confirmation).toBeVisible();
        await confirmation.getByRole("button", { name: "Delete event", exact: true }).click();
        await expect(card).toHaveCount(0);
        await page.locator("[data-custom-create]").first().click();
        await modal.locator('[name="account_scope"][value="account"]').check();
        await expect(modal.locator('[name="account_id"]')).toHaveValue("2");
        const accounts = modal.locator("[data-custom-account-select]");
        await accounts.locator(".custom-select-button").click();
        await accounts.locator('[data-account-id="1"]').click();
        await expect(modal.locator('[name="account_id"]')).toHaveValue("1");
        await expect(accounts).not.toHaveClass(/open/);
        await page.emulateMedia({ reducedMotion: "reduce" });
        await modal.locator(".events-custom-datetime-trigger").first().click();
        await expect(calendar).toHaveCSS("transition-duration", "0s");
        await calendar.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(calendar).toBeHidden();
    });
}
