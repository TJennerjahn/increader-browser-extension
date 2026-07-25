# Distribution and installation runbook

All commands start from a clean checkout of the release commit.

## Build and verify

```sh
npm ci
npx puppeteer browsers install chrome
npx puppeteer browsers install firefox
npm run verify
```

`npm run verify` builds twice and rejects a checksum difference. It then
inspects exact archive contents and permissions, runs web-ext lint and
dependency/license audits, loads the exact Chrome upload ZIP after extraction,
temporarily installs the exact Firefox upload ZIP after extraction, reloads the
Firefox runtime, and executes the real-browser core matrix.

## Chrome load-unpacked

1. Verify `checksums.sha256`.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
   and select `dist/production/chrome`.
3. Confirm the ID is `haipjkpamjpojalajcgfeggbjhifjpnn`, version is `0.1.0`,
   incognito is disallowed, and the permission list matches
   `release-metadata/manifest-permissions.json`.

The automated equivalent uses Chrome for Testing's extension API against files
extracted from the exact Chrome upload ZIP, triggers the action, and observes
the production popup and background runtime.

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

The release gate performs the same temporary-install protocol against Firefox
140+ using files extracted from the exact upload ZIP, verifies the stable
add-on ID, and exercises a runtime reload. Interactive testing may alternatively
use `about:debugging` → **This Firefox** → **Load Temporary Add-on** and select
`dist/production/firefox/manifest.json`.

## AMO unlisted signing and internal distribution

1. Verify checksums and reviewer-source reproducibility.
2. Run `npm run web-ext:lint`.
3. Submit `*-firefox-upload.zip` to AMO as an unlisted add-on, attaching
   `*-firefox-reviewer-source.zip` and the reviewer walkthrough.
4. Keep the AMO-issued signed XPI outside git and record its SHA-256 beside the
   release record.
5. Distribute only the AMO-signed XPI through the maintainer-controlled
   internal channel.

AMO credentials, submission, Mozilla review, signature generation, and signed
XPI are explicitly external. The repository completes and tests every step
before that boundary; it never stores vendor credentials or signing keys.

## Rollback

Retain the previous signed artifact and checksums. If a release must be
withdrawn, stop distribution and restore the previous signed version through
the same vendor channel. Routine downgrade is not a data-migration mechanism;
validate the checked-in previous-candidate fixture before publishing.
