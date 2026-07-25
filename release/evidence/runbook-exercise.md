# Non-secret runbook exercise

Exercised on 2026-07-25 from the release branch:

- Chrome for Testing 150 loaded files extracted from
  `increader-browser-extension-0.1.0-chrome-upload.zip`, initialized the
  background runtime, triggered the action, and rendered `Browser Capture`.
- Firefox 152 temporarily installed files extracted from
  `increader-browser-extension-0.1.0-firefox-upload.zip`, reported the stable
  `browser-capture@increader.com` ID, exposed the add-on actor, and completed a
  production-runtime reload.
- `web-ext lint --warnings-as-errors` reported zero errors, warnings, and
  notices.
- Two production builds produced identical checksum manifests.
- Both package archives were below 30 KiB and passed exact-entry, permission,
  remote-code, secret/key, source-map, and test-file inspection.
- The Firefox reviewer-source ZIP reproduced the upload artifact from the
  lockfile and contained both SBOM formats, notices, permission report, and
  commit provenance.

The Chrome Web Store and AMO account/login, submission, vendor signing, and
signed-artifact download steps were not attempted because they are the explicit
external credential boundary. No secret or private key is required before that
boundary.
