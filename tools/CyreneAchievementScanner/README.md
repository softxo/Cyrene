# Cyrene Achievement Scanner

This Windows application provides a graphical workflow around an embedded,
unmodified copy of YaeAchievement. It does not modify Yae's injection
implementation. End users launch only `CyreneAchievementScanner.exe`.

## Requirements

- Windows x64
- .NET 9 SDK to build the launcher

## Build

Run `build.ps1`. It downloads the latest official Yae release directly from
GitHub, embeds it as a resource, and publishes one self-contained executable to
`dist/CyreneAchievementScanner.exe`.

The build also creates `dist/CyreneAchievementScanner-win-x64.zip`. Upload this
ZIP as the normal GitHub Release package. It contains the portable executable,
Yae's GPL licence, the third-party notice, and the exact corresponding-source
information. Upload the generated `Yae-<version>-source.zip` alongside it to
provide the corresponding GPL source. The executable can be run from any
writable folder and requests administrator privileges through its Windows
manifest.

At runtime the launcher extracts Yae into a fresh temporary directory and runs
it with its UIAF export target.
This prevents Yae's cached-data console question from appearing and leaves its
game injection and packet parsing unchanged. The resulting JSON can be imported
from Cyrene's Achievements page.

YaeAchievement is a separate GPL-3.0-only program. Distributing it alongside
this launcher requires retaining its licence and corresponding-source notices.
