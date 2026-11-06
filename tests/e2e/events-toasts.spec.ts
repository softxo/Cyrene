import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("Events completion toasts reflect saved results and failures restore the checkmark", async ({
    page,
}) => {
    let fail = false;
    await page.route("http://events.test/**", (route) => {
        if (route.request().url().endsWith("/api/events/activity-check")) {
            if (fail) return route.fulfill({ status: 503, json: { error: "Unavailable" } });
            return route.fulfill({
                json: { success: true, checked: route.request().postDataJSON().checked },
            });
        }
        return route.fulfill({
            contentType: "text/html",
            body: '<div class="event-list-item"><button class="event-checkmark" data-account-id="1" data-activity-type="limited_event" data-event-key="demo" aria-pressed="false">Complete</button></div>',
        });
    });
    await page.goto("http://events.test/");
    await page.addScriptTag({
        content: readFileSync("website/static/build/browser/core/toasts.js", "utf8")
            .replaceAll("export function", "function")
            .replace(/export \{\};?/, ""),
    });
    await page.addScriptTag({
        content: readFileSync(
            "website/static/build/browser/pages/events/events-activity.js",
            "utf8",
        ),
    });
    await page.evaluate(() => (window as any).initialiseActivityCheckmarks());
    const button = page.getByRole("button", { name: "Complete", exact: true });
    await button.click();
    await expect(page.locator(".cyrene-toast-message").last()).toHaveText("Event marked complete.");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    fail = true;
    await button.click();
    await expect(page.locator('.cyrene-toast[data-kind="error"]')).toContainText(
        "Could not save completion. Please try again.",
    );
    await expect(button).toHaveAttribute("aria-pressed", "true");
});
