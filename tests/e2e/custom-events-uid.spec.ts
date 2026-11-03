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
  for name,overview,selected in [('overview',True,1),('normal',False,1)]:
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
const script = `<script>window.CyreneSchemas={customEventsListResponseSchema:{safeParse:data=>({success:true,data})},customEventCompletionResponseSchema:{safeParse:data=>({success:true,data})}};</script><script src="/static/build/browser/pages/events/events-tabs.js"></script><script src="/static/build/browser/pages/events/events-custom.js"></script><script>window.initialiseAccountTabs();window.initialiseOverviewTabs();initCustomEvents();</script>`;
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
        await page.reload();
        await first.locator("summary").click();
        await expect(first.locator('[role="progressbar"]')).toHaveAttribute("aria-valuenow", "3");
        await first.getByRole("button", { name: "Mark Complete", exact: true }).click();
        await expect(first).toHaveClass(/is-completed/);
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
