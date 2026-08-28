# BL-1211 hardener pass (round 3) — 2026-08-28

Merged architect handoff `75dbcf62e1` (BL-1211: architect bounce round 2 D1
re-fix — property tests for all three declared invariants). This is BL-1211's
fourth bounce; the prior three (cleaner, architect, QA) were all resolved by
earlier stages this same day. `recovery-filter-check.ts`/`recoveryFilterCliArgs.ts`
are now fully and legitimately reimplemented (not the stale, already-bounced
content I stripped out of my own worktree twice earlier today — see
`backlog/evidence/QA-mergeup-BL-1227-hardener-20260828.md`).

## Merge conflict resolution
`extension/test/bl1211OperatorCli.test.js` conflicted (add/add): my own
worktree carried a stopgap version covering only `quarantine-lift-check.ts`
(from stripping the earlier bounced `recovery-filter-check.ts` content
twice today). The incoming architect line carries the full, current,
legitimate reimplementation covering BOTH CLIs. Took theirs entirely — my
stopgap comment explaining the drop is now stale and superseded.

## Verification
- `npm run compile` — clean (`tsc --noEmit` equivalent).
- `npx vitest run test/bl1211OperatorCli.test.js test/bounceResurrection.test.js` — 24/24 green.
- `npx vitest run --config vitest.properties.config.mjs test/bounceResurrectionVerdict.property.test.js` — 3/3 green (P1: invariants 1+3, P2: invariant 2; non-vacuity already proven by hand twice per the coder's own notes — disabled the authorship check and separately the refusal branch, confirmed failures, restored).
- `run_acceptance.sh specs/features/BL-1211-quarantine-lift-cannot-restore-reverted-bounce-content.feature` — 8/8 green.
- CRAP: `node scripts/crapReport.js` against all 4 touched src files — every
  function ≤6, exit 0. This round's implementation already includes the
  CRAP-reducing extraction (flag-lookup tables, `authorshipAt`/
  `pipelineRoleTrailer` split) from the start, carried over from the earlier
  hardener pass this round rebuilt from.
- DRY: `npx jscpd` reports the same 24-line clone pair between
  `quarantineLiftCliArgs.ts` and `recoveryFilterCliArgs.ts` documented in the
  prior hardener pass (`BL-1211-hardener-pass-20260828.md`) — the two files
  deliberately mirror each other's shape; not re-litigated, same precedent
  applies unchanged (the bare for-loop flag-parsing shape appears in ~52
  other `src/tools/*.ts` CLIs repo-wide with no shared helper).
- Acceptance step file uses the shared `mkSocketFixtureRoot`/
  `releaseSocketFixtureRoot` helper — no fixture leak risk.

No further hardening needed; forwarding unchanged.

By hardener.
