# ArthasMod - Default Style Branch

ArthasMod is a browser extension that keeps the default ISY look while retaining backend optimizations and UI bugfixes.

## What it does

- Adds timetable/API caching for faster week switching and reduced reload cost.
- Keeps bugfixes like absence table alignment improvements.
- Preserves behavior fixes from content scripts without applying a custom theme.

## Main files

- `manifest.json` – extension config and permissions.
- `content.js` – DOM behavior plus timetable/cache bugfix integration.
- `background.js` – background extension logic.
- `main-world-cache.js` – additional in-page cache/runtime helper logic.

## Usage

1. Load the extension as an unpacked extension in your browser.
2. Open ISY.
3. Use ISY as normal; no extra theme mode is injected.

