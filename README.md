<div align="center">

# Cyrene

**A Genshin Impact companion for Discord and the web.**

[Website](https://cyrene-teyvat.xyz/) · [Discord](https://discord.gg/KpkggK4UqB) · [Documentation](https://cyrene-teyvat.xyz/docs) · [Report a bug](https://github.com/softxo/Cyrene/issues) · [Cyrene Scanner](https://github.com/softxo/Cyrene/releases/latest)

[![Python](https://img.shields.io/badge/Python-3.14-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![discord.py](https://img.shields.io/badge/discord.py-5865F2?logo=discord&logoColor=white)](https://discordpy.readthedocs.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Licence: AGPL-3.0](https://img.shields.io/badge/Licence-AGPL--3.0-informational)](LICENSE)

</div>

Cyrene is a Discord bot and website for Genshin Impact. Link
your HoYoLAB account once and Cyrene keeps your characters, weapons,
achievements, wishes and exploration progress in one place, plans the materials
your next upgrades need, and handles the daily chores for you: it checks in on
HoYoLAB, redeems new gift codes and reminds you on Discord when your resin,
expeditions or Serenitea Pot are ready.

The bot and the website share the same accounts and data, so anything you link
or plan in one shows up in the other.

## Features

### Website

| Area             | What it does                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- |
| **Accounts**     | Sign in with Discord, link one or more HoYoLAB accounts and switch between their UIDs.      |
| **Characters**   | Showcase and roster, with an upgrade planner that totals level, talent and ascension costs. |
| **Weapons**      | Weapon collection and a planner for weapon ascension materials.                             |
| **Inventory**    | Your materials, synced from HoYoLAB.                                                        |
| **Achievements** | The full achievement catalogue, with progress saved per UID.                                |
| **Wishes**       | Wish History import with pity counts, averages and banner history.                          |
| **Exploration**  | Exploration progress across regions.                                                        |
| **Events**       | Current events, banners and rewards, plus your own custom events with progress tracking.    |
| **Codes**        | Active redeem codes, redeemed automatically for linked accounts.                            |
| **Reminders**    | Resin, expedition, Serenitea Pot, Parametric Transformer and custom reminders on Discord.   |

### Discord bot

- **Game data:** characters, talents, passives, constellations, weapons,
  artifacts, materials, enemies and banners.
- **Account tools:** link a HoYoLAB account, check resin and expeditions, and
  manage reminders.
- **Resource calculator:** the materials a character or weapon needs between
  any two levels.

### Automation

Background workers run for every linked account without you having to open
anything:

- **Daily check-in:** claims the HoYoLAB daily reward.
- **Gift codes:** finds newly released codes and redeems them.
- **Reminders:** a scheduler sends a direct message when a resource is full or
  a timer finishes.

### Cyrene Scanner

A Windows app that imports achievements, weapons and Wish History into your
Cyrene account, for data HoYoLAB doesn't expose. Download it from
[Releases](https://github.com/softxo/Cyrene/releases/latest).

## Privacy and security

- **Sign-in:** Discord OAuth. Website sessions use random server-side tokens
  rather than signed cookies, so they can be revoked.
- **HoYoLAB cookies:** encrypted at rest with a Fernet key held outside the
  database.
- **Account isolation:** every read and write is checked against the UIDs linked
  to the signed-in Discord user.
- **Wish History URLs:** used only to fetch your history during an import and
  never stored.

Found a security issue? Please report it privately on the
[Discord server](https://discord.gg/KpkggK4UqB), by pinging a Cyrene Staff, rather than in a public issue.

## About this repository

This is the source code behind Cyrene's Discord bot and website, published so
you can see how it works. Cyrene is a hosted service: to use it, open the
[website](https://cyrene-teyvat.xyz/) or add the bot from the
[Discord server](https://discord.gg/KpkggK4UqB).

## Contributing

Bug reports, ideas and pull requests are welcome.

- **Issues:** [open an issue](https://github.com/softxo/Cyrene/issues) with a
  clear description, steps to reproduce and screenshots where they help.
- **Pull requests:** keep each one focused on a single change and explain what
  it fixes or adds. Discuss larger changes in an issue first. Accepted changes
  are carried into the next release. By opening a pull request, you agree that
  your contribution is licensed under the same licence as Cyrene.

> [!IMPORTANT]
> Remove account cookies, Wish History URLs and other personal information
> before sharing logs or screenshots.

## Licence

Copyright © 2026 soft. Cyrene's original source code is licensed under the
[GNU Affero General Public License v3.0](LICENSE). You're free to read, change
and share it, but if you run a modified version as a service for other people,
you must publish your changes under the same licence. Third-party assets and
dependencies remain subject to their own licences and terms.

Genshin Impact and related names, characters and artwork are the property of
HoYoverse. Cyrene is an independent fan project and is not affiliated with or
endorsed by HoYoverse.
