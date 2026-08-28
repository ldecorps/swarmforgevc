# BL-1208 cleaner pass — 2026-08-28

Merged coder handoff `e558d68c99` for BL-1208 (revert remedy requires
established authorship, not liveness alone — the exact class recorded in
this session's own operator memory: "record-bounce.js: DESTRUCTIVE revert
on healthy commits — liveness != authorship"). Clean merge, no conflicts.

## Review
`existedIdenticallyBeforeLoss`/`restoredFromEarlierHistory` is minimal,
well-scoped (gated behind the add-back precondition so the extra git IO
never fires on an ordinary edit/delete), and deliberately restricted to
the bouncing branch's OWN history rather than any sibling branch's tip —
correctly avoiding a false-withheld-remedy laundering path. `decideBounceRevertVerdict`
withholds the remedy only when EVERY live file is established-restored;
the finding and every live path are still reported either way (BL-954's
no-silent-clean invariant preserved). The new field is optional, default
"not established", so every pre-BL-1208 caller is unaffected. No
duplication or structural issues.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run bounceRevertRestoration bounceRevertCheck`: 23/23 pass
  (7 new + 16 pre-existing byte-for-byte unedited).
- `vitest run --config vitest.properties.config.mjs bl954BounceRevertCheckInvariants`:
  3/3 pass.
- Acceptance (`BL-1208-revert-remedy-requires-authorship-not-liveness.feature`
  via `run_acceptance.sh`): 4/4 pass.
- `bl1208RestorationNotAuthorshipSteps.js` fixture: `finally`-guarded
  cleanup; 0 leaked `/tmp/bl1208-*` directories after the run.

By cleaner.
