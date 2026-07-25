# Increader Browser Extension

The public Chrome and Firefox Browser Capture extension for
[Increader](https://app.increader.com). One TypeScript/WebExtensions source tree
produces Manifest V3 builds for both browsers.

Browser Capture is an explicit import workflow. Opening the compact utility does
not read or send the active page. After the complete pairing and capture slices
land, pressing Import will snapshot the authorized top-level live DOM and
selected images, send one bounded Capture Package only to the paired Increader
instance, and enter Increader's normal Bookmark Import Flow.

The current implementation includes destination discovery and explicit
Browser Capture Pairing. It deliberately does not yet inspect or capture page
content.

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

Useful individual commands:

- `npm test` — behavior tests at the Pairing, protocol, popup, and manifest
  seams.
- `npm run build:dev` — unminified Chrome and Firefox directories with source
  maps under `dist/development/`.
- `npm run build` — isolated production directories and deterministic upload
  ZIPs under `dist/production/`.
- `npm run protocol:check` — verify mirror provenance and generated TypeScript.
- `npm run inspect` — reject unexpected archive files or manifest drift.
- `npm run web-ext:lint` — validate the exact Firefox production package.

Load `dist/development/chrome/` as an unpacked Chrome extension or
`dist/development/firefox/manifest.json` as a temporary Firefox add-on. Neither
development build requires an Increader source checkout.

## Destination discovery

The utility defaults to `https://app.increader.com`. Self-hosted configuration
is under Connection settings. Network-accessible instances must use an exact
HTTPS origin. HTTP is accepted only for loopback development (`localhost`,
`127.0.0.1`, or `[::1]`). Credentials, paths, queries, and fragments are
rejected.

The extension asks for one optional runtime host grant for the exact candidate
origin, reads only `/api/browser-capture/discovery`, and removes failed or
replaced grants. It has no persistent publisher/CDN host access.

## Pairing

Connect opens the selected instance's Account Identity approval page through
the browser identity API. The page shows the exact destination, signed-in
account, installation, and capture-only authority. The extension generates
state and an S256 PKCE challenge, exchanges the returned single-use code
without sending web cookies, and stores only the rotating renewal credential
in `storage.local`. The ten-minute access token remains in extension memory.

Renewal occurs only when a Browser Capture operation needs an access token.
Each success replaces the prior renewal credential and extends its 90-day
inactivity lifetime. Browser restart and extension update preserve the
installation UUID and pairing; browser sync never receives either. Disconnect
revokes the server pairing, clears local credentials, and removes the instance
host grant. Pairing another destination replaces the existing pairing.

## Protocol and architecture

Increader owns the canonical additive, unversioned OpenAPI contract. This
repository checks in a public mirror, source provenance, generated wire types,
and compatible/incompatible fixtures under [`protocol/`](protocol/README.md).
No build fetches the other repository or a moving schema.

The deep Pairing interface owns destination discovery and credential
lifecycle. The deep Capture Job interface will own active-tab inspection,
capture, local staging, transfer, retry, and discard. The popup depends on those
interfaces rather than browser internals. Increader remains the sole owner of
Article Extraction and normal Bookmark behavior.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md),
[privacy](docs/privacy.md), and the [permission rationale](docs/permissions.md).

## License

MIT. See [LICENSE](LICENSE).
