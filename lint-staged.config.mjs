export default {
    "*.py": [
        ".venv/Scripts/python.exe -m ruff check --fix",
        ".venv/Scripts/python.exe -m ruff format",
    ],
    "*.{ts,tsx,js,mjs}": ["prettier --write"],
    "website/src/**/*.{ts,tsx,js,mjs}": ["eslint --fix"],
    "*.{css,json,md,yml,yaml}": ["prettier --write"],
};
