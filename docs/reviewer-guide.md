# Reviewer walkthrough

Version 0.1.1 has one purpose: send a page selected by the User to the Increader
account they signed into.

## Reproduce the package

```sh
npm ci
npm run release:verify
```

The Firefox reviewer-source ZIP contains the lockfile, source, tests, manifests,
API fixtures, SBOMs, notices, and provenance. It does not contain
`node_modules` or generated runtime code.

## Review behavior

1. Load the exact Chrome unpacked output or Firefox upload ZIP using
   [distribution.md](distribution.md).
2. Open Browser Capture. It renders signed out without inspecting the page.
3. Enter an email and password for Increader Cloud, or choose Continue with
   Google and finish Cloud login in the dedicated authentication window, which
   closes when the callback returns to the Extension. The signed-in Extension
   popup then reopens automatically. Chrome uses its managed Web Auth Flow;
   Firefox uses a popup scoped to the single Mozilla callback origin because
   its managed flow rejects Clerk's intermediate callback. The cog opens the
   separate instance screen for selecting a self-hosted origin and using that
   instance's normal credentials; Google is then hidden.
4. Open a synthetic HTML page. Opening the signed-in utility performs only
   top-frame inspection and exact Bookmark Lookup.
5. Choose Import. Progress appears while the page and bounded images are
   captured. Created and existing Bookmark outcomes can open Reader Mode.
6. Sign out. The normal account session ends and local account metadata clears.

Cloud authentication requires Clerk Native API, the stable packaged Chrome
origin, and the native SSO redirect URLs documented in the README to be enabled
on the production Clerk instance.

## Permissions

No review-only permission exists. Required and optional permissions are fixed
and mechanically compared in `release-metadata/manifest-permissions.json`.
There are no content scripts, persistent publisher access, remote code,
telemetry, or incognito access.
