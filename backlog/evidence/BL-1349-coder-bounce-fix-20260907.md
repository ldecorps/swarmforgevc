# BL-1349 — coder bounce fix, 2026-09-07

Responding to `backlog/evidence/BL-1349-architect-bounce-20260906.md` (D1):
the `no-property-is-dropped-02` step handler read its "before" state via
`git show HEAD:<path>`, which is byte-identical to the on-disk file from
the moment the tuning commit (`7f0e5766c9`) exists on any branch that later
runs this acceptance suite — every stage after coder. The assertions could
therefore never fail regardless of what the diff actually contained.

## Fix

`specs/pipeline/steps/bl1349SpawnHeavyPropertyBudgetSteps.js`: read the
"before" content from `${TUNING_COMMIT}^:<path>` instead of `HEAD:<path>`,
where `TUNING_COMMIT` is the coder's own tuning commit `7f0e5766c9` — a
fixed, real SHA already an ancestor of every downstream worktree's HEAD, so
it resolves consistently regardless of which stage runs the scenario.

## Proof the check is no longer vacuous

At current HEAD (`5552dbd2f6`), for all three tuned files:

```
$ node -e "... compare git show 7f0e5766c9^:<path> vs on-disk <path> ..."
onboarderLauncherPidGuard.property.test.js identical to HEAD-based before? false
onboarderLauncherPidGuard.property.test.js differs from after (non-vacuous)? true
bl1252CommitGuardAggregationInvariants.property.test.js identical to HEAD-based before? false
bl1252CommitGuardAggregationInvariants.property.test.js differs from after (non-vacuous)? true
bl787NamedTunnelInvariants.property.test.js identical to HEAD-based before? false
bl787NamedTunnelInvariants.property.test.js differs from after (non-vacuous)? true
```

The "before" reference now genuinely differs from the tuned on-disk file
(confirmed independently by `git show 7f0e5766c9^:...onboarderLauncherPidGuard...`
vs the working file: the pre-tuning file has `numRuns: 15`, no explanatory
comment; the tuned file has `numRuns: 2` plus the coder's cost-driver
comment) — the diff the scenario runs is a real one, not `HEAD` against
itself.

## Acceptance re-run

`bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1349-spawn-heavy-property-files-fit-a-budget.feature`:

- `no-property-is-dropped-02` (the scenario this bounce is about): **PASS**
  — every `test(...)` name and every `fc.property(`/`fc.assert(` count is
  preserved or increased when diffed against the real pre-tuning content.
- `spawn-heavy-file-fits-budget-01`, Example 2
  (`bl1252CommitGuardAggregationInvariants.property.test.js`): failed in
  this run at 18150ms > the 15000ms budget. Re-run alone, isolated from the
  other two heavy spawn files in the same acceptance run: 10.70s (5/5
  properties pass) — comfortably under budget. This is the same
  host-contention pattern already documented in
  `backlog/evidence/BL-1349-coder-pass-20260906.md` ("Whole-lane
  verification" section) from running multiple real-process-spawning
  scenarios back-to-back in one acceptance invocation; it is not caused by
  this fix, which touches only the no-deletion diff's git ref, not the
  per-file timing step. Examples 1 and 3 passed in the same run at
  8.80s/13.98s.

## Invariants (BL-654) — unaffected

This fix does not touch either declared invariant's own encoding (the
no-deletion scenario itself, and the per-file `numRuns` reductions already
landed in `7f0e5766c9`) — it corrects the git ref the acceptance scenario
already existed to check, discharging the same obligation the coder pass
already recorded, now honestly.

By coder.
