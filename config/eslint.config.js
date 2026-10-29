import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: ["node_modules/**", "website/static/build/**", "dist/**"],
    },

    {
        files: ["website/src/**/*.ts"],

        extends: [js.configs.recommended, ...tseslint.configs.recommended],

        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",

            globals: {
                ...globals.browser,
            },
        },
    },

    {
        files: ["website/src/browser/**/*.ts"],

        rules: {
            "@typescript-eslint/ban-ts-comment": [
                "error",
                {
                    "ts-nocheck": false,
                },
            ],

            "@typescript-eslint/no-unused-vars": "off",
        },
    },
);
