# BL-1337 — cleaner re-review after architect bounce D1 (2026-09-03)

## Context

Architect bounced BL-1337 for a flaky invariant-1 reach floor (same shape
as BL-1352's D1 this session). The rework arrived twice: once accidentally
bundled into an unrelated BL-1296 commit (rejected — see
`BL-1296-cleaner-20260903.md`), and now correctly as its own standalone
commit (`87437f3323`).

## D1 verified fixed

- New `CONSTRUCTED` cases array (`blockedByRegistry`, `blockedByHost`,
  `runnable`, `bothBarsFail`) enumerated explicitly rather than left to
  random draws, same remedy pattern as this session's other D1 fixes.
  Also fixed a genuine generator bug found by the property itself: model
  ids are now unique per seat (`uniqueModels`), since two seats sharing a
  model id with different certification/reachability flags described an
  impossible registry.
- `npx vitest run --config vitest.properties.config.mjs
  bl1337ProfileCastInvariants` — 15 consecutive green runs, 0/15 failures.
- `bb swarmforge/scripts/test/bl1337_profile_cast_test_runner.bb` — ALL
  PASS.
- `run_acceptance.sh specs/features/BL-1337-…feature` — 7/7 pass.

## Production code unchanged

`git diff` of `bob_starting_cast_lib.bb` and `bob_starting_cast_cli.bb`
between my prior approved review (`6673b75327`) and this rework
(`87437f3323`) is empty — only the property test file changed.

## Verdict

D1 fixed, nothing else changed. Forwarding.
