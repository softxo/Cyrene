import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { minifySync } from "vite";

const root = fileURLToPath(new URL("../website/static/build/browser", import.meta.url));

function* scripts(directory) {
    for (const name of readdirSync(directory)) {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) yield* scripts(path);
        else if (name.endsWith(".js")) yield path;
    }
}

let before = 0;
let after = 0;
for (const path of scripts(root)) {
    const source = readFileSync(path, "utf8");
    const result = minifySync(path, source, { mangle: { toplevel: false } });
    if (result.errors.length > 0) {
        console.error(`Minification failed for ${path}`);
        for (const error of result.errors) console.error(error.message ?? error);
        process.exit(1);
    }
    writeFileSync(path, result.code);
    before += source.length;
    after += result.code.length;
}
console.log(`Minified browser scripts: ${before} -> ${after} bytes`);
