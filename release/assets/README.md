# Release asset provenance

`increader-mark.svg` is copied from Increader's canonical
`apps/web/public/icons/icon-192.svg` at commit
`f8dcf003f9ecf30a47d7dfe2185ff7eece9fadac` (SHA-256
`ad72e83008e8605880eaaefe176100f307107535226693d8bd6df9f23d743f78`).

The listing screenshot and Chrome promotional artwork are synthetic, contain no
publisher or User content, and use the same mark and palette. `scripts/build.mjs`
rasters these checked-in SVG masters deterministically into the store-ready PNG
files in the release output.
