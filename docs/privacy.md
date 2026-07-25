# Browser Capture Privacy

Browser Capture is user-triggered. While signed out, opening its popup does not
inspect the active page. Once signed in, the popup reads the active top-level
page's title, fragment-free HTTP(S) URL, and document type. It sends only that
URL to the selected Increader instance for an exact owned Bookmark Lookup. It
does not serialize the DOM, read assets, allocate a Capture ID, or transfer page
content before Import.

Pressing Import reads the current top-level page's URL, rendered text/HTML,
bounded metadata, and selected image bytes. That can include material visible
because the User is signed in to the page. The extension sends it only to the
selected Increader instance so Increader can create or find the User's Bookmark
and normal Reader Content.

The configured origin and account email/display name stay in local,
non-synchronized extension storage. For cloud accounts, Clerk's normal client
authorization and session identifier are stored there so the extension can
request short-lived access tokens; issued access tokens are not stored.
Passwords are sent directly to the normal Increader Cloud or self-hosted
authentication endpoint and are never stored. The normal HttpOnly self-hosted
session cookie remains in the browser cookie store. A staged Capture Package
stays in extension-origin IndexedDB only while needed for transfer or explicit
Retry and is deleted after confirmed success or Discard.

The extension does not collect browsing history, background browsing activity,
publisher credentials, advertising identifiers, analytics, or telemetry. It
performs no inspection or transfer merely because a tab is opened and contains
no third-party analytics or remote executable code.

Increader Cloud processes a capture under its service privacy terms.
Self-hosted captures go directly to the deployment selected by the User; that
operator controls its storage and retention.
