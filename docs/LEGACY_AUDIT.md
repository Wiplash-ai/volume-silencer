# Legacy VolumeSilencer Audit

The historical `LoudNinja`/`volumo` repository was used only to identify existing product behavior. This repository was created independently with a new Git history and a Manifest V3 architecture.

## Behavior retained

- Current-page HTML video and audio volume control
- Current-tab mute and unmute
- Apply a quieter state across tabs in the current window
- Mute all tabs in the current window
- Mute all tabs except the current tab
- Restore/reset controls
- Chrome, Edge, Opera, and Firefox packaging

## Behavior redesigned

- Replaced the temporary browser popup with a draggable on-page widget
- Replaced the secondary "stealth level" multiplier with one direct 0–100 volume scale
- Uses browser-level tab muting for reliable current-tab and window muting
- Preserves each tab's prior mute state before restoring a window
- Detects media elements added after initial page load
- Uses one shared source tree with deterministic browser-specific builds
- Uses Manifest V3 and current Firefox no-data declarations
- Uses a closed Shadow DOM so the host webpage cannot reach the widget controls

## Removed

- Mixpanel SDKs and tracking calls
- Collection of page title, hostname, incognito state, tab width, media timing, media dimensions, playback state, and interaction events
- Remote analytics configuration and tokens
- Browser-specific copies of the same application logic
- Legacy branding and purple visual treatment
- Manifest V2 packaging

## Stored data in the new release

- User preferences
- Optional website hostname-to-volume mappings
- Website hostnames where the widget should remain visible
- Widget position
- Temporary current-window mute restoration state

All stored data stays inside browser extension storage. No runtime source contains a network client or analytics SDK.
