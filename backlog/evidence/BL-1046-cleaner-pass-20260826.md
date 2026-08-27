# BL-1046 — cleaner pass — 20260826

- merge_and_process coder tip `c1eaf61a2d` (clean merge).
- DRY: `bl1046ConsoleTileSteps.js` — `patchSeat`, `assertTileText`,
  `parseCssClampMax`, and `roleKey` helpers for seat setup and tile assertions.
- Verified: `npm run compile`; Vitest unit lane green for
  `residentPaneSpy.test.js`, `residentSpyUiHtml.test.js`,
  `bl994LiveScreenGrid.test.js` (37/37). Src behavior unchanged — grid tiles
  read existing `PaneLiveSnapshot` held-ticket fields; batch `heldParcelCount`
  in coder tip.

By cleaner.
