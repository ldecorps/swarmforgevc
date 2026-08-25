# BL-1143 — cleaner pass — 20260825

- Tip-pure stack: `origin/main` + BL-1142 tip `f1ff2716f0` (required
  dependency for pack-shape gate) + BL-1143 tip `4741a45c33` + prior
  BL-1142 classifier split. `dels_on_origin=0`.
- DRY: cold-swap refuses forbidden packs via `bl1142_is_forbidden_substitute_pack`.
- Tests: cold_swap + pack_shape runners ALL PASS;
  `bl1143ColdSwapDayShift.property.test.js` 1/1 pass.

By cleaner.
