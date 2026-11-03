import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const python = process.platform === "win32" ? ".venv/Scripts/python.exe" : ".venv/bin/python";
const fixture = execFileSync(
    python,
    [
        "-X",
        "utf8",
        "-c",
        `
from starlette.requests import Request
from utils.web.app import templates
request=Request({'type':'http','method':'GET','path':'/','headers':[],'scheme':'http','server':('127.0.0.1',8000),'query_string':b''})
print(templates.env.get_template('home.html').render(request=request))
`,
    ],
    { encoding: "utf8" },
);

for (const width of [390, 1280]) {
    test(`Changelog editing, emojis, persistence, and navigation at ${width}px`, async ({
        page,
    }) => {
        await page.clock.install({ time: new Date("2026-11-01T12:00:00Z") });
        await page.setViewportSize({ width, height: 900 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let editor = true;
        let fail = false;
        let entries = [
            {
                id: 1,
                date: "2026-11-01",
                date_label: "1 Nov 2026",
                content:
                    ":Feature: Added Weapons\n:Bugfix: Fixed scrolling\n**Added [Changelog**]{#e889b5}",
            },
        ];
        await page.route("http://127.0.0.1:8000/**", async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith("/static/")) {
                const type = url.pathname.endsWith(".css")
                    ? "text/css"
                    : url.pathname.endsWith(".js")
                      ? "text/javascript"
                      : "image/png";
                return route.fulfill({
                    body: readFileSync(`website${url.pathname}`),
                    contentType: type,
                });
            }
            if (url.pathname.startsWith("/api/changelog")) {
                const method = route.request().method();
                if (method !== "GET" && fail)
                    return route.fulfill({
                        status: 403,
                        json: { detail: "You cannot manage the changelog." },
                    });
                if (method === "POST") {
                    const body = route.request().postDataJSON();
                    entries.unshift({ id: 2, date_label: `2 Nov 2026, ${body.time}`, ...body });
                } else if (method === "PUT") {
                    const body = route.request().postDataJSON();
                    entries = entries.map((entry) =>
                        entry.id === 2 ? { ...entry, ...body } : entry,
                    );
                } else if (method === "DELETE") entries = entries.filter((entry) => entry.id !== 2);
                return route.fulfill({
                    json: {
                        entries,
                        can_edit: editor,
                        icons: ["Feature", "Bugfix", "Weapons", "Fix_Redesign", "Changelog"].map(
                            (name) => ({
                                name,
                                label: name === "Fix_Redesign" ? "Fix/Redesign" : name,
                                url: `/static/images/ui/ui_misc/${name}.png`,
                            }),
                        ),
                    },
                });
            }
            if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
            return route.fulfill({ body: fixture, contentType: "text/html" });
        });
        await page.goto("http://127.0.0.1:8000/");
        const root = page.locator("[data-changelog]");
        await expect(root.getByText("Added Weapons", { exact: false })).toBeVisible();
        await expect(root.locator(".changelog-entry-content img")).toHaveCount(2);
        await expect(root.locator(".changelog-entry-content strong")).toHaveText("Added Changelog");
        await expect(root.locator(".changelog-entry-content strong span")).toHaveCSS(
            "font-weight",
            "800",
        );
        await expect(root.locator(".changelog-entry-content strong span")).toHaveCSS(
            "font-size",
            "14.5px",
        );

        await root.getByRole("button", { name: "Add changelog", exact: true }).click();
        const dialog = page.locator(".changelog-dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.locator("h2")).toHaveText("Add Changelog");
        await expect(dialog.locator("[data-opacity-input]")).toHaveValue("60");
        await expect(dialog.locator("[data-opacity-value]")).toHaveText("60%");

        await dialog.locator("h2").click();
        await expect(dialog).toBeVisible();
        await page.mouse.click(2, 2);
        await expect(dialog).not.toBeVisible();
        await root.getByRole("button", { name: "Add changelog", exact: true }).click();
        await expect(dialog).toBeVisible();

        await expect(dialog.getByLabel("What's new", { exact: true })).not.toBeFocused();
        await dialog.getByRole("button", { name: "Choose date", exact: true }).click();
        const calendar = dialog.locator("[data-date-calendar]");
        await calendar.screenshot({ path: `test-results/changelog-calendar-${width}.png` });
        await calendar
            .getByRole("gridcell", { name: "Monday, 2 November 2026", exact: true })
            .click();
        await calendar.getByLabel("Hour", { exact: true }).fill("22");
        await calendar.getByLabel("Minute", { exact: true }).fill("19");
        await calendar.getByRole("button", { name: "Apply", exact: true }).click();
        await expect(dialog.locator("[data-date-trigger] .changelog-date-time")).toHaveText(
            "22:19",
        );
        await expect(dialog.locator("[data-pill-preview]")).toHaveText("2 Nov 2026, 22:19");

        await dialog.locator("[name=pill_colour]").fill("#e889b5");
        await dialog.getByLabel("Gradient", { exact: true }).check();
        await dialog.getByLabel("Gradient end colour", { exact: true }).fill("#44aa66");
        await expect(dialog.locator("[data-pill-preview]")).toHaveClass(/is-gradient/);
        expect(
            await dialog
                .locator("[data-pill-preview]")
                .evaluate((el) => getComputedStyle(el).backgroundImage),
        ).toContain("linear-gradient");

        await dialog.locator("[name=pill_colour]").evaluate((el) => {
            el.setAttribute("data-clicks", "0");
            el.addEventListener("click", () =>
                el.setAttribute("data-clicks", String(Number(el.getAttribute("data-clicks")) + 1)),
            );
        });
        await dialog.locator("[data-pill-preview]").click();
        await expect(dialog.locator("[name=pill_colour]")).toHaveAttribute("data-clicks", "0");
        const stableModalTop = (await dialog.boundingBox())!.y;
        await dialog.locator(".changelog-format-help summary").click();
        await dialog.locator(".changelog-help-content").evaluate(async (el) => {
            await Promise.all(el.getAnimations().map((animation) => animation.finished));
        });
        expect(Math.abs((await dialog.boundingBox())!.y - stableModalTop)).toBeLessThan(1);

        await expect(dialog.locator(".changelog-hint")).toContainText("Select text or use B");
        await expect(dialog.locator(".changelog-hint")).toContainText('Use "Insert emoji"');
        await dialog.locator(".changelog-format-help summary").click();
        await expect(dialog.locator(".changelog-help-content")).toBeHidden();

        if (width === 1280) expect((await dialog.boundingBox())!.width).toBe(760);

        await dialog.getByRole("button", { name: "Insert emoji", exact: true }).click();
        await expect(dialog.getByRole("button", { name: "Insert Live Status" })).toHaveCount(0);
        await dialog.getByRole("button", { name: "Insert emoji", exact: true }).click();
        await expect(dialog.locator(".changelog-picker")).toBeHidden();
        await dialog.getByRole("button", { name: "Insert emoji", exact: true }).click();
        await expect(dialog.locator(".changelog-picker")).toBeVisible();
        await expect(dialog.getByRole("button", { name: "Insert emoji", exact: true })).toHaveCSS(
            "user-select",
            "none",
        );
        for (const image of await dialog.locator(".changelog-picker img").all()) {
            await expect(image).toHaveCSS("width", "22px");
            await expect(image).toHaveCSS("height", "22px");
        }

        const snap = await dialog.locator(".changelog-emoji-disclosure").evaluate(async (el) => {
            const animation = el.getAnimations()[0];
            if (!animation) return 0;
            const frames = (animation.effect as KeyframeEffect).getKeyframes();
            const expected = Number.parseFloat(String(frames[frames.length - 1].height));
            await animation.finished;
            await Promise.resolve();
            return Math.abs(el.getBoundingClientRect().height - expected);
        });
        expect(snap).toBeLessThan(0.5);
        expect(Math.abs((await dialog.boundingBox())!.y - stableModalTop)).toBeLessThan(1);

        expect(
            await dialog
                .locator(".changelog-picker")
                .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length),
        ).toBe(4);

        await dialog.getByRole("button", { name: "Insert Weapons", exact: true }).click();
        await dialog.getByLabel("What's new", { exact: true }).press("End");
        await dialog
            .getByLabel("What's new", { exact: true })
            .pressSequentially("New account sharing <img src=x onerror=alert(1)>");
        await expect(
            dialog.getByRole("button", { name: "Insert Changelog", exact: true }),
        ).toHaveCount(0);
        await expect(
            dialog.getByRole("button", { name: "Insert Fix/Redesign", exact: true }),
        ).toBeVisible();
        const textBox = dialog.getByLabel("What's new", { exact: true });
        await textBox.focus();
        expect(await textBox.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
        expect(await textBox.evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");
        await expect(dialog.locator(".changelog-preview img")).toHaveCount(1);
        await expect(dialog.locator(".changelog-preview")).toContainText(
            "<img src=x onerror=alert(1)>",
        );
        await textBox.fill(
            ":Weapons: **Bold _nested_** and _italic_ ~~removed~~ `code` [docs](https://example.com) [unsafe](javascript:alert(1))",
        );
        await textBox.evaluate((el) => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let text = walker.nextNode()!;
            while (!text.textContent?.includes("Bold")) text = walker.nextNode()!;
            const start = text.textContent!.indexOf("Bold");
            const range = document.createRange();
            range.setStart(text, start);
            range.setEnd(text, start + 4);
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
        });
        await dialog.getByRole("button", { name: "Text colour", exact: true }).click();
        await dialog.getByRole("button", { name: "Presets", exact: true }).click();
        await dialog.getByLabel("Preset hex colour", { exact: true }).fill("bad");
        await dialog.getByRole("button", { name: "Save preset", exact: true }).click();
        await expect(dialog.locator("[data-preset-status]")).toContainText("six-digit");
        await dialog.getByLabel("Preset colour picker", { exact: true }).fill("#ff88aa");
        await expect(dialog.getByLabel("Preset hex colour", { exact: true })).toHaveValue(
            "#ff88aa",
        );
        await dialog.getByLabel("Preset hex colour", { exact: true }).fill("#aa88ff");
        await expect(dialog.getByLabel("Preset colour picker", { exact: true })).toHaveValue(
            "#aa88ff",
        );
        await dialog.getByLabel("Preset hex colour", { exact: true }).fill("#ff88aa");
        await dialog.getByRole("button", { name: "Save preset", exact: true }).click();
        await dialog.getByRole("button", { name: "Use colour #ff88aa", exact: true }).click();

        await expect(dialog.locator("[data-text-colour-preview]")).toHaveCSS(
            "color",
            "rgb(255, 136, 170)",
        );
        await dialog.getByRole("button", { name: "Colour selected text", exact: true }).click();
        await expect(textBox.locator("span[data-text-colour]")).toHaveText("Bold");
        await expect(textBox.locator("span[data-text-colour]")).toHaveCSS(
            "color",
            "rgb(255, 136, 170)",
        );
        await expect(textBox).not.toContainText("{#ff88aa}");
        await expect(dialog.locator(".changelog-preview strong span")).toHaveCSS(
            "color",
            "rgb(255, 136, 170)",
        );
        await expect(dialog.locator(".changelog-preview strong em")).toHaveText("nested");
        await expect(dialog.locator(".changelog-preview s")).toHaveText("removed");
        await expect(dialog.locator(".changelog-preview code")).toHaveText("code");
        await expect(dialog.locator(".changelog-preview a")).toHaveCount(1);
        await textBox.locator("span[data-text-colour]").evaluate((el) => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
        });
        await dialog.getByRole("button", { name: "Text opacity", exact: true }).click();
        await dialog.locator("[data-opacity-input]").fill("50");
        await dialog.getByRole("button", { name: "Apply to selected text", exact: true }).click();
        await expect(textBox.locator("span[data-text-opacity]")).toHaveCSS("opacity", "0.5");
        await expect(textBox.locator("span[data-text-opacity]")).toHaveCSS(
            "color",
            "rgb(255, 136, 170)",
        );
        await expect(dialog.locator(".changelog-preview strong span")).toHaveCSS("opacity", "0.5");

        await dialog.getByRole("button", { name: "Publish update", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await page.reload();
        await expect(root.locator(".changelog-entry")).toHaveCount(2);
        await expect(
            root.locator(".changelog-entry-content strong span").filter({ hasText: "Bold" }),
        ).toHaveCSS("color", "rgb(255, 136, 170)");
        await root.getByRole("button", { name: "Edit changelog for 2 Nov 2026" }).click();
        await expect(dialog.locator("[name=pill_colour]")).toHaveValue("#e889b5");
        await expect(dialog.getByLabel("Gradient", { exact: true })).toBeChecked();
        await expect(dialog.locator(".changelog-date-time")).toHaveText("22:19");
        await expect(dialog.getByLabel("Gradient end colour", { exact: true })).toHaveValue(
            "#44aa66",
        );

        await expect(textBox.locator("span[data-text-colour]")).toHaveText("Bold");
        await dialog.getByRole("button", { name: "Text colour", exact: true }).click();
        await dialog.getByRole("button", { name: "Presets", exact: true }).click();
        await expect(
            dialog.getByRole("button", { name: "Use colour #ff88aa", exact: true }),
        ).toBeVisible();
        await dialog.getByRole("button", { name: "Presets", exact: true }).click();

        await expect(textBox.locator("span[data-text-opacity]")).toHaveCSS("opacity", "0.5");
        await expect(textBox).not.toContainText("{#ff88aa}");

        await dialog.getByLabel("What's new", { exact: true }).fill(":Bugfix: Updated text");
        await page.clock.fastForward(16000);
        await expect(dialog.getByLabel("What's new", { exact: true })).toHaveText(
            ":Bugfix: Updated text",
        );
        fail = true;
        await dialog.getByRole("button", { name: "Save changes" }).click();
        await expect(dialog.getByRole("alert")).toContainText("cannot manage");
        await expect(dialog.getByLabel("What's new", { exact: true })).toHaveText(
            ":Bugfix: Updated text",
        );
        fail = false;
        await dialog.getByRole("button", { name: "Save changes" }).click();
        await expect(dialog).not.toBeVisible();
        await expect(root).toContainText("Updated text");
        await root.screenshot({ path: `test-results/home-changelog-${width}.png` });
        await root.getByRole("button", { name: "Add changelog", exact: true }).click();
        await dialog.getByRole("button", { name: "Insert emoji", exact: true }).click();
        await dialog
            .getByLabel("What's new", { exact: true })
            .fill(":Feature: Preview of a new update");
        await dialog.screenshot({ path: `test-results/home-changelog-editor-${width}.png` });
        const box = await dialog.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width);
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
        await root.getByRole("button", { name: "Edit changelog for 2 Nov 2026" }).click();

        await dialog.getByRole("button", { name: "Delete update" }).click();
        const confirmation = page.getByRole("dialog", { name: "Delete this update?" });
        await expect(confirmation).toBeVisible();
        await expect(confirmation).toContainText("2 Nov 2026");
        await confirmation.getByRole("button", { name: "Keep update" }).click();
        await expect(root.locator(".changelog-entry")).toHaveCount(2);
        await dialog.getByRole("button", { name: "Delete update", exact: true }).click();
        await confirmation.screenshot({ path: `test-results/changelog-delete-${width}.png` });
        await confirmation.getByRole("button", { name: "Delete update", exact: true }).click();

        await expect(root.locator(".changelog-entry")).toHaveCount(1);
        // Run the real SPA lifecycle away from Home and back.
        await page.locator('.home-hero-actions a[href="/settings"]').click();
        await expect(page).toHaveURL(/settings$/);
        if (width < 768) await page.getByRole("button", { name: "Open navigation" }).click();
        await page.locator('a[href="/"]').first().click();
        await expect(page).toHaveURL("http://127.0.0.1:8000/");
        await expect(root.locator(".changelog-entry")).toHaveCount(1);
        editor = false;
        await page.reload();
        await expect(root).toContainText("Added Weapons");
        await expect(root.getByRole("button", { name: "Add changelog", exact: true })).toBeHidden();
        await expect(root.getByRole("button", { name: /Edit changelog/ })).toHaveCount(0);
        entries[0].content = ":Feature: Live update without refreshing";
        await page.clock.fastForward(16000);
        await expect(root).toContainText("Live update without refreshing");
        entries = [];
        await page.clock.fastForward(16000);
        await expect(root.locator(".changelog-entry")).toHaveCount(0);
        expect(errors).toEqual([]);
    });
}
