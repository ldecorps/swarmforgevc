# BL-1340 — architect pass, 2026-09-02

Reviewed cleaner commit `e5dc8849ea` ("cleaner pass"), forwarding coder's
`5992cbca3d..9d298f070d` (three-part fix per human ruling A) with one
trivial whitespace fix.

## The three ticket-directed changes, verified independently

1. `promotion_gates_lib.bb::pins-draft-conversion?` — reads `required_wiring:`
   as a block (line-walk, since `read-field` returns nil for blocks by
   design). `acceptance-executable-refusal` now admits a pinned draft,
   refuses a parked one by name ("parked with no conversion pinned, so not
   executable"), and still refuses a pinned-but-missing draft. Matches
   human ruling A exactly.
2. `promote_and_route_next.sh` — `is_buildable()` and the
   `buildable[]`/`other[]` pre-partition are gone; confirmed by grep (no
   hits). The whole eligible set now reaches the one chokepoint
   (`promotion_gates_cli.bb select`) undivided — invariant 2 satisfied.
3. `acceptance_contract_gate_lib.bb` — new `declaration-draft` branch, fails
   CLOSED, checked BEFORE step resolution (confirmed in source: ordered
   ahead of `wait-bound-hit?`). `pre_qa_gate_gather_lib.bb` supplies the
   fact; the gate itself stays pure (no git/fs). `acceptance_pointer_gate_lib.bb`'s
   header re-tensed to point at the new seat — confirmed by reading it.

## Contract verification
- BL-626's feature file: example row 2 (asserting the removed behaviour) is
  gone — grep for the literal old row text returns nothing. Narrative
  `Feature:` sentence re-tensed to state the current, true behavior
  (confirmed by reading it). Draft file deleted; scenarios 01-04 landed in
  the same commit as their handlers (`bl626PromotionGateSteps.js`).
  `retires:` on the ticket YAML earns the task-scope exemption for editing
  BL-626's own feature file, per the ticket's own note.

## Checks run (not assumed)
- `bb .../promotion_gates_lib_test_runner.bb` — ALL PASS.
- `bb .../acceptance_contract_gate_lib_test_runner.bb` — ALL PASS.
- `bb .../pre_qa_gate_gather_lib_acceptance_contract_test_runner.bb` — ALL PASS.
- `bb .../promotion_gates_cli_test_runner.bb` — ALL PASS.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-626-promotion-gate-rejects-unmaterialized-feature-draft.feature`
  — 10/10 scenarios pass.
- `node extension/out/tools/dependency-gate.js` on the touched TS test file
  — PASSED, no forbidden edges.
- Property test (`bl1340SelfConvertingDraftInvariants.property.test.js`,
  BL-654, both declared invariants): 3/3 pass, run 4 additional times
  (4/4 clean) with **flakiness analysis given the BL-1343 sibling finding
  earlier today**: computed the generator's reach probability by hand
  (invariant 1: independent draft/pinned booleans, per-corner P≈0.25-0.5,
  P(missed at numRuns=24) < 0.2%; invariant 2: compound reach condition
  over an array of 2-4 tickets, P(single run reaches it)≈0.28, P(missed at
  numRuns=24)≈0.04%) — materially safer than BL-1343's design because each
  ticket independently draws its own booleans rather than requiring every
  element of an array to land the same way. The cleaner independently ran
  the same 5x flakiness check and reached the same conclusion
  (`BL-1340-cleaner-20260902.md`) — cross-validated.

## Pre-existing red, corroborated
`swarmforge/scripts/test/test_promote_and_route_next_priority.sh` exits 1
— reproduced independently: its isolated fixture copies
`backlog_depth_lib.bb` but not `daemon_cycle_guard_lib.bb`, which
`backlog_depth_lib.bb` has load-filed since BL-967 (2026-08-20, confirmed
via `git blame`), well before this parcel. `grep -rl
test_promote_and_route_next_priority backlog/` returns nine independent
prior evidence files spanning back to BL-663/BL-803/BL-853/BL-854/BL-957 —
already known, already ticketed territory. Not this parcel's defect.

## Left undone, correctly scoped
BL-626's mutation-manifest stamp is left covering the pre-amendment
scenario set — confirmed this is correctly out of both coder and cleaner
scope (Guardrails article forbids hand-editing a mutation manifest); flagged
for the hardener, who is in `required_stages`.

## Constraints respected
`land_step_lib.bb` (BL-1272's fail-closed sibling rule, BL-1332) untouched —
confirmed absent from the diff. BL-1338 not landed here.

## Verdict
Clean sweep. No defect found. Forwarding to hardener.
