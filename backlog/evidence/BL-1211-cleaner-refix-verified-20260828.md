# BL-1211 cleaner re-verification (D1 re-fix) — 2026-08-28

Merged coder's re-fix (`e03d4fc346`) for my own D1 bounce
(`backlog/evidence/BL-1211-cleaner-bounce-20260828.md`). Restored all four
of BL-1211's files from coder's branch (the two the merge conflicted on
plus the two it didn't touch — `bounceResurrectionVerdict.ts` and the
step-handler file — since the earlier bounce had removed all of them from
this branch together) and re-added the `index.js` require.

## Review
Both halves of my finding addressed correctly:
1. **Test fixture fix**: scenario 05's non-vacuity check now builds its
   own bounced-then-reverted pair inside its own fixture repo, never
   borrowing another repo's commit SHA.
2. **Architecture fix** (the ticket-owner call I explicitly flagged as
   worth making): `gatherBounceResurrectionFacts` now returns
   `{facts, unresolvedTickets}` instead of a bare array.
   `quarantineLiftCheck` (the actual backstop gate) fails CLOSED on an
   unresolved bounce record; `filterRecoveryPaths` (not the final gate)
   keeps failing OPEN, matching every other send-time gate in this
   codebase. Well-reasoned, clearly documented, correctly differentiates
   the two call sites' stakes.

No duplication or structural issues.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run bounceResurrection` run 10 consecutive times: 12/12 pass
  every time — the flake is gone (was 3/8 failures before the fix,
  independently reproduced by me; coder's own report says 8/8, now
  confirmed with 10/10 here).
- Acceptance (`BL-1211-quarantine-lift-cannot-restore-reverted-bounce-content.feature`
  via `run_acceptance.sh`) run 3 times: 5/5 pass every time, 0 leaked
  `/tmp/bl1211-*` directories.

By cleaner.
