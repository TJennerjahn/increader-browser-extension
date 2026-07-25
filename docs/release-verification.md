# Release verification

## Required matrix

| Browser                | Instance    | Core workflow                                         |
| ---------------------- | ----------- | ----------------------------------------------------- |
| Chrome for Testing     | Cloud       | clean Pairing, Lookup, create, existing, Open, revoke |
| Chrome for Testing     | self-hosted | clean Pairing, Lookup, create, existing, Open, revoke |
| Firefox 140.0 ESR      | Cloud       | clean Pairing, Lookup, create, existing, Open, revoke |
| Current stable Firefox | self-hosted | clean Pairing, Lookup, create, existing, Open, revoke |

`npm run browser:test:matrix` executes the complete matrix. Its self-hosted
current-browser pass also exercises 10 MiB across 60 images, a transfer delayed
35 seconds, 49 MiB of captured assets, an explicit one-over-limit outcome, and
a simulated 120-second ambiguous timeout followed by explicit
same-Capture-ID, byte-identical Retry. `npm run browser:test:esr` downloads
Mozilla's official Firefox 140.0 ESR archive and rejects any SHA-256 other than
`275b6a15b61553469d18cf5ec9d3571e2e82c1e661702a83a695f13b94d80543`.

The extension upload artifact is independently smoke-loaded before the browser
matrix: Chrome loads the extracted exact ZIP and renders the popup; Firefox
temporarily installs the extracted exact ZIP through its remote add-on actor and
successfully reloads the production background runtime.

## Compatibility and upgrade

- `release/fixtures/previous-candidate-0.0.9.json` is immutable upgrade input.
  It proves installation UUID, destination, Pairing ID, renewal credential,
  Capture ID, staged HTML/image bytes, and retryability survive the new build.
- `npm run upgrade:test` performs that upgrade in actual Chrome and Firefox
  profiles under the stable production extension IDs, replacing the prior
  candidate with the exact 0.1.0 upload package across a browser restart.
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

There are no test quarantines. A failed required matrix cell, upgrade, audit,
package inspection, protocol check, or either backend variant suite blocks
release. The only lint allowlist is web-ext's Android-minimum warning caused by
Firefox 140 desktop data-consent support predating Firefox 142 Android support.
`npm run web-ext:lint` permits that exact code only while also asserting that
`gecko_android` is absent—the AMO desktop-only availability signal documented
by Mozilla. Every other lint warning remains blocking.
