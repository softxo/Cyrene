import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Render the real Planner markup, supplying only a small base document.
function shell(user: number, account: number, uid: string) {
    return execFileSync(
        ".venv/Scripts/python.exe",
        [
            "-c",
            String.raw`
import json,sys
from types import SimpleNamespace
from jinja2 import Environment,ChoiceLoader,DictLoader,FileSystemLoader
data=json.load(sys.stdin)
base='''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/static/build/css/global.css"><link rel="stylesheet" href="/static/build/css/characters.css"></head><body>{% block content %}{% endblock %}<script src="/static/build/browser/pages/characters/characters-planner.js"></script><script>initCharacterPlanner()</script></body></html>'''
env=Environment(loader=ChoiceLoader([DictLoader({'base.html':base}),FileSystemLoader('website/templates')]))
account={'id':data['account'],'genshin_uid':data['uid'],'nickname':'UID test'}
html=env.get_template('characters.html').render(request=SimpleNamespace(query_params={'tab':'planner'}),accounts=[account],selected_account=account,planner_user_id=data['user'],characters=[])
sys.stdout.buffer.write(html.encode('utf-8'))
`,
        ],
        { input: JSON.stringify({ user, account, uid }), encoding: "utf8" },
    );
}

for (const legacyPending of [true, false]) {
    test(`Planner recovers browser plans (pending=${legacyPending}), shares its UID and preserves deletion`, async ({
        page,
    }) => {
        const uid = "777000001";
        const key = `cyrene-character-plans-v3-${uid}`;
        const plan = {
            id: 10000031,
            name: "Fischl",
            icon: "/static/images/test.png",
            currentWeaponIcon: "/static/images/weapon.png",
            notes: "Unsaved before migration",
        };
        let sharedPlans: unknown[] = [];
        let snapshotExists = false;
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/static/**", (route) => {
            const path = new URL(route.request().url()).pathname;
            return route.fulfill({
                contentType: path.endsWith(".css") ? "text/css" : "text/javascript",
                body: path.includes("/build/") ? readFileSync(`website${path}`) : "",
            });
        });
        await page.route("**/api/characters/plans?*", (route) => {
            const account = new URL(route.request().url()).searchParams.get("account_id");
            if (route.request().method() === "PUT") {
                sharedPlans = route.request().postDataJSON().plans;
                snapshotExists = true;
            }
            return route.fulfill({
                json: {
                    plans: account === "3" ? [] : sharedPlans,
                    snapshot_exists: account === "3" ? false : snapshotExists,
                },
            });
        });
        const pages = new Map([
            ["1", shell(10, 1, uid)],
            ["2", shell(20, 2, uid)],
            ["3", shell(20, 3, "777000003")],
            ["4", shell(40, 4, uid)],
        ]);
        await page.route("**/characters?*", (route) =>
            route.fulfill({
                contentType: "text/html",
                body: pages.get(new URL(route.request().url()).searchParams.get("account_id")!)!,
            }),
        );
        await page.addInitScript(
            ({ plan, uid, legacyPending }) => {
                if (!localStorage.getItem("uid-test-seeded")) {
                    localStorage.setItem(
                        `cyrene-character-plans-v2-10-${uid}`,
                        JSON.stringify([plan]),
                    );
                    if (legacyPending)
                        localStorage.setItem(`cyrene-character-plans-v2-10-${uid}-pending`, "true");
                    localStorage.setItem("uid-test-seeded", "true");
                }
            },
            { plan, uid, legacyPending },
        );
        await page.goto("/characters?account_id=1&tab=planner");
        await expect(page.locator(".planner-card-notes")).toHaveText(plan.notes);
        await expect.poll(() => sharedPlans.length).toBe(1);
        await expect
            .poll(() => page.evaluate((key) => localStorage.getItem(`${key}-pending`), key))
            .toBeNull();
        await page.goto("/characters?account_id=2&tab=planner");
        await expect(page.locator(".planner-card-notes")).toHaveText(plan.notes);
        await page.goto("/characters?account_id=3&tab=planner");
        await expect(page.locator(".planner-character-card")).toHaveCount(0);
        await page.goto("/characters?account_id=4&tab=planner");
        await expect(page.locator(".planner-card-notes")).toHaveText(plan.notes);
        page.once("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "Remove Fischl's plan", exact: true }).click();
        await expect.poll(() => sharedPlans.length).toBe(0);
        await page.reload();
        await expect(page.locator(".planner-character-card")).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}
