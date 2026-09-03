# BL-1337 — architect re-review after cleaner rework (2026-09-03)

## Context

Prior architect bounce (`backlog/evidence/BL-1337-architect-bounce-20260903.md`)
found D1: invariant 1's reach floor was luck-drawn, ~17.5% flaky (7/40 runs).
This pass reviews the cleaner's forwarded rework (merge commit a0a7b27cce,
cleaner rework commit 87437f3323).

## D1 verified fixed, independently

- Read `bl1337ProfileCastInvariants.property.test.js`'s new `CONSTRUCTED`
  array: four explicit cases (`blockedByRegistry`, `blockedByHost`,
  `runnable`, `bothBarsFail`), each hand-built to deterministically hit its
  reach counter — no longer left to the random per-run draws. `reach.*`
  assertions now pass by construction, not luck.
- Ran `npx vitest run --config vitest.properties.config.mjs
  bl1337ProfileCastInvariants` 3 consecutive times — 3/3 tests green each
  run, no flake.
- Confirmed production code untouched: `git diff 6673b75327 87437f3323 --
  swarmforge/scripts/bob_starting_cast_lib.bb
  swarmforge/scripts/bob_starting_cast_cli.bb` is empty — only the property
  test file changed, matching the cleaner's evidence claim.
- `bb swarmforge/scripts/test/bl1337_profile_cast_test_runner.bb` — ALL PASS.
- `run_acceptance.sh specs/features/BL-1337-….feature` — 7/7 pass.
- Dependency-rule gate (BL-259), scoped to the touched property test file:
  PASSED, no forbidden edges.
- Co-change report (BL-255): `specs/pipeline/steps/index.js` flagged as
  suspected coupling — expected/benign (shared step-registry file, touched
  by every new step module); not a real coupling defect.

## BL-1296 unaffected

This merge (cleaner a0a7b27cce onto my post-BL-1296-revert branch) correctly
kept BL-1296's files deleted — the standing BL-1296 bounce/revert
(`6077a6bfbc`) on this branch is untouched by this ticket's rework. Recorded
explicitly in the merge commit message (`a3daa3c9c7`) per the merge-deletion
guard.

## Verdict

D1 fixed and verified independently, nothing else changed, nothing else
found. Forwarding to hardener.
