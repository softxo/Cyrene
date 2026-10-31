import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("website/src/browser/pages/events/events-custom.ts", "utf8");
const functions = source.slice(
    source.indexOf("    function getCustomIconUrl("),
    source.indexOf('    iconInput?.addEventListener("change"'),
);
const upload = "/static/uploads/custom-events/12345678-1234-1234-1234-123456789abc.png";

function harness() {
    const iconImage = {
        hidden: true,
        removeAttribute(name) {
            delete this[name];
        },
    };
    const iconFilename = {};
    const removeIconButton = {};
    const context = vm.createContext({ iconImage, iconFilename, removeIconButton });
    vm.runInContext(
        `let previewObjectUrl = "blob:https://cyrene.test/local-preview";
        ${functions}
        globalThis.render = renderCustomIconPreview;
        globalThis.validate = getCustomIconUrl;`,
        context,
    );
    return { context, iconImage, iconFilename, removeIconButton };
}

test("uploaded icons and the locally created preview remain usable", () => {
    const { context, iconImage } = harness();
    for (const extension of ["png", "jpg", "webp"]) {
        const url = upload.replace(/png$/, extension);
        context.render(url);
        assert.equal(iconImage.src, url);
        assert.equal(iconImage.hidden, false);
    }
    context.render("blob:https://cyrene.test/local-preview");
    assert.equal(iconImage.src, "blob:https://cyrene.test/local-preview");
});

test("untrusted URLs clear the preview and cannot reach image sources", () => {
    const { context, iconImage, iconFilename, removeIconButton } = harness();
    for (const value of [
        "javascript:alert(1)",
        'data:image/svg+xml,<svg onload="alert(1)"/>',
        "https://attacker.test/icon.png",
        "//attacker.test/icon.png",
        "blob:https://cyrene.test/untrusted",
        `${upload}?redirect=1`,
        `${upload}/../other.png`,
        `${upload}' onerror='alert(1)`,
        "<img src=x onerror=alert(1)>",
        null,
        {},
    ]) {
        context.render(upload);
        assert.equal(context.validate(value), null);
        context.render(value);
        assert.equal(iconImage.src, undefined);
        assert.equal(iconImage.hidden, true);
        assert.equal(iconFilename.textContent, "No image selected");
        assert.equal(removeIconButton.hidden, true);
    }
});
