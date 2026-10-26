export default {
    "*.py": [
        "python -m ruff check --fix",
        "python -m ruff format",
    ],
    "*.{ts,tsx,js,mjs}": [
        "prettier --write",
    ],
    "website/src/**/*.{ts,tsx,js,mjs}": [
        "eslint --fix",
    ],
    "*.{css,json,md,yml,yaml}": [
        "prettier --write",
    ],
};