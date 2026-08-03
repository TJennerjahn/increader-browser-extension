# Distribution and installation runbook

All commands start from a clean checkout of the release commit.

## Build and verify

```sh
npm ci
npx puppeteer browsers install chrome
npm run release:verify
```

`npm run release:verify` builds twice and rejects a checksum difference. It then
inspects exact archive contents and permissions, runs web-ext lint and
dependency/license audits, and smoke-loads the production Chrome extension and
account form. Firefox receives the same source and is checked by unit tests,
TypeScript, manifest assertions, production build inspection, and web-ext lint.

## Chrome load-unpacked

1. Verify `checksums.sha256`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select `dist/production/chrome`.
3. Confirm the ID is `haipjkpamjpojalajcgfeggbjhifjpnn`, version is `0.1.2`,
   incognito is disallowed, and the permission list matches
   `release-metadata/manifest-permissions.json`.

The automated equivalent uses Chrome for Testing's extension API, loads the
production directory, and observes the account form and background runtime.

Chrome Web Store upload, signing, publication, and account credentials are
external to this repository. Upload only the checksum-verified
`*-chrome-upload.zip`.

## Firefox temporary test

```sh
npx web-ext run \
  --source-dir dist/production/firefox \
  --firefox /absolute/path/to/firefox \
  --no-reload
```

Interactive testing can use `about:debugging` → **This Firefox** →
**Load Temporary Add-on** and select
`dist/production/firefox/manifest.json`.

## AMO unlisted signing and internal distribution

Verify checksums, reviewer-source reproducibility, and the pinned command
surface:

```sh
npm run signing:check
mkdir -p dist/signed
```

The only remaining credentialed step is:

```sh
WEB_EXT_API_KEY="<AMO JWT issuer>" \
WEB_EXT_API_SECRET="<AMO JWT secret>" \
npx web-ext sign \
  --channel=unlisted \
  --source-dir dist/production/firefox \
  --artifacts-dir dist/signed \
  --upload-source-code \
  dist/production/increader-browser-extension-0.1.2-firefox-reviewer-source.zip
```

The pinned `web-ext` packages the exact inspected Firefox directory, uploads
the human-readable reviewer source, and downloads the AMO-signed XPI. Keep that
XPI outside git, record its SHA-256 beside the release record, and distribute
only that signed file through the maintainer-controlled internal channel.

AMO credentials, submission, Mozilla review, signature generation, and signed
XPI are explicitly external. The repository completes and tests every step
before that boundary; it never stores vendor credentials or signing keys.
Mozilla documents `--channel=unlisted` as the self-distribution signing path:
<https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/#sign-your-extension-for-self-distribution>.

## Rollback

Retain the previous signed artifact and checksums. If a release must be
withdrawn, stop distribution and restore the previous signed version through
the same vendor channel.
