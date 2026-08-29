# BL-1257: The Review-Time Scope Check Shares The Send-Time Gate's Basis

`task_scope_gate_lib.bb` (BL-1192) already answers "did this author work
outside the ticket?" correctly at send time — walking only each task's own
tagged commits since its last handoff, never the full `origin/main...commit`
range. Until this ticket, review time had no such entry point: QA hand-rolled
`git diff --name-only origin/main <commit>` each pass, a range that
[BL-1192's own how-to](BL-1192-pre-handoff-task-scope-gate.md) already
rejected for the send-time gate because `origin/main` lags local `main` by
design (BL-891) and the false positives grow with every commit that widens
the gap.

## The incident this closes

2026-08-29, one QA pass, two bounces for entangled tip (BL-506), both mostly
false: BL-1247 (46 paths flagged, 37 explained by local-`main` lag, 3 real)
and BL-1238 (66 flagged, 38 lag, ~0 real). Both parcels had already passed
the corrected send-time gate — `swarm_handoff.bb` would have refused the
handoff otherwise. Two checks answering one question returned opposite
verdicts, and the falsified one held the veto.

## The fix

`swarmforge/scripts/task_scope_gate_cli.bb` is a thin IO/argv wrapper —
mirroring `pre_qa_gate_cli.bb`'s own shape — over
`task-scope-gate-lib/findings-for-git-handoff`, the exact function
`swarm_handoff.bb`'s send-time gate already calls. It is never a second
implementation of the scope walk.

```
task_scope_gate_cli.bb <task-name> <commit> [repo-root]
```

- Exit `0`, prints `OK` — no foreign scope found (or the walk could not be
  read at all; fail-open, printed as `TASK_SCOPE_GATE WARNING: ...` to
  stderr, never silently swallowed).
- Exit `1`, prints the same refusal text the send-time gate uses — naming
  every foreign path and its owning ticket, never a bare count of paths
  differing from `origin/main`.

Any role, QA included, can run this against a real commit and get the
identical verdict the send-time gate would have given for the same commit
and task — invariant: *the send-time gate and the review-time check never
return opposite verdicts for the same commit and task.*

## What is still open

The QA seat itself does not yet call this CLI — `swarmforge/roles/QA.prompt`
has no wording pointing at it. Landing that prose is the specifier's half of
this work (BL-798), tracked in BL-1257's own notes, and deliberately not
required for this pipeline pass: a parcel-pinned wiring check on `QA.prompt`
would false-block every documenter handoff whose branch has not yet merged
`main`. Until that prose lands, QA has the tool but nothing yet directs the
seat to run it in place of the old `origin/main` diff.

The `main`/`origin/main` divergence that makes the old check unreliable is
tracked separately as BL-891 and is out of scope here.

## Testing the gate locally

`specs/pipeline/steps/bl1257ReviewTimeScopeCheckSteps.js` drives both
`task_scope_gate_lib.bb` directly (via a `bb -e` JSON call) and the new CLI
end to end against real git fixtures, including a scenario that runs both
the send-time gate and the review-time check on the same commit shapes and
asserts they agree — see
`specs/features/BL-1257-review-time-scope-check-shares-the-corrected-basis.feature`.
