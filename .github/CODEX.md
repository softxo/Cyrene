# Cyrene — Agent Instructions

## Project

Cyrene is a Genshin Impact Discord bot and companion website.

- Backend: Python 3.14, FastAPI, discord.py, PostgreSQL.
- Frontend: TypeScript, Vite, Jinja2, CSS.
- Development: VS Code, Windows, PowerShell.
- Git: develop on `dev`; `main` is protected.

## Workflow

- Inspect relevant code before making changes.
- Search narrowly by filename, symbol, or directory before expanding scope.
- Reuse existing functions, utilities, components, and patterns.
- Make the smallest complete change that solves the underlying problem.
- Preserve existing behaviour unless explicitly requested otherwise.
- Avoid unrelated refactoring, formatting, and dependency changes.
- Do not modify generated files manually; identify and edit their sources.
- Avoid reading entire directories or large files when targeted inspection is sufficient.
- Do not install packages or modify Git history without approval.

## Code Quality

- Follow existing naming, formatting, and architectural conventions.
- Use British English for comments, documentation, and user-facing text unless an API requires otherwise.
- Prefer clear, maintainable solutions over unnecessary abstractions.
- Use TypeScript types and avoid `any` unless justified.
- Handle errors explicitly; do not silently suppress failures.
- Respect account-specific data isolation and authentication boundaries.
- Preserve existing UI patterns, themes, and responsive behaviour.

## Verification

- Run targeted checks for affected code.
- For frontend changes, use existing type-checking, linting, tests, and build scripts as applicable.
- For Python changes, run relevant tests or syntax checks.
- Investigate failures introduced by changes; identify unrelated existing failures.
- Do not claim checks passed unless they were executed successfully.

## Responses

- Keep responses concise and technical.
- Summarise changes rather than reproducing entire files.
- Reference modified file paths.
- Report relevant test results, failures, and remaining risks.
- Avoid lengthy explanations unless requested.
