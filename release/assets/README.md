# Release asset provenance

`increader-mark.svg` is copied from Increader's canonical
`apps/web/public/icons/icon-192.svg` at commit
`f8dcf003f9ecf30a47d7dfe2185ff7eece9fadac` (SHA-256
`ad72e83008e8605880eaaefe176100f307107535226693d8bd6df9f23d743f78`).

`listing-screenshot.png` was captured by
`scripts/capture-listing-screenshot.mjs` from the exact 0.1.0 Chrome upload ZIP
in Chrome for Testing 150.0.7871.24. Its popup pixels are the real production
disconnected UI; the surrounding checked-in canvas contains explanatory
release copy only. Its SHA-256 is
`25b3e79f9bf836e043c84413be6e2cf6926f9e0ffddab50f2b2492d374119c5c`.

`chrome-promo.svg` is synthetic release artwork. Its SHA-256 is
`3a105ac2ab9debe705861bdb51f237f1f0be114038f2da4d0d27b715376b573d`.
Neither asset contains publisher or User content. `scripts/build.mjs` copies
the actual screenshot and deterministically rasters the promo and runtime icon
masters into the release output.
