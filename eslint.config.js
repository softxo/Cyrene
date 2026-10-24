import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "node_modules/**",
            "website/static/build/**",
            "website/src/browser/**",
            "dist/**",
        ],
    },

    {
        files: ["website/src/**/*.ts"],

        extends: [
            js.configs.recommended,
            ...tseslint.configs.recommended,
        ],

        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",

            globals: {
                ...globals.browser,
            },
        },
    },
);
