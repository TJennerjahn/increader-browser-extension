# Increader Browser Extension

The public Chrome and Firefox Browser Capture extension for
[Increader](https://app.increader.com). One TypeScript/WebExtensions source tree
produces Manifest V3 builds for both browsers.

Browser Capture uses an ordinary Increader account. The popup contains the same
email-and-password login used by the normal client, plus Google sign-in for
Increader Cloud. It defaults to Increader Cloud; the cog opens a separate screen
where a self-hosted origin can be selected. Self-hosted credentials are sent to
that instance's normal `/api/auth/login` endpoint.

Once signed in, opening the popup reads the active top-level page's title,
fragment-free HTTP(S) URL, and document type. It sends only that URL for an exact
owned Bookmark Lookup. Pressing Import separately authorizes a snapshot of the
live DOM and selected images. The resulting multipart Capture Package enters
Increader's normal Bookmark Import Flow.

The extension has no separate authorization scheme, approval page, installation
identity, credential renewal protocol, or server-managed extension settings. A
signed-in extension has the same account authority as the normal client.

## Browser support

- Current stable desktop Chrome
- Firefox 140 or newer
- Incognito/private browsing is prohibited

Safari, mobile browsers, browser-internal pages, local files, and opened PDFs
are outside Browser Capture v1.

## Development

Requires Node.js 22 and npm 10.

```sh
npm ci
npm run verify
```

Useful commands:

- `npm test` — behavior tests for authentication, capture, protocol, popup, and
  manifest seams.
- `npm run build:dev` — unminified Chrome and Firefox directories with source
  maps under `dist/development/`.
- `npm run build` — production directories, upload ZIPs, reviewer source,
  SBOMs, checksums, notices, permission report, provenance, and listing assets.
- `npm run protocol:check` — verify the canonical API mirror and generated
  TypeScript.
- `npm run inspect` — reject unexpected archive files or manifest drift.
- `npm run web-ext:lint` — validate the Firefox production package.

Load `dist/production/chrome/` as an unpacked Chrome extension or
`dist/production/firefox/manifest.json` as a temporary Firefox add-on.

## Authentication

The popup defaults to `https://app.increader.com`. Self-hosted instances must
use an exact HTTPS origin; HTTP is accepted only for loopback development.
Credentials, paths, queries, and fragments are rejected.

Cloud access is included in the packaged extension. The popup asks for an
optional host grant only when the User selects a self-hosted instance. Cloud
login uses Clerk's browser Frontend API and the normal Increader Cloud account.
Google sign-in continues in a normal browser tab, then the extension adopts the
resulting Cloud session from `app.increader.com`; it is not offered for
self-hosted instances.
Self-hosted login calls `/api/auth/login`, retains Increader's normal HttpOnly
session cookie, and sends that session token as a normal bearer token from the
extension background process. Sign out uses the account provider's normal
logout operation.

The production Clerk instance must have Native API enabled, the packaged Chrome
origin must be present in Clerk's `allowed_origins`, and the Cloud `/sign-in`
and `/` URLs must be in Clerk's native SSO redirect allowlist. The checked-in
manifest key pins the Chrome origin to
`chrome-extension://haipjkpamjpojalajcgfeggbjhifjpnn`.

The chosen origin and account metadata are stored in `storage.local`. Cloud
login also stores Clerk's normal client authorization and session identifier
there so it can request short-lived access tokens. Passwords and issued access
tokens are never stored.

## Protocol and architecture

Increader owns the canonical OpenAPI contract. This repository checks in an
exact mirror, source provenance, generated wire types, and representative
fixtures under [`protocol/`](protocol/README.md).

The Authentication interface owns the current account and normal access token.
The active-page interface owns minimal top-frame inspection. The
background-owned Capture Job interface owns capture, extension-origin IndexedDB
staging, transfer, explicit same-package Retry, and Discard. Closing the popup
does not cancel an active job. Increader remains the sole owner of Article
Extraction and normal Bookmark behavior.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
[privacy](docs/privacy.md), and the [permission rationale](docs/permissions.md).

## License

MIT. See [LICENSE](LICENSE).
