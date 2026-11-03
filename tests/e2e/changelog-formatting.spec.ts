import { test, expect, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

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

async function selectText(editor: Locator, value: string) {
    await editor.evaluate((element, text) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const start = node.textContent?.indexOf(text) ?? -1;
            if (start < 0) continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + text.length);
            const selection = window.getSelection()!;
            selection.removeAllRanges();
            selection.addRange(range);
            return;
        }
        throw new Error(`Cannot select ${text}`);
    }, value);
}

async function caretEnd(editor: Locator) {
    await editor.evaluate((element) => {
        element.focus();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
    });
}

for (const width of [390, 1280]) {
    test(`Changelog formatting, plain new lines and saved callouts at ${width}px`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 1000 });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let saved: Record<string, unknown> | null = null;
        await page.route("http://127.0.0.1:8000/**", (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith("/static/")) {
                const path = `website${url.pathname}`;
                return route.fulfill({
                    contentType: path.endsWith(".css")
                        ? "text/css"
                        : path.endsWith(".js")
                          ? "text/javascript"
                          : "image/png",
                    body: existsSync(path) ? readFileSync(path) : "",
                });
            }
            if (url.pathname.startsWith("/api/changelog")) {
                if (route.request().method() !== "GET") saved = route.request().postDataJSON();
                return route.fulfill({
                    json: {
                        can_edit: true,
                        entries: saved ? [{ id: 1, date_label: "2 Nov 2026", ...saved }] : [],
                        icons: [
                            {
                                name: "Fix_Redesign",
                                label: "Fix/Redesign",
                                url: "/static/images/ui/ui_misc/Fix_Redesign.png",
                            },
                        ],
                    },
                });
            }
            if (url.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
            return route.fulfill({ contentType: "text/html", body: fixture });
        });
        await page.goto("http://127.0.0.1:8000/");
        await page.getByRole("button", { name: "Add changelog", exact: true }).click();
        const dialog = page.locator(".changelog-dialog");
        const toolbar = dialog.getByRole("toolbar", { name: "Text formatting" });
        await expect(toolbar.getByRole("button")).toHaveCount(8);
        const editor = dialog.getByRole("textbox", { name: "What's new" });
        const preview = dialog.locator(".changelog-preview");
        const bold = toolbar.getByRole("button", { name: "Bold", exact: true });
        await bold.click();
        await editor.pressSequentially("x");
        await editor.press("Backspace");
        await expect(bold).toHaveAttribute("aria-pressed", "true");
        await editor.pressSequentially("y");
        await expect(editor.locator("strong")).toContainText("y");
        await editor.press("ControlOrMeta+A");
        await editor.press("Backspace");
        await expect(bold).toHaveAttribute("aria-pressed", "true");
        await bold.click();
        await expect(bold).toHaveAttribute("aria-pressed", "false");
        await editor.pressSequentially("z");
        await expect(editor.locator("strong").filter({ hasText: "z" })).toHaveCount(0);
        await editor.fill(":Fix_Redesign: **Changed** - faded");
        await selectText(editor, "faded");
        await toolbar.getByRole("button", { name: "Text opacity", exact: true }).click();
        const opacity = dialog.locator('[data-format-panel="opacity"]');
        await opacity.locator("[data-opacity-input]").fill("60");
        await expect(dialog.locator("[data-opacity-preview]")).toHaveCSS("opacity", "0.6");
        await opacity.getByRole("button", { name: "Apply to selected text" }).click();
        await editor.press("ArrowRight");
        await editor.press("Enter");
        await editor.pressSequentially("Fresh line");
        await expect(preview.locator("p").last()).toHaveText("Fresh line");
        await expect(preview.locator("p").last().locator("[data-text-opacity]")).toHaveCount(0);
        await expect(preview.locator("p").first().locator("[data-text-opacity]")).toHaveCSS(
            "opacity",
            "0.6",
        );

        await caretEnd(editor);
        await editor.press("Enter");
        await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
        await editor.pressSequentially("Bold typing");
        await expect(editor.locator("strong").last()).toContainText("Bold typing");
        await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
        await editor.pressSequentially(" normal");
        await expect(editor.locator("strong").last()).not.toContainText("normal");
        await selectText(editor, "normal");
        await toolbar.getByRole("button", { name: "Italic", exact: true }).click();
        await toolbar.getByRole("button", { name: "Underline", exact: true }).click();
        await expect(preview.locator("em u")).toHaveText("normal");
        await toolbar.getByRole("button", { name: "Underline", exact: true }).click();
        await expect(preview.locator("u")).toHaveCount(0);
        await toolbar.getByRole("button", { name: "Underline", exact: true }).click();
        await expect(preview.locator("em u")).toHaveText("normal");
        await toolbar.getByRole("button", { name: "Insert link", exact: true }).click();
        const link = dialog.locator('[data-format-panel="link"]');
        await expect(link.locator("[data-link-preview]")).toHaveCount(0);
        const linkBounds = (await link.boundingBox())!;
        const messageBounds = (await link.getByLabel("Message", { exact: true }).boundingBox())!;
        expect(messageBounds.width).toBeGreaterThan(linkBounds.width - 30);
        expect(messageBounds.height).toBeLessThanOrEqual(36);
        expect(linkBounds.height).toBeLessThan(240);
        await link.screenshot({ path: `test-results/changelog-compact-link-${width}.png` });

        await link.getByLabel("Message", { exact: true }).fill("Read docs");
        await link.getByLabel("Link", { exact: true }).fill("javascript:alert(1)");
        await link.getByRole("button", { name: "Insert link", exact: true }).click();
        await expect(link.locator("[data-link-error]")).toContainText("valid");
        await link.getByLabel("Link", { exact: true }).fill("https://example.com/docs");
        await expect(dialog.locator("[data-link-preview]")).toHaveText("Read docs");
        await link.getByRole("button", { name: "Insert link", exact: true }).click();
        await expect(preview.getByRole("link", { name: "Read docs" })).toHaveAttribute(
            "href",
            "https://example.com/docs",
        );

        await caretEnd(editor);
        await editor.press("Enter");
        await toolbar.getByRole("button", { name: "Italic", exact: true }).click();
        await editor.pressSequentially("Italic typing");
        await toolbar.getByRole("button", { name: "Underline", exact: true }).click();
        await editor.pressSequentially(" underline typing");
        await expect(preview.locator("em u").last()).toHaveText("underline typing");
        await editor.press("Enter");
        await editor.pressSequentially("Plain again");
        await expect(preview.locator("p").last()).toHaveText("Plain again");
        await expect(preview.locator("p").last().locator("em,u")).toHaveCount(0);

        await caretEnd(editor);
        await editor.press("Enter");
        await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
        await toolbar.getByRole("button", { name: "Text colour", exact: true }).click();
        await dialog
            .locator('[data-format-panel="colour"]')
            .getByRole("button", { name: "Colour selected text", exact: true })
            .click();
        await editor.pressSequentially(" Coloured typing");
        await expect(preview.locator("strong span").last()).toHaveText("Coloured typing");
        await expect(preview.locator("strong span").last()).toHaveCSS(
            "color",
            "rgb(143, 156, 255)",
        );

        for (const kind of ["Note", "Tip", "Important", "Caution", "Warning"]) {
            await caretEnd(editor);
            await toolbar.getByRole("button", { name: "Markdown blocks", exact: true }).click();
            const popup = dialog.locator('[data-format-panel="markdown"]');
            await popup.getByRole("button", { name: kind, exact: true }).click();
            await expect(popup.locator("[data-block-preview]")).toBeVisible();
            await expect(dialog.locator(".changelog-format-live-preview")).toBeHidden();
            const messageBounds = (await popup
                .getByLabel("Message", { exact: true })
                .boundingBox())!;
            expect(messageBounds.height).toBeLessThanOrEqual(80);
            expect(messageBounds.width).toBeGreaterThan((await popup.boundingBox())!.width - 30);
            if (kind === "Note")
                await dialog
                    .locator(".changelog-format-toolbar")
                    .screenshot({ path: `test-results/changelog-toolbar-preview-${width}.png` });
            if (kind === "Note")
                await popup.screenshot({
                    path: `test-results/changelog-compact-block-${width}.png`,
                });

            await expect(dialog.locator("[data-block-preview]")).toContainText(
                "This is how the text will look.",
            );
            const bounds = await popup.boundingBox();
            expect(bounds!.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
            await popup
                .getByLabel("Message", { exact: true })
                .fill(`${kind}: **Details** and ++underlined++ <img src=x onerror=alert(1)>`);
            await expect(popup.locator("[data-block-preview] img")).toHaveCount(0);
            await popup.getByRole("button", { name: "Insert block", exact: true }).click();
        }
        await caretEnd(editor);
        await toolbar.getByRole("button", { name: "Insert code block", exact: true }).click();
        const codePopup = dialog.locator('[data-format-panel="code"]');
        const sampleCode =
            'const template = "<img src=x onerror=alert(1)>";\n\n\t// **literal**, :Fix_Redesign:, [link](https://example.com)\n> [!WARNING]\nconst fence = "```";\n';
        await codePopup.getByLabel("Language (optional)", { exact: true }).fill("javascript");
        await codePopup.getByLabel("Code", { exact: true }).fill(sampleCode);
        await expect(codePopup.locator("[data-code-preview]")).toHaveText(sampleCode, {
            useInnerText: false,
        });
        await expect(dialog.locator(".changelog-format-live-preview")).toBeHidden();
        await expect(codePopup.locator("[data-code-preview]")).toHaveCSS("white-space", "pre");
        await codePopup.screenshot({ path: `test-results/changelog-code-popup-${width}.png` });
        await codePopup.getByRole("button", { name: "Insert code block", exact: true }).click();
        await expect(editor.locator("pre code")).toHaveText(sampleCode, { useInnerText: false });
        await expect(preview.locator("pre code")).toHaveText(sampleCode, { useInnerText: false });
        await expect(preview.locator("pre code img, pre code strong, pre code a")).toHaveCount(0);
        await expect(preview.locator("pre code")).toHaveCSS("white-space", "pre");
        await expect(preview.locator(".changelog-callout")).toHaveCount(5);
        await selectText(editor.locator(".changelog-callout--note"), "Details");
        await toolbar.getByRole("button", { name: "Underline", exact: true }).click();
        await expect(preview.locator(".changelog-callout--note strong u")).toHaveText("Details");
        await toolbar.getByRole("button", { name: "Text colour", exact: true }).click();
        await dialog
            .locator('[data-format-panel="colour"]')
            .screenshot({ path: `test-results/changelog-colour-popup-${width}.png` });
        await dialog.locator('[data-format-panel="colour"] button').first().focus();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('[data-format-panel="colour"]')).toBeHidden();
        await dialog.screenshot({ path: `test-results/changelog-formatting-${width}.png` });
        await dialog.getByRole("button", { name: "Publish update", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        expect(saved!.content).toContain("++[Read docs](https://example.com/docs)++");
        expect(saved!.content).not.toContain("[Fresh line]{opacity");
        await page.reload();
        const feed = page.locator("[data-changelog-entries]");
        await expect(feed.locator(".changelog-callout")).toHaveCount(5);
        await expect(feed.locator("pre code")).toHaveText(sampleCode, { useInnerText: false });
        expect(saved!.content).toContain("````javascript");
        await expect(feed.locator(".changelog-callout u")).toHaveCount(6);
        await expect(feed.getByRole("link", { name: "Read docs" })).toHaveAttribute(
            "href",
            "https://example.com/docs",
        );
        await feed.getByRole("button", { name: /Edit changelog/ }).click();
        await expect(editor.locator(".changelog-callout")).toHaveCount(5);
        await expect(editor.locator("u").first()).toHaveText("Read docs");
        await selectText(editor.locator("pre code"), "const template");
        await toolbar.getByRole("button", { name: "Insert code block", exact: true }).click();
        await expect(codePopup.getByLabel("Code", { exact: true })).toHaveValue(sampleCode);
        const editedCode = sampleCode + "// edited";
        await codePopup.getByLabel("Code", { exact: true }).fill(editedCode);
        await codePopup.getByRole("button", { name: "Insert code block", exact: true }).click();
        await expect(editor.locator("pre code")).toHaveCount(1);
        await expect(editor.locator("pre code")).toHaveText(editedCode, { useInnerText: false });
        await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
        await expect(dialog).not.toBeVisible();
        await page.reload();
        await expect(feed.locator("pre code")).toHaveText(editedCode, { useInnerText: false });
        expect(errors).toEqual([]);
    });
}
