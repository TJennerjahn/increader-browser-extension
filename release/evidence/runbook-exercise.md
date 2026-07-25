# Non-secret runbook exercise

Exercised on 2026-07-25 from the release branch:

- Chrome for Testing 150 loaded files extracted from
  `increader-browser-extension-0.1.0-chrome-upload.zip`, initialized the
  background runtime, triggered the action, and rendered `Browser Capture`.
- Firefox 152 temporarily installed files extracted from
  `increader-browser-extension-0.1.0-firefox-upload.zip`, reported the stable
  `browser-capture@increader.com` ID, exposed the add-on actor, and completed a
  production-runtime reload.
- Firefox 140.0 ESR loaded that same exact upload package and completed the
  Cloud Pairing, Lookup, create, existing, Open, revoke, and host-grant removal
  workflow.
- Chrome 150 and Firefox 152 upgraded real previous-candidate profiles from
  0.0.9 to the exact 0.1.0 package under stable extension IDs without changing
  installation identity, Pairing renewal material, Capture ID, staged HTML,
  selected-image bytes, or explicit Retry state.
- `web-ext lint` reported zero errors, zero notices, and one narrowly
  allowlisted tooling false positive:
  `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`. The gate also asserted that
  `gecko_android` is absent, which is Mozilla's desktop-only availability
  signal; all other warnings fail the release.
- Two production builds produced identical checksum manifests.
- Both package archives were below 30 KiB and passed exact-entry, permission,
  remote-code, secret/key, source-map, and test-file inspection.
- The Firefox reviewer-source ZIP reproduced the upload artifact from the
  lockfile and contained both SBOM formats, notices, permission report, and
  commit provenance.
- `web-ext sign --help` from pinned web-ext 10.5.0 confirmed the exact
  `--channel=unlisted`, source, artifact, reviewer-source, and API credential
  boundary used by `npm run signing:check`.

The Chrome Web Store and AMO account/login, submission, vendor signing, and
signed-artifact download steps were not attempted because they are the explicit
external credential boundary. No secret or private key is required before that
boundary.
