# BL-854-orthogonality-advises-instead-of-blocking-on-the-epic-tag — hardener pass — 20260809

Commit reviewed: `944c9846a8` (architect's forward, `merge_and_process architect
944c9846a8`, batched with BL-717). Merged into this branch as `59daba81`
("Merge architect handoff for BL-854 and BL-717") before any check below was
run (ancestry confirmed via `git merge-base --is-ancestor 944c9846a8 HEAD`).

## Tooling note (engineering.prompt Startup Tools)

This ticket's production code is entirely Babashka/Clojure
(`swarmforge/scripts/promotion_gates_lib.bb`, `promotion_gates_cli.bb`,
`promote_and_route_next.sh`). Per the Startup Tools table, mutation/CRAP/DRY
tooling is NOT wired for `.bb` — the actual gate is the project's own unit
test suite under `swarmforge/scripts/test/`. No tool was fabricated; the
suites below are the real gate for this pass.

## BL-149 cooldown gate

Ran `bb swarmforge/scripts/mutation_cooldown_gate.bb <root> <file>`
(`SWARMFORGE_MUTATION_GATE_FORCE_CORES=4` workaround, BL-797, no `nproc` on
macOS) for all three changed production files:

- `promotion_gates_lib.bb`, `promotion_gates_cli.bb`, `promote_and_route_next.sh`
  — all `DECISION: skip-cooldown` (file_age_days 0.17-0.18 of a 3-day
  window). Moot in practice since no `.bb` mutation tool exists, but recorded
  per the gate's own contract.

## Suites run (all green)

- `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb` — `ALL
  PASS: promotion_gates_lib.bb`
- `bb swarmforge/scripts/test/promotion_gates_lib_property_runner.bb` — `ALL
  PROPERTIES HOLD` (500 runs each; generator coverage confirmed both
  refused/ok and expedited/none-expedited and multi-id-advisory branches were
  actually exercised, not just nominally run)
- `bb swarmforge/scripts/test/promotion_gates_cli_test_runner.bb` — `ALL
  PASS: promotion_gates_cli.bb` (asserts the `ADVISORY|...` line on stderr
  and the unchanged stdout verdict separately, per the ticket's own test-seam
  note)
- `bash swarmforge/scripts/test/test_promote_and_route_next_priority.sh` —
  `ALL PASS`
- `bash swarmforge/scripts/test/test_promote_and_route_next_no_limit_depth.sh`
  — `ALL PASS` (BL-853 sibling depth-cap suite, unaffected by this parcel,
  re-run as a regression check since both edit the same file)

## Acceptance

`specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-854-orthogonality-advises-instead-of-blocking.feature` —
8/8 scenarios pass, including scenario 04 ("an advisory never changes which
candidate is selected... its advisory is reported once for the promoted
ticket"), which is the only exercise of `promote_and_route_next.sh`'s own
ADVISORY-printing wiring (no dedicated shell-level test exists for that one
line beyond the acceptance scenario — sufficient per the ticket's own test
seam, which drives the real CLI, not a JS reimplementation).

## Findings

NONE. No survivors to kill (no mutation tool for `.bb`), suites and
acceptance already fully green, no CRAP/DRY tooling applicable to this
file type.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-854-orthogonality-advises-instead-of-blocking-on-the-epic-tag`.

By hardender.
