# Release verification

The release gate covers:

- unit tests for ordinary Cloud/self-hosted authentication, popup behavior,
  page capture, multipart transfer, manifests, and generated API types;
- reproducible Chrome and Firefox production packages;
- exact manifest permission and archive-content inspection;
- Firefox package linting, dependency/license audit, SBOMs, notices, checksums,
  and reviewer-source provenance;
- smoke loading the packaged extension where browser tooling is available.

`npm run verify` runs the static gate. `npm run release:verify` adds the browser
smoke matrix.

There are no test quarantines. A failed required gate blocks release. The only
lint allowlist is web-ext's Android-minimum warning caused by Firefox 140
desktop data-consent support predating Firefox 142 Android support; every other
lint warning remains blocking.
