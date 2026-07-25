# Permission Rationale

The production Chrome and Firefox manifests request the same authority.

## Required permissions

- `activeTab` — temporary authority for the top-level page after the User opens
  Browser Capture.
- `scripting` — inspect and capture that top-level page after explicit actions.
- `storage` — retain the chosen origin, account display metadata, Clerk client
  session state for cloud login, and small Capture Job state. It is local and
  not synchronized; passwords and issued access tokens are not stored.
- `cookies` — adopt the normal Increader Cloud client session after Google
  sign-in and read the normal HttpOnly self-hosted `increader_auth` session
  cookie so background API requests can use the resulting account session.
- `notifications` — show one action-required import failure notification.

## Optional host access

Broad URL patterns appear only in `optional_host_permissions`, allowing a
runtime grant for the exact Increader instance selected by the User. Cloud
authentication additionally needs the exact `clerk.increader.com` origin.

There is no persistent `<all_urls>` permission or permission for every publisher
or image CDN. Page acquisition uses temporary active-tab authority.

## Permissions not requested

Browser Capture does not request `tabs`, `identity`, `history`, `webRequest`,
`unlimitedStorage`, native messaging, downloads, clipboard access, or
incognito/private browsing.

Firefox additionally declares `websiteContent`, `browsingActivity`, and
`authenticationInfo` data categories because capture can include signed-in page
content and the extension handles the User's Increader session.
