import { defineConfig } from "vite";
import { fileURLToPath } from "url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    build: {
        outDir: `${projectRoot}/website/static/build`,
        emptyOutDir: true,
        sourcemap: true,
        cssMinify: false,

        rollupOptions: {
            input: {
                app: `${projectRoot}/website/src/app.ts`,
                "css/global": `${projectRoot}/website/src/styles/core/global.css`,
                "css/achievements": `${projectRoot}/website/src/styles/pages/achievements.css`,
                "css/codes": `${projectRoot}/website/src/styles/pages/codes.css`,
                "css/inventory": `${projectRoot}/website/src/styles/pages/inventory.css`,
                "css/planner": `${projectRoot}/website/src/styles/pages/planner.css`,
                "css/settings": `${projectRoot}/website/src/styles/pages/settings.css`,
                "css/verification": `${projectRoot}/website/src/styles/pages/verification.css`,
                "css/characters": `${projectRoot}/website/src/styles/pages/characters/characters.css`,
                "css/events": `${projectRoot}/website/src/styles/pages/events/events.css`,
            },

            output: {
                entryFileNames: "js/[name].js",
                chunkFileNames: "js/chunks/[name]-[hash].js",
                assetFileNames: "[name][extname]",
            },
        },
    },
});
