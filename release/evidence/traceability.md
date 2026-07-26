# Browser Capture traceability

| Acceptance criterion | Evidence |
| --- | --- |
| Normal Cloud and self-hosted authentication | `src/auth/`; `src/browser/auth-*.test.ts`; popup tests |
| Exact Bookmark Lookup and multipart import | protocol HTTP tests; canonical OpenAPI mirror |
| User-authorized live page capture | active-page, capture-package, and Capture Job tests |
| Chrome and Firefox packages | `scripts/build.mjs`; manifest tests; `npm run build:reproducible` |
| Runtime archive and permission policy | `scripts/inspect-build.mjs`; `docs/permissions.md` |
| API mirror provenance and generated types | `npm run protocol:check` |
| Privacy, listing, reviewer, and support material | `docs/`; `release/`; `SECURITY.md`; `SUPPORT.md` |
