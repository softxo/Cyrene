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
import asyncio,json,re
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
from starlette.requests import Request
from utils.web import app as web
from utils.web.temper_thyself import build_temper_thyself
NOW=1793620800
accounts=[dict(id=1,nickname='Evernight',genshin_uid='777527709',genshin_server='os_euro'),dict(id=2,nickname='Moon',genshin_uid='777527710',genshin_server='os_euro')]
async def fixtures():
 web._events_cache.clear()
 with patch.object(web,'get_accounts',AsyncMock(return_value=accounts)),patch.object(web,'get_account_client',AsyncMock(return_value=None)),patch.object(web,'get_event_activity_checks',AsyncMock(return_value={})):
  normal=await web.get_events_data(10,1)
  overview=await web.get_events_data(10,1,True)
 result={}
 for name,finished in [('active',False),('complete',True),('unavailable',None)]:
  context=deepcopy(normal)
  calendar=[] if finished is None else [SimpleNamespace(name='To Temper Thyself and Journey Far',start_timestamp=NOW-3600,end_timestamp=NOW+86400*84,is_finished=finished)]
  context['temper_thyself']=build_temper_thyself(calendar,now=NOW, notes={'week_active_progress':dict(progress_current=5 if name=='complete' else 3,progress_total=5,period_progress_current=8 if name=='complete' else 2,period_progress_total=8,unlock=True,is_active_period=True)} if name in ('active','complete') else None,weekly_end=NOW+86400*6 if name=='active' else 0)
  context['temper_thyself']['checked']=finished is True
  r=Request({'type':'http','path':'/events','headers':[],'query_string':b'tab=permanent'})
  html=web.templates.env.get_template('events.html').render(request=r,**context)
  result[name]=re.sub(r'<script\\b[\\s\\S]*?</script>','',html,flags=re.I)
 context=deepcopy(overview)
 context['overview_data'][0]['temper_thyself']=build_temper_thyself([SimpleNamespace(name='To Temper Thyself and Journey Far',start_timestamp=NOW-3600,end_timestamp=NOW+86400*84,is_finished=True)],now=NOW)
 context['overview_data'][0]['temper_thyself']['checked']=True
 r=Request({'type':'http','path':'/events','headers':[],'query_string':b'overview=true'})
 result['overview']=re.sub(r'<script\\b[\\s\\S]*?</script>','',web.templates.env.get_template('events.html').render(request=r,**context),flags=re.I)
 return result
print(json.dumps(asyncio.run(fixtures())))
`,
        ],
        { encoding: "utf8" },
    ),
);
const scripts = `<script src="/static/build/browser/pages/events/events-activity.js"></script><script src="/static/build/browser/pages/events/events-tabs.js"></script><script src="/static/build/browser/pages/events/events-timers.js"></script><script src="/static/build/browser/pages/events/events-refresh.js"></script><script>window.initialiseActivityCheckmarks();window.initialiseAccountTabs();window.initialiseOverviewTabs();window.updateEventTimeLeft();</script>`;
for (const width of [390, 1280]) {
    test(`Temper Thyself belongs to Permanent and refreshes safely at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.clock.install({ time: new Date("2026-11-02T12:00:00Z") });
        let state = "active";
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.route("http://127.0.0.1:8000/**", (route) => {
            const url = new URL(route.request().url());
            if (url.pathname === "/api/events/activity-check") {
                const data = route.request().postDataJSON();
                expect(data.activity_type).toBe("temper_thyself");
                return route.fulfill({ json: { success: true, checked: data.checked } });
            }
            if (url.pathname.startsWith("/static/"))
                return route.fulfill({
                    body: readFileSync(`website${url.pathname}`),
                    contentType: url.pathname.endsWith(".css")
                        ? "text/css"
                        : url.pathname.endsWith(".js")
                          ? "text/javascript"
                          : url.pathname.endsWith(".svg")
                            ? "image/svg+xml"
                            : "image/png",
                });
            const html = fixtures[url.searchParams.has("overview") ? "overview" : state];
            return route.fulfill({
                contentType: "text/html",
                body: html.replace("</body>", scripts + "</body>"),
            });
        });
        await page.goto("/events?tab=permanent");
        const card = page.locator('[data-permanent-event="temper-thyself"]');
        await expect(card).toBeVisible();
        await expect(card).toContainText("To Temper Thyself and Journey Far");
        await expect(card).toContainText("In progress");
        await expect(card).toContainText("3/7");
        await expect(card).toContainText("2/8");
        await expect(card.locator('[role="meter"]').first()).toHaveAttribute("aria-valuenow", "3");
        await expect(card.locator(".event-temper-durations time").first()).toHaveAttribute(
            "aria-label",
            "Weekly reset",
        );
        await expect(card.locator(".event-temper-durations time").nth(1)).toHaveAttribute(
            "aria-label",
            "Cycle end",
        );
        if (width >= 1001) {
            const training = await card.boundingBox();
            const trounce = await page.locator(".event-trounce-item").boundingBox();
            expect(training!.height).toBe(trounce!.height);
        }
        await card.screenshot({ path: `test-results/temper-thyself-progress-${width}.png` });
        expect(
            Number(await card.locator("[data-end-time]").first().getAttribute("data-end-time")),
        ).toBeGreaterThan(1793620800);
        await expect(card.locator(".event-checkmark")).toHaveCount(1);
        await card.locator(".event-checkmark").click();
        await expect(card.locator(".event-checkmark")).toHaveAttribute("aria-pressed", "true");
        await expect(card).toHaveClass(/completed/);
        await expect(card.locator('[role="meter"]').first()).toHaveAttribute("aria-valuenow", "3");
        await expect(card.locator(".event-checkmark")).not.toHaveAttribute("aria-busy", "true");
        await card.locator(".event-checkmark").click();
        await expect(card).not.toHaveClass(/completed/);
        await expect(card.locator(".event-checkmark")).not.toHaveAttribute("aria-busy", "true");
        await expect(page.locator(".events-limited [data-permanent-event]")).toHaveCount(0);
        await page.locator('[data-account-tab="events"]').click();
        await expect(card).toBeHidden();
        await page.locator('[data-account-tab="all"]').click();
        await expect(card).toBeVisible();
        await page.locator('[data-account-tab="permanent"]').click();
        state = "complete";
        await page.evaluate(async () => {
            await (window as unknown as { refreshEvents: () => Promise<void> }).refreshEvents();
        });
        await expect(card).toHaveClass(/completed/);
        await expect(card).toHaveCSS("opacity", "0.65");
        await expect(card).toContainText("Completed");
        await expect(card.locator(".event-list-status.event-completion-pill")).toBeVisible();
        await expect(card.locator(".event-temper-progress-box.event-completion-pill")).toHaveCount(
            2,
        );
        await expect(card.locator(".event-temper-progress-box").first()).toHaveCSS(
            "color",
            "rgb(114, 238, 162)",
        );
        await expect(page.locator('[data-account-tab="permanent"]')).toHaveClass(/active/);
        state = "unavailable";
        await page.evaluate(async () => {
            await (window as unknown as { refreshEvents: () => Promise<void> }).refreshEvents();
        });
        await expect(card).not.toHaveClass(/completed/);
        await expect(card).toContainText("Progress unavailable");
        await expect(card).toContainText("Cycle duration unavailable");
        await expect(card.locator("[data-end-time]")).toHaveCount(0);
        await card.screenshot({ path: `test-results/temper-thyself-unknown-${width}.png` });
        await page.goto("/events?overview=true&overview_tab=permanent");
        await expect(page.locator('[data-permanent-event="temper-thyself"]')).toHaveCount(2);
        const first = page.locator("#temper-thyself-1"),
            second = page.locator("#temper-thyself-2");
        await expect(page.locator('button[data-overview-tab="permanent"]')).toHaveText("Permanent");
        await expect(first).toHaveClass(/completed/);
        await expect(
            page.locator('[data-overview-panel="daily"] [data-permanent-event]'),
        ).toHaveCount(0);
        await expect(
            page.locator('[data-overview-panel="permanent"] [data-permanent-event]'),
        ).toHaveCount(2);
        await expect(page.locator('[data-overview-panel="permanent"]')).toContainText(
            "Trounce Domains",
        );
        await page.evaluate(async () => {
            await (window as unknown as { refreshEvents: () => Promise<void> }).refreshEvents();
        });
        const group = page.locator("#permanent-account-1");
        await expect(group.locator(".event-list-item")).toHaveCount(2);
        await expect(group.locator("summary")).toContainText("Evernight");
        await expect(group.locator("summary")).toContainText("1/2 complete");
        await group.locator("summary").click();
        await expect(first).toBeHidden();
        await page.evaluate(async () => {
            await (window as unknown as { refreshEvents: () => Promise<void> }).refreshEvents();
        });
        await expect(first).toBeHidden();
        await group.locator("summary").click();
        await page
            .locator('[data-overview-panel="permanent"]')
            .screenshot({ path: `test-results/permanent-overview-${width}.png` });
        await expect(first).toBeVisible();
        await expect(page.locator('button[data-overview-tab="permanent"]')).toHaveClass(/active/);
        await expect(page.locator('[data-overview-panel="permanent"]')).toContainText("Moon");
        await expect(second).not.toHaveClass(/completed/);
        await expect(second).toContainText("Progress unavailable");
        await first.screenshot({ path: `test-results/temper-thyself-overview-${width}.png` });
        expect(errors).toEqual([]);
    });
}
