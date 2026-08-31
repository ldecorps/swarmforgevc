# BL-1298 architect pass — 2026-08-31

Reviewed commit fbc52c16b2 (coder, forwarded unchanged by cleaner), merged
into swarmforge-architect as `Merge cleaner BL-1298: replay runs from
caller's worktree. By architect.`

Scope: `swarmforge/scripts/land_step_lib.bb` (Babashka/Clojure) plus its
acceptance step handler and fixture script. No TS files touched — the
dependency-gate/co-change tools do not apply (Babashka has no
mutation/CRAP/DRY/dependency wiring per Article Startup Tools; gated only by
its own unit-test suite).

## Checks

- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb`: ALL PASS.
- `bb swarmforge/scripts/test/bl1298_replay_worktree_property_runner.bb`:
  ALL PASS, generator reach confirmed non-degenerate across all six outcome
  branches (create-fail, linked, linked-nested, main, nothing-to-commit,
  success — 40 runs).
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1298-the-replay-runs-from-a-linked-worktree.feature`:
  4/4 pass.
- required_wiring anchor (`specs/pipeline/steps/index.js::bl1298ReplayLinkedWorktreeSteps`):
  present at `specs/pipeline/steps/index.js:909`.
- No regression: BL-1272's feature 6/6,
  `swarmforge/scripts/test/landed_but_open_test_runner.bb` OK.
- Both declared invariants (git-common-dir parity across checkout kinds;
  a failed replay leaves no scratch worktree/branch) are directly
  implemented by the diff (`git-common-dir` fn; `drop-branch!` now called on
  every failure path including the create-failure path that used to return
  early) and are each shown, per the commit message, to fail against a
  targeted mutation of the fix — non-vacuous.
- Fixture script `bl1298ReplayWorktreeFixtureCli.sh` correctly unsets
  `GIT_DIR`/`GIT_WORK_TREE` before driving git (the ambient-env-leak trap
  this project has hit before, BL-1200/BL-1222).
- Ticket explicitly scopes OUT sweeping the four pre-existing
  `land-replay/*` branches and OUT changing what a successful replay
  leaves behind; the diff does neither — scope respected.

No architecture violation, no invariant violation, no correctness defect
found. No new property-test-shaped module beyond what the parcel already
added and covered.

## Disposition

Pass forward to hardener. No bounce.
