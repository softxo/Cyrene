# Cyrene

### A bot/site for Genshin Impact.

The bot is a bot for Discord, that allows you to check stuff like:

- Character info
- Character materials
- Character constellations
- Character talents
- Character passives
- Weapon info
- Weapon materials
- Calculator for character/weapon materials
- Artifacts info
- Banners
- Resin info
- Expedition info
- Enemy info
- Materials info
- Reminders
- Ward (shields) info
- and way more coming soon

Also some silly stuff like:

- AI
- Music
- and more coming soon (like moderation)

The site allows you to check/do various things by logging in with HoYoLAB.
You can check things like:

- Resin
- Trounce Domains
- Dailies
- Recurring Events (SA, SO, IT)
- Banners
- and a lot more coming soon

You can also have things like:

- Automatic "Daily Check-in" claiming
- Automatic code redemption
- and more coming soon

## *Still a WiP; missing a ton of functionality.

## Development

Install frontend dependencies with `npm ci`. Run `npm run typecheck`,
`npm run lint`, `npm run knip`, and `npm run build` from the repository root.
Run browser tests with `npm run test:e2e`.

Tool configuration lives in `config/`; Prettier, commitlint, lint-staged, and
Knip settings live in `package.json`. The root `tsconfig.json` and `ruff.toml`
allow editors to discover TypeScript and Python settings automatically.
Agent guidance is in [.github/CODEX.md](.github/CODEX.md).

Maintenance scripts live in `scripts/`. To refresh achievement data, run
`python scripts/update_achievements.py` from the repository root.
