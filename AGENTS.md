# Cyrene — Codex Instructions

## Project structure

- `main.py`: Discord bot and application entry point.
- `cogs/`: Discord command modules.
- `utils/`: Python backend and shared logic.
- `utils/web/app.py`: FastAPI routes and website APIs.
- `utils/hoyolab/`: HoYoLAB integration and database logic.
- `website/templates/`: Jinja templates.
- `website/static/css/`: Website stylesheets.
- `website/src/browser/`: TypeScript browser source, organised into shared core and page scripts.
- `website/src/schemas/`: Shared frontend validation schemas.
- `website/static/build/`: Generated frontend assets; do not edit these directly.

## Efficient investigation

- Start with the files explicitly mentioned in the request.
- Search for specific symbols, functions or selectors before reading entire files.
- Read only the relevant sections and their direct dependencies.
- Avoid repeatedly inspecting files already examined during the current task.
- Do not explore unrelated directories unless necessary.
- Avoid reading generated bundles, dependency directories or large static data files unless the task specifically requires them.
- If the relevant code is already available, proceed without additional repository-wide exploration.

## Changes

- Make the smallest changes that fully solve the request.
- Preserve existing functionality and project conventions.
- Do not refactor unrelated code.
- Prefer editing existing feature-specific files over adding large amounts of code to shared files.
- Use British English in comments and documentation.
- When explaining changes, identify the exact files and functions involved.

## Verification

- Run targeted checks relevant to the changed files.
- Do not repeatedly run the same checks without a reason.
- Do not run full test suites for trivial CSS or text changes unless requested.
- Report what was tested and what was not.

## Responses

- Be concise.
- Summarise changes and verification results.
- Avoid repeating long code excerpts that already exist in project files.
- Do not produce lengthy implementation plans for small, straightforward tasks.
