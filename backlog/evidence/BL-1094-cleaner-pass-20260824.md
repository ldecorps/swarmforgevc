# BL-1094 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `80fe63fe94` (BL-1094: exempt dispatch-gap auto-route
from BL-953 coherence) into `swarmforge-cleaner` via `git merge --no-ff`.
Merge commit named the paused→debt parking ids absorbed with the coder tip
so the ticket-deletion guard could accept the rename set.

Ancestry: `git merge-base --is-ancestor 80fe63fe94 HEAD` holds.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/task_commit_coherence_gate_lib_test_runner.bb`:
   ALL PASS (including new BL-1094 coverage for handoff-validation /
   unknown log lines and missing auto-route flag).
2. **APS step unit** — `node --test specs/pipeline/test/steps/dispatchGapSteps.test.js`:
   pass.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1094-the-auto-route-cites-head-so-the-coherence-gate-blocks-it.feature`:
   5/5 pass (HEAD subject matrix, hand-authored refuse, named gate log).

Property suite not run (cleaner does not own property tests). CRAP/mutation/DRY
tooling not wired for `.bb` — degraded gate is the unit suite (ran above).
Mutation-site count N/A (no TS `src/` in this parcel's coder tip).

## Cleanup performed

- Split `operator-refusal-log-line` into `coherence-refusal-stderr?` +
  `refusal-gate-name` so each helper stays well under CC 6 and the
  `gate=` / `reason=` formatting is written once.
- Extended the unit runner to cover the previously-untested
  `handoff-validation` and `unknown` branches, plus `check-enabled?` with
  a missing flag (must stay enabled).

## Findings beyond that

NONE. Exemption stays an env seam (`SWARMFORGE_DISPATCH_GAP_AUTOROUTE`) set
only by `auto-route!` / harness — `blocked?` itself is untouched. No further
structure change needed.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1094-the-auto-route-cites-head-so-the-coherence-gate-blocks-it`.

By cleaner.
