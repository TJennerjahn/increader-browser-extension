# Permission Rationale

The production Chrome and Firefox manifests request the same narrow authority.

## Required permissions

- `activeTab` — temporary authority for the top-level page only after the User
  invokes Browser Capture.
- `scripting` — inject the bounded capture code into that authorized tab.
- `storage` — retain local Pairing metadata and small Capture Job state. Secret
  or captured content is never synchronized.
- `identity` — return from the explicit Increader PKCE approval flow using the
  stable packaged extension identity.
- `notifications` — show one action-required import failure notification.

The discovery-only shell does not yet exercise activeTab, scripting, identity,
or notifications, but they are fixed production permissions required by the
complete Browser Capture v1 workflow and are asserted in both packaged
manifests.

## Optional host access

Broad URL patterns appear only in `optional_host_permissions`, enabling the
browser to grant one exact Increader destination origin at runtime. The
extension stores and uses only that normalized origin, removes a failed trial
grant, and removes the previous grant when the destination is replaced or
disconnected.

There is no persistent `<all_urls>` permission and no permission for every
publisher or image CDN. Page-context acquisition uses temporary active-tab
authority; unavailable cross-origin images remain unavailable for normal
Increader handling.

## Permissions not requested

Browser Capture does not request `tabs`, `cookies`, `history`, `webRequest`,
`unlimitedStorage`, native messaging, downloads, clipboard access, or access to
incognito/private browsing.

Firefox additionally declares `websiteContent`, `browsingActivity`, and
`authenticationInfo` data categories because capture can include signed-in page
content after explicit Import and pairing maintains limited authorization
information. Chrome's store privacy disclosure and
[`privacy.md`](privacy.md) state the equivalent behavior.
