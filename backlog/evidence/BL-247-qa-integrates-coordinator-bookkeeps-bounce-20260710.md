# BL-247 bounce evidence — 20260710 (QA)

## Failing command

```
./specs/pipeline/scripts/run_acceptance.sh specs/features/BL-247-qa-integrates-coordinator-bookkeeps.feature
```

## Commit hash tested

`4edb65d` (QA's merge of the hot-edited commit `ed9e883165` into the QA
worktree; `ed9e883165` is the specifier's original single-parent commit on
`main`).

## First error excerpt

```
TAP version 13
# Subtest: QA lands the approved commit on main after the merge-up broadcast
not ok 1 - QA lands the approved commit on main after the merge-up broadcast
  ---
  error: `Scenario "QA lands the approved commit on main after the merge-up
  broadcast": no step handler matched "Given a pipeline ending at QA, with
  worktree roles merging up to QA's approved commit"`
  code: 'ERR_TEST_FAILURE'
  ...
# Subtest: the coordinator only moves the ticket and promotes, running no git integration
not ok 2 - ...same "no step handler matched" error...
# Subtest: closing the GitHub issue on merge moves to the integration owner
not ok 3 - ...same "no step handler matched" error...
1..3
# tests 3
# pass 0
# fail 3
```

All three of BL-247's own acceptance scenarios fail identically: no step
handler exists anywhere in `specs/pipeline/steps/index.js`'s registered
domains for the feature file's `Given`/`When`/`Then` lines. This is not a
step wording mismatch — there is no `BL-247` (or equivalent) steps module at
all. Confirmed by inspecting `specs/pipeline/steps/index.js`: 35 domain step
modules are registered, none named for BL-247, none whose patterns match this
feature file's language.

## Failure class

`acceptance`

Unit suite is fully green (163/163 files, 2315/2315 tests, re-run after
merging this commit) — this is specifically the acceptance gate (BL-112)
failing, not a compile/unit break.

## Expected vs observed

Expected: `run_acceptance.sh` against
`specs/features/BL-247-qa-integrates-coordinator-bookkeeps.feature` passes
3/3, per QA.prompt's BL-112 requirement that this run is the ticket's final
acceptance gate.
Observed: 0/3 — the pipeline cannot execute any of the ticket's own stated
acceptance criteria because no step-handler module was ever written for it.

## Why this happened / root cause

BL-247 is a LIVE-PROTOCOL change whose own ticket text says "do not hot-edit
the live protocol; the pipeline builds and verifies it before it takes
effect" — but the specifier hot-edited it directly onto `main` as commit
`ed9e883165`, a single-parent commit that never passed through
coder → cleaner → architect → hardender → documenter. Writing the acceptance
step-handler module for a new/changed feature file is exactly the kind of
work normally done during that pipeline run (compare BL-243, a sibling
meta/governance ticket, which DOES have a full step-handler module,
`specs/pipeline/steps/coordinatorProvisioningSteps.js`, 202 lines, written
during its own pipeline pass). Skipping the pipeline skipped that work too,
so QA's gate — run mechanically, independent of who authored the change —
fails exactly as BL-112 intends it to.

## Secondary observation (not the bounce reason, logging for the record)

`docs/Specification.MD` (lines ~754, 778, 780, 843, 974) still describes the
OLD integration protocol ("the coordinator merges QA-approved work" / "the
coordinator integrates on main") and was not in this ticket's stated scope
(`swarmforge/handoff-protocol.md`, the constitution articles, and the
coordinator/QA/cleaner role prompts only). Per existing precedent
(BL-237's own Specification.MD contradiction was logged as out-of-scope,
unresolved technical debt rather than a blocking bounce), I am not bouncing
on this alone — flagging it here so it is not lost, since Specification.MD
now contradicts the live constitution/role prompts on who integrates to
`main`.
