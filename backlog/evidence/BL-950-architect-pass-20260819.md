# BL-950 architect pass — 2026-08-19

Reviewed commit: 19bec94d8f (via cleaner's merge 1231839c95).

## Dependency-rule gate (BL-259, hard gate)
`node extension/out/tools/dependency-gate.js` against the parcel's changed
JS files reports the same 3 pre-existing telegram-front-desk-bot/
operatorExec/operatorLiveness acyclic violations seen on BL-947's and
every other recent pass — none involve any file this parcel touches.
Already confirmed pre-existing and now confirmed TICKETED: BL-759
(`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml`),
per the specifier's correction to my earlier note (I had wrongly called it
unticketed — corrected, no duplicate filed). Not a BL-950 defect.

## Co-change report (informational)
`bl950QaApprovalEvidenceCommitSteps.js` co-changes only with its own
ticket's files (index.js, the gate lib, its two bb test runners) — 1 each,
no suspected coupling.

## Core logic review
`review_forward_evidence_gate_lib.bb`: `qa-approval-hop?` is a narrow,
correct new direction predicate (`sender = "QA" AND recipient =
"coordinator"`, nothing else), OR-ed into `blocked?`'s existing direction
conjunct without touching `required_stages_lib/canonical-order` — verified
this matters: the ticket's own probe (`routes-forward? "QA" "coordinator"`
= false) is why a `review-roles` widening alone would have been a no-op,
and the coder correctly avoided that dead-end and confirmed the probe
before implementing. The four existing review roles' behavior is
unchanged (still gated only via `review-roles` + `routes-forward?`);
`qa-approval-hop?` is purely additive. Fail-open (invariant 2) is
preserved: `received-commit-for-task` still returns nil on every
nothing-to-compare shape, and nil can never `=` a validated non-blank
commit.

## Invariants (both declared, BL-654)
Both encoded in `review_forward_evidence_gate_lib_property_runner.bb`,
verified running (`bb .../review_forward_evidence_gate_lib_property_runner.bb`
→ ALL PASS):
- Broad-generator oracle (`expected-blocked?`) restated independently (not
  copied from `blocked?`), extended for the widened refusal surface;
  `coordinator` added to the stage pool so the space can even generate the
  new shape.
- A genuine reachability defect was found and fixed during authoring: the
  broad generator hits the exact QA-hop refused shape at ~1-in-9000 per
  run, so a gate with the `qa-approval-hop?` disjunct deleted still passed
  1000 broad runs at the fixed seed (the "technically reachable but
  astronomically rare" failure the coder's own prompt names). Fixed with a
  by-construction generator that fixes sender/recipient/type to the hop
  and asserts BOTH the refused shape and the exclusion shapes are actually
  reached (`qa-hop-refused-shapes-reached` / `qa-hop-excluded-shapes-reached`
  atoms, checked non-zero) — reachability is proven, not assumed. Verified
  non-vacuous against the deleted-disjunct gate per the commit message.

## Unit/property/acceptance runs (all reproduced live, not taken on faith)
- `bb test/review_forward_evidence_gate_lib_test_runner.bb`: ALL PASS
  (existing BL-806 rows + 7 new BL-950 rows, per commit message).
- `bb test/review_forward_evidence_gate_lib_property_runner.bb`: ALL PASS.
- `node specs/pipeline/cli.js
  specs/features/BL-950-qa-approval-carries-its-own-evidence-commit.feature`:
  6/6 scenarios pass.

## Step handler review
`bl950QaApprovalEvidenceCommitSteps.js` uses raw `fs.mkdtempSync` +
`afterEach`-tracked cleanup rather than the shared `extension/test/`
`mkTmpDir()` helper or `fixtureReaper.js`. Checked against precedent
before treating this as a defect: `bl806ReviewForwardEvidenceGateSteps.js`
(the file this ticket explicitly extends) uses the identical
`mkdtempSync` + `afterEach` pattern, no tmux/detached process (spawnSync
only, no reaper needed), and the `tmpDirMigrationGuard.test.js` scope from
BL-945's own D1 fix is `extension/test/` only — this file lives under
`specs/pipeline/steps/`, outside that guard's scope. Consistent with the
established, already-accepted convention for this file family — not a new
defect. `afterEach` unconditionally drains `trackedRoots` regardless of
test outcome, satisfying the engineering rule's intent (leak-proof
teardown) without a literal try/finally.
KNOWN_VALUES discipline confirmed: `SEND_BUILDERS[send](ctx, task)` throws
on an unrecognized Scenario Outline row (no passthrough/default).
No `vscode` import.

## Verdict
COMPLIANT. Forwarding to hardener.
