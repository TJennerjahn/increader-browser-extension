# Increader Browser Extension Privacy Policy

Effective date: July 26, 2026

This policy explains what data the Increader browser extension ("the
Extension") handles, what it sends from your browser, and how that data is
used.

## Data the Extension handles and transmits

### Authentication information

You must sign in before using the Extension. Your email address and password
are sent directly to the normal authentication service for Increader Cloud or
the self-hosted Increader instance you selected. The Extension never stores
your password.

If you choose Google sign-in for Increader Cloud, authentication takes place in
a normal Increader Cloud browser tab using Google and Increader Cloud's
authentication provider, Clerk. The Extension then reads the resulting Clerk
client session so it can act as your signed-in Increader account.

The selected instance URL and your account email address or display name are
stored in local, non-synchronized extension storage. For cloud accounts, the
Clerk client authorization and session identifier are also stored there so the
Extension can request short-lived access tokens. Issued access tokens are not
persisted and may be held only in background memory until shortly before they
expire. A self-hosted account's normal HttpOnly session cookie remains in the
browser's cookie store.

This information is used only to authenticate you, keep you signed in, and
authorize the Bookmark lookup and Import actions you request.

### Current page URL

While signed out, opening the Extension does not inspect the current page.
Once you are signed in, opening the Extension reads the active top-level page's
title, fragment-free HTTP(S) URL, and document type. It sends only the
fragment-free URL to the selected Increader instance to check whether that
exact URL is already saved in your account.

The Extension does not collect your browsing history or inspect pages in the
background.

### Website content

The Extension captures website content only after you choose Import. It reads
and sends the current top-level page's:

- fragment-free URL, base URL, and available canonical URL;
- title, language, rendered HTML, and text; and
- selected image files and related image URLs.

This data can include content visible because you are signed in to the website
you are importing. It is sent only to the Increader Cloud account or
self-hosted Increader instance you selected, where it is used to create or find
your Bookmark and prepare the page for Increader's Reader Mode.

The Extension does not capture a page merely because you visit or open it.

## Local storage and retention

The Extension stores its settings and account session metadata locally in your
browser. This storage is not synchronized between browsers.

During an Import, a Capture Package containing the page data described above
may be staged temporarily in extension-local IndexedDB. It remains there only
while needed to complete the transfer or allow an explicit Retry. The
Extension deletes it after a confirmed successful transfer or when you choose
Discard.

After transfer, the selected Increader instance controls the storage and
retention of the imported Bookmark and Reader Content. Increader Cloud handles
that data under the [Increader Cloud Privacy
Policy](https://www.increader.com/privacy). If you select a self-hosted
instance, its operator controls that instance and its data-retention practices.

## Data the Extension does not collect

The Extension does not collect or transmit:

- general browsing history or background browsing activity;
- analytics, telemetry, crash reports, or usage measurements;
- advertising identifiers or data for targeted advertising;
- location, financial, or health information; or
- data from private browsing, which the Extension does not support.

The Extension contains no third-party analytics and no remotely executed code.
It does not sell personal information or share captured page content with
advertisers or data brokers.

## Data recipients and network security

Page URLs and imported website content are sent only to the Increader Cloud
service or self-hosted instance you selected. Authentication information is
also handled by the applicable authentication service; Google and Clerk are
used only when you choose Increader Cloud authentication.

Remote Increader instances must use HTTPS. Unencrypted HTTP is accepted only
for loopback addresses during local development.

## Your choices

You decide which Increader instance to use and whether to press Import. You can
sign out to clear the Extension's locally stored account metadata and can
Discard a staged Capture Package after a failed transfer. Imported content is
managed through the selected Increader instance.

## Changes to this policy

This policy may be updated when the Extension's behavior changes. Material
changes will be reflected by updating the effective date above.

## Contact

Questions about this policy can be sent to
[support@increader.com](mailto:support@increader.com).
