# Browser Capture qualification

Run the real Firefox workflow from the extension repository:

```sh
FIREFOX_BINARY=/path/to/firefox npm run browser:test:capture
```

The runner bundles production Capture Package, Capture Job, runtime, IndexedDB,
and multipart HTTP modules into a temporary Firefox extension. A synthetic HTTP
server supplies articles and image streams. Authentication and import outcomes
are simulated at the HTTP boundary. Temporary host grants and a local ChatGPT
DNS alias exist only in this test extension. Production permissions are unchanged.
Geckodriver 0.36.0 is downloaded through the pinned npm dependency; its
`--allow-system-access` flag permits WebDriver to open the test extension on
recent Firefox versions. Each run uses a disposable profile and removes it.

The default scenarios check:

- valid articles, missing doctypes, invalid language hints, oversized titles,
  and untitled pages;
- image fragments, quoted attribute-like alt text, comments with apostrophes,
  and raw-text HTML elements;
- publisher overrides of native page APIs;
- stalled image bodies: the article must complete within seven seconds;
- a custom Unicode Bookmark title and explicit Reading Queue opt-out;
- identical immutable package/options on explicit network Retry;
- explicit Retry after HTTP 401 using a newly acquired token.

The readable result artifact is `dist/qualification/firefox-capture.json`.
The runner fails if any scenario fails. Use `CAPTURE_SCENARIOS=ordinary,...` to
narrow the feedback loop. `npm run browser:test:matrix` runs the existing Chrome
popup/package smoke and this Firefox workflow.

## Popup closure and background lifetime

```sh
CAPTURE_SCENARIOS=background-lifetime \
FIREFOX_BINARY=/path/to/firefox npm run browser:test:capture
```

This starts a real background Capture Job through extension messaging, closes
all extension utility documents, and delays the server's response for 32 seconds.
After 36 seconds, reopening must show completion without Retry. The result is
`dist/qualification/firefox-background-lifetime.json`.

The regression originally restored an interrupted transfer after Firefox
suspended its event page. Active capture/transfer now makes one browser API call
every 20 seconds to retain the authorized job; completion, failure, cancellation,
and runtime teardown stop that heartbeat. It neither retries nor changes the
120-second transfer deadline. The deadline also covers token acquisition.

## Evidence

Recorded before/after results are in `docs/evidence/`. All 14 default scenarios
pass on Firefox 140 and 153. Firefox 140 originally
failed optional language/title metadata, image fragments, ordinary HTML comments,
and pages overriding native APIs. Eight stalled image streams took 32,025 ms
before the request could complete. With a 1.5-second per-image timeout and a
five-second shared image budget, the same fixture completed in 4.5–5.1 seconds across recorded runs.
Missing or slow optional images retain an unavailable asset outcome and do not
invalidate the article.

The separate background-lifetime regression failed before the fix and completed
afterward despite a closed utility and a response exceeding the idle window.
These are controlled fixture timings, not a production-server latency guarantee.

## Actual Increader API bridge

For a running local Increader development stack and a disposable test account:

```sh
CAPTURE_SCENARIOS=chatgpt \
CAPTURE_API_ORIGIN=http://127.0.0.1:18080 \
CAPTURE_API_TOKEN_FILE=/tmp/disposable-test-token \
CAPTURE_CHATGPT_FIXTURE=/path/to/Increader/tests/e2e/fixtures/chatgpt-capture.html \
FIREFOX_BINARY=/path/to/firefox npm run browser:test:capture
```

This sends Firefox's actual captured multipart package to the real API. It uses
local synthetic messages, never a private ChatGPT account. The report contains
the resulting Bookmark ID for downstream Reader verification, and does not
contain the token. The API origin must be loopback. The report is
`dist/qualification/firefox-capture-backend.json`.

The shared fixture's literal `chatgpt.com` source uses an ephemeral local port;
the server does not share Firefox's DNS alias. Favicon fallback can therefore
consume the existing server timeout in this optional bridge test. The captured
conversation still imports without the publisher page being refetched.
