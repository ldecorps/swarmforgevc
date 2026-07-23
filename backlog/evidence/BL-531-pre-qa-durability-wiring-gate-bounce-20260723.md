# BL-531 QA bounce — 2026-07-23

1. **Failing command**:
   `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-531-pre-qa-durability-wiring-gate.feature`

2. **Commit hash tested**: `4215223b52` (QA worktree tip after merging documenter's
   parcel commit `37d462fd42` and `main`; documenter's own tip carries the same
   gap — this is not a QA-merge artifact).

3. **First error excerpt**:
   ```
   not ok 14 - a ticket-naming commit that carries no dropped work does not refuse the handoff [1]
     ---
     error: 'Scenario "a ticket-naming commit that carries no dropped work does not refuse the handoff": no step handler matched "And that commit is a merge commit whose diff against its first parent is empty"'
     code: 'ERR_TEST_FAILURE'
     ...
   not ok 15 - a ticket-naming commit that carries no dropped work does not refuse the handoff [2]
     ---
     error: 'Scenario "a ticket-naming commit that carries no dropped work does not refuse the handoff": no step handler matched "And that commit has a tree identical to the commit cited in the draft"'
     code: 'ERR_TEST_FAILURE'
     ...
   # tests 15
   # pass 13
   # fail 2
   ```

4. **Failure class**: `acceptance`

5. **Expected vs observed**: Expected all 15 generated test cases (including the
   Scenario Outline `a ticket-naming commit that carries no dropped work does
   not refuse the handoff`, examples "is a merge commit whose diff against its
   first parent is empty" and "has a tree identical to the commit cited in the
   draft") to pass; observed 2 unhandled-scenario failures because
   `specs/pipeline/steps/bl531PreQaDurabilityWiringGateSteps.js` registers no
   step matching either Examples-table placeholder value of
   `And that commit <carries no dropped work>` (feature lines 106-115).

## Why this blocks

This Scenario Outline is the acceptance pin for Check A condition 5 — the
architect's own rule_proposal fix (`b7dd7276d`) for the false-positive the
architect found in `aca611925c` ("merge coder work for BL-531", empty
functional diff). The ticket's own acceptance section calls this out by name
("Every scenario needs its step handler in this same parcel — the acceptance
runner throws on an unhandled scenario (BL-233)"), and the mutation manifest
embedded in the feature file (top of file, `tested_at` stamps) lists mutation
coverage only for scenario indices 2, 6, and 9 — not this outline — which is
consistent with it never having run.

## Remedy

Add step handlers in `bl531PreQaDurabilityWiringGateSteps.js` for the two
Examples values under `And that commit <carries no dropped work>`:
- "is a merge commit whose diff against its first parent is empty"
- "has a tree identical to the commit cited in the draft"

Each should set up the git fixture state the corresponding unit case
(`pre_qa_gate_lib_test_runner.bb`, which already passes) exercises at the
`.bb` layer, then assert the handoff is sent (not refused). Per
engineering.prompt's Scenario Outline rule, validate against explicit known
values — no passthrough/binary check.

Everything else in this parcel verified clean: full unit suite (5801/5801),
property suite (32/32, including the new `siblingDeferral.property.test.js`),
`pre_qa_gate_lib_test_runner.bb` (ALL PASS), BL-532's acceptance suite (7/7),
`pre_qa_gate_lib` wiring confirmed live in `swarm_handoff.bb`'s `validate`,
and BL-532's QA.prompt wiring confirmed live. Two unrelated, pre-existing `.bb`
test failures (`prompt_engine_test_runner.bb` over the 50KB stable-prefix
budget, `standing_rule_violations_lib_test_runner.bb`) reproduce identically
on `main`'s current tip independent of this parcel — not caused by BL-531/
BL-532 and not part of this bounce.
