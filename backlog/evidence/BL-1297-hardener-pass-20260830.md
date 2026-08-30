# BL-1297 hardener pass — 2026-08-30

Merged architect `754c893f04` (the DELIVERED/AUTHORED split, clean architect
pass). `check_merge_deletion.sh` refused the merge on an unattributed
deletion of `backlog/INTAKE-operator-question-1788111848391.md` (introduced
at `e514b7ecb4`, subject carries no ticket id, so no commit message could
satisfy the guard per the standing workaround). Resolved per that workaround:
aborted, cherry-picked the deleting commit `fe99aacb52` (specifier's intake
drain + workflow.prompt amendment) onto the branch first, then re-ran the
merge — it went clean, resulting tip `fb213aa4c8`.

## Suites run (all green)

- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1297-a-merge-commits-own-paths-are-not-empty.feature` — 6/6.
- `npm run test:properties` scoped to `bl1297MergeOwnPathsInvariants` — 3/3
  (invariant 1 delivered/authored split, invariant 2 empty-is-truth, invariant
  3 caller wiring).
- `bb swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb` — ALL
  PASS (the third caller of the shared walk, per the ticket's invariant 3).
- Standing whole-tree guards (`extension/test/*Guard*.test.js`, non-property):
  17 files, 3 failed / 14 passed. All 3 failures are pre-existing standing
  debt in files this parcel does not touch:
  `bl1112StandingUnitRedsSteps.js` / `bl691AmbulanceWorkflowGapsSteps.js`
  (socketFixtureShortRootGuard — tracked, `backlog/paused/BL-1290-...yaml`
  exists for the socket-root class; the two specific files are named in prior
  evidence at BL-1112/BL-1203/BL-1199/BL-888/BL-1154), and a long,
  cross-cutting `tempDirTrapGuard`/`liveRepoDerivationGuard` list of unrelated
  `swarmforge/scripts/test/*` and `extension/test/*` files. None name
  task_scope_gate_lib.bb, land_step_lib.bb, or bl1297MergeCommitOwnPathsSteps.js.

## Mutation sweep (no wired Stryker for `.bb`; feature file has no
`Scenario Outline`, so BL-113/BL-638 is inapplicable — hand-authored sweep
per the BL-567 pattern, over `task_scope_gate_lib.bb`'s new logic)

Applied and reverted one at a time, `bb .../task_scope_gate_lib_test_runner.bb`
re-run after each:

1. `subject-names-task?`: drop the `(not ...)` around `revert-subject?` —
   **KILLED** (17 failures, s02/s03/root-commit rows).
2. `revert-subject?`: drop the `(?i)` case-insensitive flag on the regex —
   **KILLED** (5 failures, the revert-subject? unit rows).
3. `own-commit-changed-paths`, has-parent branch: `(= semantic :authored)` →
   `(not= semantic :authored)` (swaps which git invocation each semantic
   gets) — **KILLED** (8 failures: s02, s03, s05).
4. `own-commit-changed-paths`, root-commit branch: same semantic swap on the
   `--root` invocation — **SURVIVED**. Verified this is a real git-semantics
   equivalent, not a gap: `--cc` is a MULTI-parent combined-diff mode: a root
   commit has no parent to combine against (the "--root" form diffs it
   against the empty tree, one side only), so `--cc --root` and the plain
   `--root` diff produce byte-identical output for a root commit — the two
   branches this mutation collapsed were already computing the same thing.
   Full suite (acceptance 6/6, property 3/3, bb runner ALL PASS) also stayed
   green with the mutation applied, confirming no observation point anywhere
   could have told the two apart. Recorded rather than force-tested per the
   BL-234 exception, demonstrable from git's own documented `--cc` semantics.
   Not filed as a rule_proposal — narrow to this one call site, not a
   pattern likely to recur.

`parcel-own-changed-paths` (the third caller, used by
`findings-for-git-handoff` and `unregistered_test_gate_lib.bb`) is a thin
`:authored`-binding wrapper over `task-tagged-changed-paths`; covered
transitively by scenario 02/05's end-to-end `findings-for-git-handoff` runs
and by the unregistered-test-gate's own green test runner — no separate unit
test needed for a one-line binding already exercised at both call sites.

`land_step_lib.bb`'s two BL-1297 edits (`diff-readable?` and `own-paths` now
pass `:delivered` explicitly rather than inheriting the default) are
behavior-preserving — the default was already `:delivered` — verified by
`land_step_lib_test_runner.bb` staying green and by scenario 03's replay
assertion.

## Disposition

No functional gap found. One equivalent mutant recorded above. No orphaned
mutation-sweep fixtures or test processes left running (`pgrep -fl 'node
--test|stryker'` clean before and after). CRAP/DRY: not applicable — no
`src/*.ts` files were added or changed by this parcel (only `.bb`, a `.js`
step-handler file and a `.property.test.js`, none of which the tooling scopes
to). Forwarding to documenter.
