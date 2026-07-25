# Non-secret runbook exercise

The release gate builds and inspects the exact Chrome and Firefox artifacts,
checks their permissions and archive contents, lints the Firefox package, and
proves two production builds are reproducible. It also verifies the normal
authentication adapters and Capture workflow with synthetic data.

Chrome Web Store and AMO account login, submission, vendor signing, and signed
artifact download remain the explicit external credential boundary.
