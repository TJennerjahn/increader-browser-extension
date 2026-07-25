# Permission Rationale

The production Chrome and Firefox manifests request the same narrow authority.

## Required permissions

- `activeTab` — temporary authority for the top-level page only after the User
  invokes the Browser Capture utility.
- `scripting` — inject bounded top-frame inspection code that returns only
  title, URL, and document type before Import; Capture code uses the same
  explicit active-tab authority.
- `storage` — retain local Pairing metadata and small Capture Job state. Secret
  or captured content is never synchronized.
- `identity` — open and return from the explicit Increader PKCE approval flow
  using the stable packaged extension identity. The returned code is
  single-use; Account Identity cookies remain in the instance-hosted page.
- `notifications` — show one action-required import failure notification.

Pairing exercises `storage` and `identity`. Active-page inspection exercises
`activeTab` and `scripting`; import failures exercise `notifications`.
They are fixed production permissions asserted in both packaged manifests.

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
