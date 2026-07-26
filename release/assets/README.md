# Release asset provenance

`increader-mark.svg` is copied from Increader's canonical
`apps/web/public/icons/icon-192.svg` at commit
`f8dcf003f9ecf30a47d7dfe2185ff7eece9fadac` (SHA-256
`ad72e83008e8605880eaaefe176100f307107535226693d8bd6df9f23d743f78`).

`amo-icon-128.png` is a 128 × 128 Sharp raster of `increader-mark.svg` for
uploading to Mozilla Add-ons. It is byte-identical to the Firefox package's
128-pixel runtime icon. Its SHA-256 is
`e5ef34042a2b20cd245688a12930f5f40f1ee3b5b7b73e538f68825581dd318c`.

`listing-screenshot.png` and `chrome-promo.png` were created with Codex's
built-in image generator, then resized once with Sharp to their exact store
dimensions. They are illustrative marketing artwork and contain no publisher
or User content. Their SHA-256 values are:

- `listing-screenshot.png`:
  `79c9d6d4cf4d3482bb54a1b6fbbf7ad643faf81898f0ed5bc877800435d00491`
- `chrome-promo.png`:
  `4879ae553de38923381190b597c3ceabe4dcef2b673d103b5907274d673f26c0`

The listing screenshot prompt requested a premium 16:10 Increader store visual
with the exact headline “Save it now. Read it later.”, the supporting line
“Capture any article and continue in Increader.”, and an illustrative compact
Import card. It uses the current Increader homepage and the supplied
pricing-page screenshot as style references.

The promotional-tile prompt requested a compact 11:7 companion asset with the
exact product name “Increader”, the tagline “Save it now. Read it later.”, the
open-book mark, and the same landing-page campaign style.

The active assets use Increader's warm off-white landing-page canvas, dark navy
typography, saturated indigo-purple accents, pale lavender organic shapes, thin
hand-drawn loops, sparse geometric details, rounded white cards, and the exact
slogan “Save it now. Read it later.”

`alternatives/dark/` preserves the previous deep-indigo campaign. Its SHA-256
values are:

- `alternatives/dark/listing-screenshot.png`:
  `5d7187ad054ea6f52f783684c5e9eb072f0ed16b2c663553d5788ea9d025933b`
- `alternatives/dark/chrome-promo.png`:
  `f0480bd72b26ec05e93e959b50b5165aa877390a50e34a1606c4c1b4d925982d`

`scripts/build.mjs` copies both generated raster masters into the release output
without composing or rendering additional marketing artwork. It continues to
raster the canonical runtime icon separately from `increader-mark.svg`.
