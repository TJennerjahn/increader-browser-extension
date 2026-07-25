# Release verification

## Required matrix

| Browser | Instance | Core workflow |
| --- | --- | --- |
| Chrome for Testing | Cloud | clean Pairing, Lookup, create, existing, Open, revoke |
| Chrome for Testing | self-hosted | clean Pairing, Lookup, create, existing, Open, revoke |
| Firefox 140+ | Cloud | clean Pairing, Lookup, create, existing, Open, revoke |
| Firefox 140+ | self-hosted | clean Pairing, Lookup, create, existing, Open, revoke |

`npm run browser:test` executes the matrix in real Chrome and Firefox engines.
The same run exercises 10 MiB across 60 images, a transfer delayed 35 seconds,
49 MiB of captured assets, an explicit one-over-limit outcome, and a simulated
120-second ambiguous timeout followed by explicit same-Capture-ID Retry.

The extension upload artifact is independently smoke-loaded before the browser
matrix: Chrome loads the extracted exact ZIP and renders the popup; Firefox
temporarily installs the extracted exact ZIP through its remote add-on actor and
successfully reloads the production background runtime.

## Compatibility and upgrade

- `release/fixtures/previous-candidate-0.0.9.json` is immutable upgrade input.
  It proves installation UUID, destination, Pairing ID, renewal credential,
  Capture ID, staged HTML/image bytes, and retryability survive the new build.
- `protocol/compatibility/oldest-supported-server.json` is consumed by the new
  extension in both browser adapters.
- `protocol/compatibility/still-distributed-extension-0.1.0.json` is mirrored
  in Increader and consumed by the current server package parser in both build
  variants.
- `npm run protocol:check` verifies canonical OpenAPI mirror provenance,
  generated TypeScript, and fixtures regenerate without diff.

## Evidence and defect gate

Issue #868 is the trace root. `release/evidence/traceability.md` maps every
acceptance criterion to an automated gate or reviewed artifact. On 2026-07-25,
the GitHub query for open P0/P1 Browser Capture issues returned an empty list in
both repositories. The query must be repeated immediately before publication:

```sh
gh issue list --repo TJennerjahn/Increader --state open \
  --json number,title,labels,url
gh issue list --repo TJennerjahn/increader-browser-extension --state open \
  --json number,title,labels,url
```

There are no test quarantines. A failed required matrix cell, audit, package
inspection, protocol check, or default backend variant suite blocks release.
