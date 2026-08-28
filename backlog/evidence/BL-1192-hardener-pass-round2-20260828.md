# BL-1192 hardener pass (round 2) — 2026-08-28

Merged architect handoff `f7aecf09cf` (BL-1192: abandoned_commits override,
architect bounce round 2 D1 re-fix). `task_scope_gate_lib_test_runner.bb`
already ALL PASS at receipt, including the two lib-level scenarios the
round-2 fix added ("abandoned base -> no findings" and its unrecorded-
abandonment converse). Acceptance feature 8/8 at receipt.

## Closed D2 (open since the coder's first rebuild, 2026-08-28)

The ticket's own notes flagged this explicitly and left it open across two
prior stages: "D2 (acceptance fixture cannot distinguish the two ranges)
remains open... left for the next stage" (coder), "D2 is now doubly
required... Keep that finding open against the rebuild" (specifier). The
round-2 architect bounce fixed the underlying correctness defect
(`abandoned_commits` was entirely unimplemented) but did not close D2 — the
lib-level bb fixtures prove the mechanism works in isolation, but nothing
proved it reachable through the REAL `swarm_handoff.sh` end to end, which is
this ticket's own `required_wiring` anchor.

Added scenario 07 to `BL-1192-pre-handoff-task-scope-gate.feature`, a new
"abandoned" mode to `bl1192TaskScopeGateCli.sh`, and step handlers in
`bl1192TaskScopeGateSteps.js`. Mirrors `task_scope_gate_lib_test_runner.bb`'s
own "abandoned base -> no findings" fixture exactly (an origin/main commit
already entangled with a foreign ticket; a disconnected orphan-branch
rebuild attempt repeating that entanglement, recorded as the last handoff;
a tip-pure rebuild back at origin/main that records the disconnected
attempt as `abandoned_commits` and touches only its own path) — but driven
through the real `swarm_handoff.bb` CLI via the existing
`bl1192TaskScopeGateCli.sh` driver, not the isolated lib.

Non-vacuity proven by hand: temporarily disabled `effective-base`'s override
(made it always return the raw base regardless of abandonment), re-ran the
acceptance suite — the new scenario failed exactly as expected (`exitCode 2`,
refused, citing the stale `BL-1185` entanglement), 8/9 pass instead of 9/9;
restored and re-confirmed 9/9 green. This is qa_e2e_procedure's own required
check 2 ("confirm a rebuild-off-main parcel with abandoned_commits recorded
passes cleanly"), now proven at the acceptance level rather than only the
bb-lib level.

Also confirmed qa_e2e_procedure check 1 (re-run against `dd5b4c332` / the
corrected range does not explode) was already satisfied by the round-2
fix's own bb-lib scenarios — not re-verified independently here since it is
a lib-level property, already covered.

## Cleanup
No orphaned test/mutation processes; both the bb-lib `with-fixture` macro
and the bash CLI's `trap cleanup EXIT` clean up their own tmp roots — 0
`bl1192`-named leaks in `/tmp` after this pass.

By hardener.
