# ArthasMod

ArthasMod is a browser extension that customizes the ISY web UI with a dark, modern theme and quality-of-life tweaks.

## What it does

- Applies a custom "ArthasMod" visual theme (colors, typography, cards, menus).
- Adds a third theme option in the profile settings alongside base light/dark modes.
- Improves timetable visuals (lesson colors, readability, sizing/spacing tweaks).
- Adds UI fixes for specific pages (e.g., absences/table alignment, sidebars, overlays).
- Injects small behavior enhancements via content scripts.

## Main files

- `manifest.json` – extension config and permissions.
- `content.js` – DOM behavior, UI patching, theme mode logic.
- `styles.css` – theme styling and component overrides.
- `background.js` – background extension logic.
- `main-world-cache.js` – additional in-page cache/runtime helper logic.

## Usage

1. Load the extension as an unpacked extension in your browser.
2. Open ISY.
3. In profile settings, select **ArthasMod** to enable the custom theme.

