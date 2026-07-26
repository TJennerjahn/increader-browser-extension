# Store listing

## Name

Increader

## Summary

Sign in and send the page you choose to Increader for focused reading.

## Description

Increader is a compact, user-triggered browser extension for saving the
currently open HTML page for reading in Increader.

Sign in to Increader Cloud with Google or email and password. Use the cog to
select one self-hosted Increader instance and sign in with its normal
credentials.
Open the utility to check whether the exact current URL is already in your
library. Choose Import to capture the rendered top-level page and selected
images, then continue in Increader's normal Reader Mode.

Nothing is captured merely because a page is open. Browser Capture has no
analytics, telemetry, advertising, background browsing, or publisher-wide host
permission. Captured content goes only to the selected Increader instance.

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
screenshot contains the actual 0.1.0 production popup rendered by Chrome for
Testing 150 in its disconnected state; the surrounding explanatory canvas and
the 440 × 280 promotional image contain only release artwork. A clean release
build emits:

- `listing/screenshot-1280x800.png`
- `listing/chrome-promo-440x280.png`
- 16, 32, 48, and 128 pixel runtime icons

Neither asset contains User or publisher content.
