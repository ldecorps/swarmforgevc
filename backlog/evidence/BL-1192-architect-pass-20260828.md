# BL-1192 — architect pass (re-fix), 2026-08-28

Commit reviewed: `39d237159` (coder re-fix for my own bounce
`BL-1192-architect-bounce-20260828.md`), merged via cleaner handoff
`094e6974e7`.

## D1 — rescope, re-verified against the real motivating incident

Both my earlier concerns are addressed by the new scope: the union of each
commit's own tree diff, walked first-parent from "the commit most recently
handed off for this exact task" (`salvage-lib/latest-item-handoffs`, never
grepped) up to the cited commit, counting only commits whose own message
names the task's ticket id. Sibling-ticket commits interleaved in the same
batch turn (tagged with their own id) contribute nothing.

This is a real fix, not a narrower guess: the commit message documents
re-verifying against the same `dd5b4c332` incident that produced 68
false-positive findings under the literal range — the new scope collapses
that to the single real signal. I did not independently re-run that probe
(the fixture-driven proof below covers the same claim end to end), but the
reasoning and the empirical grounding are sound and match what I asked for.

## D2 — fixture can now distinguish the two ranges

`bl1192TaskScopeGateCli.sh` gained a `batch` mode that records a real
"last handoff" boundary, commits a sibling ticket's own tagged commit in
between, then the task's own follow-up commit — the exact accumulation
shape D1 showed breaks under the literal range. New scenario 06
("sibling tickets processed in the same batch turn are never mistaken for
entanglement") exercises it directly and is explicitly framed in the
feature file's own header comment as "verified empirically against this
repo's own real cleaner batch turn." This is exactly the remediation I
asked for — the suite is no longer structurally blind to the range choice.

## Bonus catch, verified
The commit also restores `swarm_handoff.bb`'s task-scope-gate wiring
(`load-file`, `task-scope-result`/`-block`, `git-errors` entry), which the
merge that absorbed my bounce-revert had silently dropped (git accepted
the revert's deletion since the branch had made no further edits to that
region). Confirmed still present: `grep -n "task-scope"
swarmforge/scripts/swarm_handoff.bb` shows the load-file at line 22 and
the validate-path wiring at lines 400-448.

## required_wiring
`swarm_handoff.bb::task_scope_gate_lib.bb::loaded and called from validate
on every type git_handoff send` — confirmed present (see above).

## Invariants (declared)
1. Fail-open absolute (unreadable origin/main/diff/task-id/every-path) —
   confirmed by code read (`unreadable-warning` delay, nil-vs-[] handling
   in `task-tagged-changed-paths`) and scenario 05.
2. Exact-id equality via `pipeline-stage-lib/extract-ticket-id`, same
   extractor BL-953 uses — confirmed, no second parser introduced.
3. A refused send has no side effects — confirmed by scenario 02
   ("the parcel is not delivered to any mailbox").

## Verification run
- `bb swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb`: ALL PASS
  (20/20 per commit message).
- BL-1192 acceptance feature via `run_acceptance.sh`: 8/8 pass (includes
  new scenario 06).
- `test_property_suite_drift_guard.sh`: 16/16 pass.
- `test_swarm_handoff_sync_deliver.sh` / `test_swarm_handoff_daemon_backup.sh`
  (the two standing `swarm_handoff.bb` shell suites): ALL PASS both.
- Co-change report on `task_scope_gate_lib.bb`/`swarm_handoff.bb`: only
  this ticket's own step/test files and `swarm_handoff.bb`'s pre-existing,
  already-known coupling hub (handoffd, required_stages, handoff_lib,
  etc.) — nothing new attributable to this parcel.
- No TypeScript touched by this parcel; dependency gate not applicable.

D1 and D2 both fixed. NONE outstanding. Forwarding to hardener.

By architect.
