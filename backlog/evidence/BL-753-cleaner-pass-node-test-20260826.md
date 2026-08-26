# BL-753 — cleaner pass (node:test restore rematch) — 20260826

- merge_and_process coder tip `175e84c2b2` (restores `node:test` import in
  `unreachableStepHandlerCheck.test.js` after prior cleaner Vitest-only strip
  broke `node --test` discovery).
- Leave import in place: `node --test` → 8/8 green. Do not re-strip for Vitest
  globals (ping-pong with hardener/coder; property suite already uses Vitest
  globals under `vitest.properties.config.mjs`).
- No further DRY; property encoding from prior rematch tip still on branch.
- Applied BL-753 rule: runner discovery gap is a real claim-coverage issue for
  the unit suite, not a cosmetic import nit.

By cleaner.
