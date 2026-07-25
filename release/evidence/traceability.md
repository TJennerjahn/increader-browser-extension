# Issue #868 traceability

| Acceptance criterion | Evidence |
| --- | --- |
| Chrome/Firefox × Cloud/self-hosted core matrix | `npm run browser:test`; `release/browser/core-matrix.ts` |
| Real-browser synthetic capture/lifecycle suite | `npm run browser:test`; full unit suite in `npm test` |
| Exact packaged smoke loads and stress cases | `scripts/real-browser-suite.mjs`; `scripts/inspect-build.mjs` |
| Previous-candidate upgrade | `release/fixtures/previous-candidate-0.0.9.json`; `upgrade-compatibility.test.ts` |
| Both compatibility directions and protocol regeneration | `protocol/compatibility/`; `compatibility.test.ts`; `npm run protocol:check`; Increader `BrowserCaptureCompatibilityFixtureTest` |
| Deterministic artifact set under one numeric version | `scripts/build.mjs`; `npm run build:reproducible` |
| Runtime archive content and size policy | `scripts/inspect-build.mjs` |
| CI audit, permission, protocol, browser-load gates | `.github/workflows/ci.yml`; `npm run verify` |
| License, privacy, listing, assets, reviewer and support material | `LICENSE`; `SUPPORT.md`; `docs/`; `release/assets/`; release metadata output |
| Chrome, Firefox, and AMO runbooks through non-secret boundary | `docs/distribution.md`; `runbook-exercise.md` |
| No P0/P1, leak, mismatch, drift, quarantine, or untraced criterion | live query recorded in `release-verification.md`; all rows above are blocking gates |
