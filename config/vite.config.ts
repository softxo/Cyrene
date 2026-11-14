import { defineConfig } from "vite";
import { fileURLToPath } from "url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
    publicDir: `${projectRoot}/website`,
    build: {
        copyPublicDir: false,
        outDir: `${projectRoot}/website/static/build`,
        emptyOutDir: true,
        sourcemap: true,
        cssMinify: true,

        rollupOptions: {
            input: {
                app: `${projectRoot}/website/src/app.ts`,
                "css/global": `${projectRoot}/website/src/styles/core/global.css`,
                "css/weapons": `${projectRoot}/website/src/styles/pages/weapons.css`,
                "css/home": `${projectRoot}/website/src/styles/pages/home.css`,
                "css/achievements": `${projectRoot}/website/src/styles/pages/achievements.css`,
                "css/wishes": `${projectRoot}/website/src/styles/pages/wishes.css`,
                "css/codes": `${projectRoot}/website/src/styles/pages/codes.css`,
                "css/docs": `${projectRoot}/website/src/styles/pages/docs.css`,
                "css/uploads": `${projectRoot}/website/src/styles/pages/uploads.css`,
                "css/exploration": `${projectRoot}/website/src/styles/pages/exploration.css`,
                "css/inventory": `${projectRoot}/website/src/styles/pages/inventory.css`,
                "css/reminders": `${projectRoot}/website/src/styles/pages/reminders.css`,
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
