# BL-1182 — architect re-pass after bounce fix

Architect, 2026-08-30. Reviewed cleaner's merge of coder's `f64ad32809`,
which fixes D1 and D2 from the prior bounce.

## A merge-drop caught and fixed AGAIN (not a coder/cleaner defect)

Merging cleaner's `77d06df867` into this branch again resolved
`specs/pipeline/steps/index.js` with no conflict, and again silently dropped
`require('./bl1182DayLongBobTrialLifecycleSteps')` — same root cause as the
BL-1277 instance earlier this shift: the merge-base had the line, this
branch had removed it (deliberately, while BL-1182 was bounced), and
cleaner's side carried it unchanged relative to a different ancestor, so
git's three-way merge followed the deletion. Diffed the merge commit against
cleaner's tip directly: this was the only discrepancy. Restored the line
(`a80815dfe`) and confirmed `node -e "require('./specs/pipeline/steps/index.js')"`
loads clean. Filing this as a standing thing to check on every merge-up of a
ticket this branch previously bounced-and-reverted: the same silent-drop
shape will recur every time until this branch's revert and the ticket's own
re-fix reconverge in one common ancestor (i.e. once this parcel reaches QA
and the merge-up broadcast lands everywhere).

## D1 verified fixed

Re-ran my own exact repro end-to-end: promote `cerebras/trial-a` over
`anthropic/perm-model` (9 > 7), externally drift the ModelFactory assignment
overlay to `openai/drift-model` (simulating a reassignment outside the trial
CLI), then nominate `cerebras/trial-b`. Before the fix this reported
`permanent=openai/drift-model`; now:
```
trial armed role=coder model=cerebras/trial-b permanent=cerebras/trial-a ends=...
```
Correctly resolves from the trial ledger, ignoring the drifted overlay.

Read `model_steward_store.bb`'s `read-trials!`: `:permanent` now gets the
same `(update :permanent (fn [m] (into {} (map (fn [[k v]] [(name k) v])) ...)))`
re-stringify already applied to `:active`/`:losers`, with a comment
attributing the fix to this bounce.

The test gap is closed, not just the bug: `model_steward_trial_lib_test_runner.bb`
now has a dedicated disk-round-trip case (`write-trials!` → `read-trials!`
through a real temp dir) asserting all three role-keyed maps resolve by
STRING role — every other assertion in the file was in-process and could not
have caught this class.

## D2 verified fixed

`bl1182_trial_lifecycle_property_runner.bb`'s header comment now points at
`backlog/evidence/BL-1182-day-long-trial-lifecycle-20260830.md` (the file
that actually carries the non-vacuity table), with a note explaining the
correction.

## Checks re-run after the fix, all clean

- `bb model_steward_trial_lib_test_runner.bb`: ALL PASS (round-trip case
  included).
- `bash test_model_steward_trial_cli.sh`: ALL CHECKS PASSED.
- `bb bl1182_trial_lifecycle_property_runner.bb`: ALL PASS, 500 runs/invariant.
- `npx vitest run test/trialBoundaryMemory.test.js`: 9/9.
- `node specs/pipeline/cli.js specs/features/BL-1182-...feature`: 5/5.
- `node extension/out/tools/dependency-gate.js` (parcel files + full-repo):
  PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js`: only this ticket's own
  files co-change (3x, one per round-trip); no external coupling.
- Full `vitest run --config vitest.config.mjs`: 26 failed / 218 failed —
  identical to the standing baseline. No regression.

No further defect. Forwarding to hardener.
