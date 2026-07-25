# Contributing

Thanks for helping improve Increader Browser Capture.

## Before opening a change

1. Open or reference a focused GitHub issue for behavior or protocol changes.
2. Keep Browser Capture terminology aligned with Increader's canonical domain
   glossary.
3. Do not add publisher-specific behavior, telemetry, remote code, broad
   persistent host access, or Article Extraction to this repository.

## Development loop

Install from the lockfile and run the complete isolated gate:

```sh
npm ci
npm run verify
```

Behavior changes should proceed one observable red-green slice at a time. Tests
cross the public Authentication, Capture Job, popup, browser-package, and protocol
seams. Browser APIs, local storage, and HTTP are system boundaries; internal
function call order is not a contract.

Generated protocol types must be regenerated with
`npm run protocol:generate`. Update the OpenAPI mirror, fixtures,
`PROVENANCE.json`, and generated TypeScript together from one committed
Increader source revision.

## Pull requests

Describe user-visible behavior, permission/privacy impact, tests run, and
Chrome/Firefox package impact. Never commit credentials, signing keys, captured
page content, paid-site material, or browser-profile data.
