import { defineConfig } from "vite";
import { fileURLToPath } from "url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
    build: {
        outDir: `${projectRoot}/website/static/build`,
        emptyOutDir: true,
        sourcemap: true,

        rollupOptions: {
            input: {
                app: `${projectRoot}/website/src/app.ts`,
            },

            output: {
                entryFileNames: "js/[name].js",
                chunkFileNames: "js/chunks/[name]-[hash].js",
                assetFileNames: "assets/[name]-[hash][extname]",
            },
        },
    },
});