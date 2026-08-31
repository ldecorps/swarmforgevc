# BL-1298 hardener pass — 2026-08-31

Reviewed commit 60659c9367 (architect, clean, no violations), merged into
swarmforge-hardender.

Scope: `swarmforge/scripts/land_step_lib.bb` (Babashka) plus its acceptance
step handler and fixture script. No TS files touched — CRAP/DRY/Stryker
tools don't apply (Startup Tools: Babashka has no mutation/CRAP/DRY wiring),
gated only by its own unit-test suite, which is exactly what the coder built.

## Checks

- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb`: ALL PASS.
- `bb swarmforge/scripts/test/bl1298_replay_worktree_property_runner.bb`:
  ALL PASS, generator reach confirmed non-degenerate across all six outcome
  branches (create-fail:16, linked:21, linked-nested:9, main:10,
  nothing-to-commit:9, success:15 over 40 runs).
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1298-the-replay-runs-from-a-linked-worktree.feature`:
  4/4 pass.
- No orphaned processes, branches, or worktrees left by this pass's own
  runs (`git branch --list 'land-replay/*'`, `git worktree list`, `git
  status --short` all clean before and after).

## Assessment

The coder's own pass already did the hardening work this stage exists for:
three new unit cases each confirmed to fail against the pre-fix
implementation, and both declared invariants encoded as properties with
asserted non-degenerate generator-reach over every replay outcome and both
checkout kinds, each shown to fail against its own targeted mutation
(common-dir hop reverted; create-path branch-delete removed) rather than
merely against the whole fix reverted. The architect independently
re-verified all of this plus the required_wiring anchor and scope
boundaries before forwarding.

Nothing left uncovered: every branch of `replay!` (origin-main-sha nil,
common-dir nil, create-fail, apply-fail, commit-fail/nothing-to-commit,
success) has a dedicated case in either the unit runner or the property
runner, and the three failure paths all now route through the same
`drop-branch!`, which the property runner exercises directly rather than
inferring from the unit cases alone.

No further hardening needed. No CRAP/DRY gate applies (no `.ts` files in
the diff).

## Disposition

Pass forward to documenter. No bounce.
