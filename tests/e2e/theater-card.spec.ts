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
import asyncio,re
from pathlib import Path
from utils.web.app import templates
from utils.web.theater_elements import parse_opening_cast
from utils.web.quest_reward_details import localise_reward_images
source=Path('website/templates/events.html').read_text(encoding='utf-8')
macro=re.search(r'{% macro theater_opening_cast.*?{% endmacro %}',source,re.S)[0]
start=source.rfind('<div',0,source.index('data-event-type="theater"'))
end=source.index('STYGIAN ONSLAUGHT',start)
end=source.rfind('<!--',start,end)
card=source[start:end].replace('event-featured-card collapsed','event-featured-card')
names=['Yelan','Aino','Flins','Fischl','Zhongli','Kachina']
markup='<h3><span id="Opening_Characters">Opening Characters</span></h3>'
for name in names:
 markup+=f'<div class="card-container"><span class="card-image-container card-quality-5 card-element-hydro"><img src="https://static.wikia.nocookie.net/example/placeholder.png"></span><span class="card-text">{name}</span></div>'
cast=parse_opening_cast(markup)
asyncio.run(localise_reward_images({'rewards':cast}))
print(templates.env.from_string(macro+card).render(theater={'best_round':0,'medals':0,'arcanums':0,'end_time':1890000000,'elements':['Hydro','Electro','Geo'],'opening_cast':cast}))
`,
    ],
    { encoding: "utf8" },
);

for (const width of [360, 480]) {
    test(`No Record Theater still shows elements and real portraits at ${width}px`, async ({
        page,
    }) => {
        await page.route("**/static/**", (route) => {
            const path = new URL(route.request().url()).pathname;
            return route.fulfill({
                body: readFileSync(`website${path}`),
                contentType: path.endsWith(".css")
                    ? "text/css"
                    : path.endsWith(".png")
                      ? "image/png"
                      : "image/webp",
            });
        });
        await page.setViewportSize({ width: width + 32, height: 900 });
        await page.setContent(
            `<base href="http://127.0.0.1:8000/"><link rel="stylesheet" href="http://127.0.0.1:8000/static/build/css/global.css"><link rel="stylesheet" href="http://127.0.0.1:8000/static/build/css/events.css"><div class="events-page" style="width:${width}px;margin:16px">${fixture}</div>`,
        );
        const card = page.locator('[data-event-type="theater"]');
        await expect(card.getByText("No Record", { exact: true })).toBeVisible();
        await expect(card.locator(".it-elements .it-element-icon")).toHaveCount(3);
        const portraits = card.locator(".it-opening-portrait > img:not(.it-opening-element)");
        await expect(portraits).toHaveCount(6);
        await expect
            .poll(() =>
                portraits.evaluateAll((images) =>
                    images.every(
                        (image) =>
                            (image as HTMLImageElement).complete &&
                            (image as HTMLImageElement).naturalWidth > 0,
                    ),
                ),
            )
            .toBeTruthy();
        await expect(card.locator(".it-opening-character > span")).toHaveText([
            "Yelan",
            "Aino",
            "Flins",
            "Fischl",
            "Zhongli",
            "Kachina",
        ]);
        await expect
            .poll(() =>
                card
                    .locator(".it-elements img")
                    .evaluateAll((images) =>
                        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
                    ),
            )
            .toBeTruthy();
        const record = await card.locator(".event-featured-panel > .event-no-record").boundingBox();
        const elements = await card.locator(".it-elements").boundingBox();
        const opening = await card.locator(".it-opening-cast").boundingBox();
        expect(
            Math.abs(
                elements!.y + elements!.height / 2 - (record!.y + record!.height + opening!.y) / 2,
            ),
        ).toBeLessThan(2);
        const dimensions = await card
            .locator(".event-featured-panel")
            .evaluate((panel) => ({ height: panel.clientHeight, scroll: panel.scrollHeight }));
        expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.height + 1);
        await card.screenshot({ path: `test-results/theater-no-record-${width}.png` });
    });
}
