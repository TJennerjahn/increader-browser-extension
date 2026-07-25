# Reviewer walkthrough

Version 0.1.0 has one purpose: send a page selected by the User to one paired
Increader instance.

## Reproduce the package

```sh
npm ci
npx puppeteer browsers install chrome
npx puppeteer browsers install firefox@stable
npm run release:verify
```

The Firefox reviewer-source ZIP contains these instructions, the lockfile, all
source, tests, manifests, protocol fixtures, SBOMs, notices, and provenance. It
does not contain `node_modules` or generated runtime code.

## Review behavior without an account

1. Load the exact Chrome unpacked output or Firefox upload ZIP using the
   commands in [distribution.md](distribution.md).
2. Open the Browser Capture action. The disconnected state renders without
   reading the active page.
3. Expand Connection settings. Invalid paths, credentials, queries, fragments,
   public HTTP origins, and non-loopback origins are rejected.
4. Pair against an Increader test instance. The instance-hosted approval page
   names the destination, account, installation, and capture-only authority.
5. Open a synthetic HTML page. Opening the utility performs only top-frame
   inspection and exact Bookmark Lookup.
6. Choose Import. Progress appears while the page and bounded images are
   captured. Created and existing Bookmark outcomes can open Reader Mode.
7. Interrupt a transfer. The same Capture ID and staged bytes remain available
   for explicit Retry; there is no automatic retry.
8. Disconnect. The server pairing, local credential, destination, and runtime
   host grant are removed.

The checked-in real-browser suite automates this core matrix for Chrome,
Firefox 140.0 ESR, and current Firefox with Cloud and self-hosted Increader. It
also loads or temporarily installs the exact upload artifacts and upgrades
actual previous-candidate browser profiles.

## Permissions

No review-only permission exists. Required and optional permissions are fixed
and mechanically compared in `release-metadata/manifest-permissions.json`.
There are no content scripts, broad persistent publisher access, remote code,
telemetry, or incognito access.
