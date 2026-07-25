# Browser Capture Privacy

Browser Capture is user-triggered. Before Pairing, opening its popup does not
inspect the active page. After Pairing, the popup reads the active top-level
page's title, fragment-free HTTP(S) URL, and document type. It sends only that
URL, in a minimal authenticated request body, to the paired Increader instance
for an exact owned Bookmark Lookup. It does not serialize the DOM, read assets,
allocate a Capture ID, or transfer page content before Import. Destination
discovery sends one credential-free request to the exact Increader origin the
User selects.

When the complete capture workflow is enabled, pressing Import will read the
current top-level page's URL, rendered text/HTML, bounded metadata, and selected
image bytes. That can include material visible because the User is signed in to
the page. The extension sends it only to the one paired Increader instance so
Increader can create or find the User's Bookmark and normal Reader Content.

The installation UUID, rotating Browser Capture Renewal Credential, pairing
metadata, and configured instance origin stay in extension-local,
non-synchronized storage. Ten-minute Browser Capture Access Tokens stay only
in extension memory. The extension never stores the Increader web session,
password, or approval-page cookies. A staged Capture Package stays in
extension-origin IndexedDB only while needed for transfer or explicit Retry and
is deleted after confirmed success or Discard. Page content, credentials, and
pairing data are never put in browser sync storage.

The extension does not collect browsing history, background browsing activity,
cookies, passwords, publisher credentials, advertising identifiers, analytics,
or telemetry. It performs no inspection or transfer merely because a tab is
opened; inspection and exact-URL lookup occur only while the paired utility is
invoked. It contains no third-party analytics or remote executable code.

Increader Cloud processes a capture under its service privacy terms.
Self-hosted captures go directly to the deployment selected by the User; that
operator controls its storage and retention.
