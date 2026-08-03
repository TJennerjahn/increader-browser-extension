# Permission Rationale

The production Chrome and Firefox manifests request the same core authority.
Firefox additionally receives access to its single Mozilla-owned OAuth
callback origin so it can finish and close the Google authentication popup.

## Required permissions

- `activeTab` — temporary authority for the top-level page after the User opens
  Browser Capture.
- `scripting` — inspect and capture that top-level page after explicit actions.
- `storage` — retain the chosen origin, account display metadata, Clerk client
  session state for cloud login, and small Capture Job state. It is local and
  not synchronized; passwords and issued access tokens are not persisted.
- `cookies` — read the normal HttpOnly self-hosted `increader_auth` session
  cookie so background API requests can use the resulting account session.
- `identity` — generate the stable browser-specific callback and, in Chrome,
  run Google's managed authentication window. Firefox uses the callback with a
  dedicated popup because its managed flow rejects Clerk's intermediate OAuth
  callback.
- `notifications` — show one action-required import failure notification.
- `declarativeNetRequestWithHostAccess` — remove the browser-supplied `Origin`
  header from Clerk native-client requests made by the extension background
  process. The session rule is limited to `clerk.increader.com`, fetch/XHR, and
  requests not associated with a tab. This avoids sending Clerk both its
  mutually exclusive native `Authorization` and browser `Origin` headers.

## Required host access

- `https://app.increader.com/*` — default Increader Cloud API and Reader Mode.
- `https://clerk.increader.com/*` — Increader Cloud authentication and session
  refresh.
- `https://67a4223028cae940bb8b49e4730746728ae11c28.extensions.allizom.org/*`
  (Firefox only) — observe the fixed Mozilla-owned OAuth callback in the
  dedicated Google authentication popup so it can be closed and returned to
  the Extension. No response body is read from this domain.

## Optional host access

Broad URL patterns appear only in `optional_host_permissions`, allowing a
runtime grant for the exact self-hosted Increader instance selected by the
User.

There is no persistent `<all_urls>` permission or permission for every publisher
or image CDN. Page acquisition uses temporary active-tab authority.

## Permissions not requested

Browser Capture does not request `tabs`, `history`, `webRequest`,
`webRequestBlocking`, `unlimitedStorage`, native messaging, downloads,
clipboard access, or incognito/private browsing.

Firefox additionally declares `websiteContent`, `browsingActivity`, and
`authenticationInfo` data categories because capture can include signed-in page
content and the extension handles the User's Increader session.
