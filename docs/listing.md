# Store listing

## Name

Increader Browser Capture

## Summary

Send the page you choose to your paired Increader instance for focused reading.

## Description

Increader Browser Capture is a compact, user-triggered utility for saving the
currently open HTML page to Increader.

Connect the extension to Increader Cloud or one self-hosted Increader instance.
Open the utility to check whether the exact current URL is already in your
library. Choose Import to capture the rendered top-level page and selected
images, then continue in Increader's normal Reader Mode.

Nothing is captured merely because a page is open. Browser Capture has no
analytics, telemetry, advertising, background browsing, cookie access, or
publisher-wide host permission. Captured content goes only to the exact
Increader instance you paired.

Chrome and Firefox use the same Browser Capture behavior. Firefox 140 or newer
is required. PDFs, local files, browser-protected pages, private/incognito
windows, mobile browsers, and Safari are not supported in this release.

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
- Authentication information: one installation-specific rotating Browser
  Capture credential is stored locally and never synchronized.
- Website content: read only after explicit Import; sent only to the paired
  Increader instance.
- Browsing activity: the exact active URL is checked while the paired utility
  is open; history is not collected.
- Personal communications, financial information, health information,
  location, web history, analytics, and advertising data: not collected.
- Data sale or unrelated use: none.

The complete policy is [privacy.md](privacy.md), with permission-by-permission
justification in [permissions.md](permissions.md).

## Assets

Checked-in masters are under `release/assets/`. The 1280 × 800 listing
screenshot contains the actual 0.1.0 production popup rendered by Chrome for
Testing 150 in its disconnected state; the surrounding explanatory canvas and
the 440 × 280 promotional image contain only release artwork. A clean release
build emits:

- `listing/screenshot-1280x800.png`
- `listing/chrome-promo-440x280.png`
- 16, 32, 48, and 128 pixel runtime icons

Neither asset contains User or publisher content.
