# VolumeSilencer

VolumeSilencer is a private, local-only browser extension for controlling HTML video and audio volume on the page you are viewing. Its compact black-and-white controller stays over the page until you dismiss it.

## What it does

- Adjusts HTML video and audio volume from 0–100 on the current page.
- Mutes or unmutes the current browser tab, including page audio not exposed through a normal media element.
- Quiets every other tab in the current window while leaving the active tab audible.
- Mutes every tab in the current window and restores the previous mute state afterward.
- Finds media added after page load and applies the selected level automatically.
- Remembers volume by website when enabled.
- Keeps its draggable on-page widget visible for websites where you opened it.
- Works from the toolbar or with `Ctrl+Shift+M` (`Command+Shift+M` on macOS).

## Privacy

VolumeSilencer has no analytics, account, advertising SDK, backend, or remote API. It does not transmit browsing activity, page content, tab titles, media details, or settings.

The extension stores only preferences, saved website volume levels, visible-widget websites, and widget position in local extension storage. Temporary window-mute restoration state uses session storage where the browser supports it.

Read [PRIVACY.md](PRIVACY.md) for the complete policy.

## Permissions

- `storage`: saves local settings and restores temporary mute state.
- `tabs`: reads the active tab and controls browser-level mute state in the current window.
- `http://*/*` and `https://*/*`: finds and controls HTML video/audio elements and renders the optional widget on normal webpages.

VolumeSilencer cannot run on browser-owned pages such as `chrome://`, `edge://`, `about:`, or extension-store pages.

## Local development

```bash
npm install
npm test
npm run build
```

Build output:

- `dist/chrome/` for Chrome, Edge, and Opera
- `dist/firefox/` for Firefox

Create store archives with:

```bash
npm run package:stores
```

## Load unpacked

Chrome, Edge, or Opera:

1. Run `npm run build`.
2. Open the browser's extensions page.
3. Enable developer mode.
4. Choose **Load unpacked** and select `dist/chrome/`.

Firefox:

1. Run `npm run build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on**.
4. Select `dist/firefox/manifest.json`.

## Architecture

- `background.js`: toolbar action, tab mute controls, and current-window mute restoration.
- `content/content-script.js`: media control and isolated Shadow DOM widget.
- `options/`: local preferences.
- `scripts/`: deterministic browser builds and store archives.
- `tests/`: privacy, manifest, and packaging checks.

## License

[MIT](LICENSE). Produced by [Wiplash.ai](https://wiplash.ai/).
