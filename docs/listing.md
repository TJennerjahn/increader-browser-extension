# Store listing

## Name

Increader

## Summary

Stop scrolling. Start reading. Send the current page to Increader Cloud or your
self-hosted instance and continue in a focused, distraction-free reader.

## Description

Stop scrolling. Start reading. Increader sends the page you choose to your
reading queue, where you can read without distractions and keep moving through
what matters.

Use Increader Cloud or connect a self-hosted instance. The page URL, rendered
content, and selected images are sent only when you choose Import. No analytics,
advertising, telemetry, or background browsing.

## Notes for reviewers

Build: `npm ci && npm run verify` (AMO default Ubuntu/Node 24). Output:
`dist/production/increader-browser-extension-0.1.2-firefox-upload.zip`. Public
npm dependencies are pinned in `package-lock.json`; no third-party runtime
libraries, obfuscation, or remote code.

## Category and language

- Category: Productivity
- Primary language: English

## Public URLs

- Homepage:
  `https://github.com/TJennerjahn/increader-browser-extension`
- Support:
  `https://github.com/TJennerjahn/Increader/issues`
- Privacy policy:
  `https://github.com/TJennerjahn/increader-browser-extension/blob/main/docs/privacy.md`

## Privacy and data-use answers

- Single purpose: user-authorized capture to Increader.
- Authentication information: normal Increader account sessions are used.
  Passwords and issued access tokens are not persisted; a live access token may
  be reused briefly from background memory. Clerk's client authorization and
  session identifier stay in local extension storage.
- Website content: read only after explicit Import; sent only to the selected
  Increader instance.
- Browsing activity: the exact active URL is checked while the signed-in utility
  is open; history is not collected.
- Personal communications, financial information, health information,
  location, web history, analytics, and advertising data: not collected.
- Data sale or unrelated use: none.

The complete policy is [privacy.md](privacy.md), with permission-by-permission
justification in [permissions.md](permissions.md).

## Assets

Checked-in masters are under `release/assets/`. The 1280 × 800 listing
screenshot and 440 × 280 promotional image are image-generated marketing
artwork based on the Increader identity and Browser Capture workflow. A clean
release build copies these raster masters without programmatically composing
new artwork and emits:

- `listing/screenshot-1280x800.png`
- `listing/chrome-promo-440x280.png`
- 16, 32, 48, and 128 pixel runtime icons

The interface shown is illustrative. Neither asset contains User or publisher
content.
