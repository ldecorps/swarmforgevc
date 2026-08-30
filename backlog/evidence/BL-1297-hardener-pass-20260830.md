# BL-1297 hardener pass — 2026-08-30

## Received
`merge_and_process architect 513d840d97` (architect clean pass, no violations).
Merged into hardener worktree as `d4e74ea3d1`; ancestry confirmed
(`git merge-base --is-ancestor 513d840d97 HEAD`).

## Scope of the change
`swarmforge/scripts/task_scope_gate_lib.bb`'s `own-commit-diff` (private) was
replaced by public `own-commit-changed-paths`, which diffs a commit against
its actual first parent (root commit: `--root`) for every commit shape,
instead of `diff-tree --first-parent` (a no-op flag on `diff-tree`, which
also suppresses merge diffs entirely without `-m`). `land_step_lib.bb`'s
`diff-readable?` now shares this same walk instead of a second, independent
`git diff-tree` invocation. `unregistered_test_gate_lib.bb` already calls
through `parcel-own-changed-paths`, which calls the same helper — all three
callers now share one walk. No TypeScript/JS production source changed; the
only production code touched is the two `.bb` files above.

## BL-149 cooldown gate — both changed production files: skip-cooldown
Ran `mutation_cooldown_gate.bb . <file>` for both changed production files:

- `swarmforge/scripts/task_scope_gate_lib.bb`: `file_age_days: 0.49`
  (last touched on `main` by `9a77c98bac`, ~12h ago — unrelated churn, the
  revert of the BL-1240 documenter merge)
- `swarmforge/scripts/land_step_lib.bb`: `file_age_days: 1.38`
  (last touched on `main` by `41215944a7`, BL-1241)

Both inside the 3-day cooldown window on `main` → `DECISION: skip-cooldown`
for both, independent of host load (load avg 2.15–2.40 on 20 cores, quiet).
Per the constitution's mutation-cooldown rule, mutation testing (including a
BL-638 hand-authored surgical sweep, since these `.bb` files have no wired
mutation tool) is deferred unconditionally this pass, not run and not
skipped for load reasons.

**Verification instead of mutation this pass**, and it is substantial: the
coder's own commit `1160427e31` already carries 15 unit rows in
`task_scope_gate_lib_test_runner.bb` covering every branch of
`own-commit-changed-paths` (has-first-parent / root-no-first-parent /
unreadable-no-first-parent) and every commit shape named in the ticket
(merge with a clean first-parent change, merge carrying a foreign path,
merge as the walk's only tagged commit, ordinary single-parent commit
byte-identical to the old invocation, a delete+add single-parent commit,
an empty root commit, a root commit carrying a foreign path, an unreadable
commit answering nil not `[]`), plus 2 property tests over 5 generator-built
commit shapes (architect already confirmed non-vacuous: reach floors
asserted per shape, independently constructed oracle, invariant 2
cross-checks all three callers agree — `backlog/evidence/BL-1297-architect-20260830.md`).
Re-ran all of it fresh in this worktree; all green (see below). Read
together with the cooldown gate, this is the BL-149 rule working as
designed: the ticket's own coder-authored sweep against the shared
`.bb` unit runner already stands in for a mutation pass on code this fresh,
and the file's churn state says a mutation run now would be testing a
target still in flux (unrelated flux on `main`, not this ticket's own).

## Verification run (all fresh, this worktree)
- `bb swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb` → ALL PASS
  (15 unit rows including the 8 BL-1297 rows above)
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` → ALL PASS
  (consumer 1 — `diff-readable?` now shares the walk)
- `bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb` → ALL PASS
- `bb swarmforge/scripts/test/bl1240_unregistered_test_gate_property_runner.bb`
  → ALL PASS (400 runs, consumer 2 — `parcel-own-changed-paths`)
- `npm run compile` (fresh `out/` per BL-497, TS unchanged but acceptance
  reads compiled `out/*.js`)
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1297-a-merge-commits-own-paths-are-not-empty.feature`
  → 4/4 scenarios pass
- `npx vitest run --config vitest.properties.config.mjs test/bl1297MergeOwnPathsInvariants.property.test.js`
  → 2/2 pass (invariant 1: first-parent change for every commit shape;
  invariant 2: an empty answer is truth, all three callers agree)
- Sibling-ticket regression check, since the same commit touched BL-1295's
  own fixtures to keep the merge itself out of that walk's range:
  - `npx vitest run --config vitest.properties.config.mjs test/bl1295RevertAttributionInvariants.property.test.js`
    → 3/3 pass
  - `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1295-revert-subject-does-not-blame-the-reverted-ticket.feature`
    → 3/3 pass
- `specs/pipeline/steps/index.js` registration confirmed:
  `require('./bl1297MergeCommitOwnPathsSteps')` present (line 656) —
  required_wiring entry satisfied, the four scenarios actually run (proven
  by the acceptance run above, not just grepped).

## CRAP / DRY
Not applicable this pass: no `src/*.ts` file changed (CRAP scope) and no
`src/**` duplication surface touched (jscpd's configured scope is `src`).
The only production code changed is the two `.bb` files above, which the
project's Startup Tools rule already documents as having no CRAP/DRY wiring.

## Standing whole-tree guards (specs/pipeline/steps/ and extension/test/ touched)
Ran all 16 `test/*Guard*.test.js` files (excluding `.property.` siblings)
since this parcel adds files to both trees:
`extension/test/bl1297MergeOwnPathsInvariants.property.test.js`,
`specs/pipeline/steps/bl1297MergeCommitOwnPathsSteps.js`.

Result: 14 passed, 3 failed (171/174 individual tests). All 3 failures are
**pre-existing, already-ticketed, unrelated to this parcel** — confirmed by
grepping neither failure's violation list for "1297" and by grepping the
backlog for each guard name:

- `test/liveRepoDerivationGuard.test.js` → **BL-1291** (paused, priority 24)
- `test/socketFixtureShortRootGuard.test.js` → **BL-1290** (paused, priority 25)
- `test/tempDirTrapGuard.test.js` → **BL-1289** (paused, priority 26)

None of the three violation lists name any BL-1297 file. Per the
already-ticketed-red rule (BL-1063), these are reported here as
confirmed-untouched-by-this-parcel, not re-reported as new.

## Process hygiene
No orphaned `node --test`/`stryker` processes before or after this pass
(checked via `pgrep -fl`; the only matches were the grep command's own
argv, not real processes). Untracked
`swarmforge/scripts/wait_pipeline_drain.sh` in the worktree predates this
pass and was not created by me — left untouched per "never delete what you
did not create."

## Verdict
No hardening changes needed. Forwarding the received commit unchanged to
the documenter (priority `00`), task name preserved.
