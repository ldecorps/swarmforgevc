# BL-1524 / BL-1525 / BL-1526 - specifier mint evidence: the daemon_cycle_guard_lib_test_runner.bb standing red, 2026-09-11

Answers the coder's `unowned-red` note of 2026-09-11 00:10Z from the BL-1478
parcel (`.worktrees/coder` evidence `BL-1478-unowned-red-coder-20260911.md`).

## Reproduction on main

`bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb` on main
`7c5e39a8b4`: three FAIL lines, exit 1. Same three at `5e4fb269d6` (the
parent of hotfix 32fb1ff7e1), so the hotfix is not the origin; it only added
handoff_lib.bb to the first list.

```
BL-1022 closure: 95 files (1 entrypoint, 4 reached by spawn), non-bb spawns recorded: #{"kill_all_swarm.sh" "is_qa_ancestor.sh"}
BL-1031 spawn-only banned-API debt: ["bounded_run_lib.bb" "expedite_cli.bb" "ticket_close_guard_lib.bb" "unregistered_test_gate_lib.bb"]
FAIL invariant 1 structural half: no subprocess path outside the chokepoint anywhere in handoffd.bb's reachability closure
  actual: handoff_lib.bb:9/:1177, model_factory_store.bb:18/:106, outage_failover_store.bb:6/:90, process_table_lib.bb:9/:132
FAIL bl1022: every spawn target in the daemon's closure resolved - an unresolvable one fails loudly, never silently
  actual: [{:from "handoffd.bb", :target "launcher"} {:from "handoffd.bb", :target "script"} {:from "chase_sweep_lib.bb", :target "cli"} {:from "expedite_cli.bb", :target "runner"}]
FAIL bl1031: spawn-reachable subtree carries no banned-API debt (ratchet retired empty)
  actual: #{"bounded_run_lib.bb" "expedite_cli.bb" "ticket_close_guard_lib.bb" "unregistered_test_gate_lib.bb"}
```

The BL-1031 acceptance feature drives the same runner from its scenario 01:
`node specs/pipeline/cli.js specs/features/BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree.feature`
on main 7c5e39a8b4 -> pass 6 / fail 1 (`no file the daemon can reach carries
an unbounded subprocess call`, "gate failed" with the three lines above).
Second register row, acceptance lane.

## Last known green, and three bisects

Green on 2026-08-22 (BL-1010 architect and hardener evidence: `ALL PASS`,
54-file closure). The runner file itself last changed 2026-08-24
(3d5346c256, BL-1031). Three `git bisect run` passes in a detached scratch
worktree (the runner resolves its tree relative to its own `*file*`, so a
worktree checkout is a faithful subject), all from `3d5346c256` (good) to
`5e4fb269d6` (bad):

| assertion | predicate | first bad commit |
|---|---|---|
| invariant 1 structural half (load closure) | runner exit status | `ceda945b23` 2026-08-25 "refactor(BL-1134): share process-table for post-add mute" - load-files `process_table_lib.bb` into `master_checkout_drift_lib.bb`; at that commit the offender list is process_table_lib.bb alone, closure 59 files |
| bl1022 unresolved spawn targets | grep `^FAIL bl1022: every spawn target` | `306509a6b0` 2026-08-25 "fix(BL-1139): auto-repair durable master-checkout daemon-script drift" - `(let [launcher ...] (sh! ["bash" launcher root]))` |
| bl1031 spawn-subtree debt | grep `^FAIL bl1031: spawn-reachable` | `abdf283ece` 2026-09-03 "BL-1378: tip-pure replay onto origin/main" - ticket_close_guard_lib.bb gains two `process/sh git` calls, loaded by the daemon-spawned swarm_handoff.bb |

## Reach map on main 7c5e39a8b4

Computed with `master-checkout-drift-lib/resolve-daemon-reachability` from
`handoffd.bb` (closure 95, load-only closure 67):

```
process_table_lib.bb        <- [:load master_checkout_drift_lib.bb]
handoff_lib.bb              <- [:load handoffd.bb] and 14 other loaders
model_factory_store.bb      <- [:load outage_failover_cli.bb]
outage_failover_store.bb    <- [:load outage_failover_cli.bb]
ticket_close_guard_lib.bb   <- [:load swarm_handoff.bb]
unregistered_test_gate_lib.bb <- [:load swarm_handoff.bb]
expedite_cli.bb             <- [:spawn handoffd.bb]   (handoffd.bb line 4249)
bounded_run_lib.bb          <- [:load expedite_cli.bb]
```

## Why no existing ticket owns it

- `backlog/standing-reds.tsv`: no row for the runner or for the BL-1031
  feature.
- BL-1364's architect (2026-09-05) and hardener saw the identical three
  failures, proved their parcel was not the cause by reverting handoffd.bb,
  and wrote "already tracked in BL-1331/BL-539". BL-1331 is the bl726
  TypeScript require-cycle defect; it names this runner nowhere. BL-539 is
  the epic tracker; its `remaining_slices` name it nowhere.
- Grep over `backlog/active`, `backlog/paused`, `backlog/hold` for
  `daemon_cycle_guard`: BL-1478 (active, adds `run-compiled-tool!`, does not
  touch the failing assertions), BL-1496/BL-1500/BL-1503 (fixture copy
  lists only). The four hotfix stamp tickets BL-1504..BL-1508 name neither
  `babashka.process` nor the chokepoint.
- Why it stayed hidden: `run_bb_suite.sh` (the standing bb lane) is run by
  no commit guard and no role prompt (`grep -rn run_bb_suite
  swarmforge/scripts/*.sh swarmforge/roles/*.prompt` is empty outside the
  test directory). The runner executes only when a parcel's own
  `qa_e2e_procedure` names it, which BL-1478's does. This is a process
  finding, not ticketed here.

## Disposition

Three defects with three origins and three fix shapes: minted as three
`type: defect`, `severity: high` slices (standing-red rule 2026-09-05),
each gateable on its own assertion:

- **BL-1524** load-closure strays (4 files) through the chokepoint.
- **BL-1525** spawn-subtree debt (3 plain waits + a human ruling on the
  second bounded runner, `ruling_options`).
- **BL-1526** the four unresolvable spawn targets; `depends_on` the other
  two and carries BOTH register rows (bb lane: the runner; acceptance lane:
  BL-1031's feature), first_seen 2026-08-25, so the rows name an open ticket
  until the file is green.

Scratch worktrees used for the bisects were removed after the run.

By specifier.
