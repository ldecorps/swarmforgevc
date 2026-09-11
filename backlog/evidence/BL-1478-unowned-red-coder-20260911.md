# BL-1478 coder pass — unowned red found in daemon_cycle_guard_lib_test_runner.bb, 2026-09-11

While implementing BL-1478 (`run-compiled-tool!` in
`swarmforge/scripts/daemon_cycle_guard_lib.bb`), running the ticket's own
`qa_e2e_procedure` step 1 (`bb swarmforge/scripts/test/daemon_cycle_guard_lib_test_runner.bb`)
surfaced three pre-existing failures unrelated to this ticket's change:

```
FAIL invariant 1 structural half: no subprocess path outside the chokepoint anywhere in handoffd.bb's reachability closure
  expected: []
  actual:   ["handoff_lib.bb:9: [babashka.process :as process]" "handoff_lib.bb:1177: (process/process argv {:out :discard :err :discard}))" "model_factory_store.bb:18: [babashka.process :as process]" "model_factory_store.bb:106: (:exit @(process/process [seam-path (json/generate-string plan)]" "outage_failover_store.bb:6: [babashka.process :as process]" "outage_failover_store.bb:90: @(process/process [\"\" \"\" socket \"\" \"\" \"\" (str role \"\")" "process_table_lib.bb:9: [babashka.process :as process]" "process_table_lib.bb:132: (let [{:keys [out]} (process/sh {:continue true} \"\" \"\" \"\" (str pid) \"\" \"\" \"\")]"]

FAIL bl1022: every spawn target in the daemon's closure resolved - an unresolvable one fails loudly, never silently
  expected: []
  actual:   [{:from "handoffd.bb", :target "launcher"} {:from "handoffd.bb", :target "script"} {:from "chase_sweep_lib.bb", :target "cli"} {:from "expedite_cli.bb", :target "runner"}]

FAIL bl1031: spawn-reachable subtree carries no banned-API debt (ratchet retired empty)
  expected: #{}
  actual:   #{"bounded_run_lib.bb" "expedite_cli.bb" "ticket_close_guard_lib.bb" "unregistered_test_gate_lib.bb"}
```

## Why this is not BL-1478's

BL-1478's change touches only `daemon_cycle_guard_lib.bb` (adds
`run-compiled-tool!`) and the four sweep call sites in `handoffd.bb`
(`resource-sample-sweep!`, `context-telemetry-producer-sweep!`,
`turn-profile-producer-sweep!`, `ritual-ledger-producer-sweep!`) — no new
`require`, `load-file`, or spawn edge was added anywhere. The failing gate
is a structural BFS over handoffd.bb's whole load-file/spawn closure
(`master_checkout_drift_lib`) checking for banned subprocess APIs
(`babashka.process`, `clojure.java.shell`) outside the
`daemon_cycle_guard_lib.bb` chokepoint, in files this ticket never opens:
`handoff_lib.bb`, `model_factory_store.bb`, `outage_failover_store.bb`,
`process_table_lib.bb`, plus unresolved spawn targets from `handoffd.bb`,
`chase_sweep_lib.bb`, `expedite_cli.bb`, and banned-API debt in
`bounded_run_lib.bb`, `expedite_cli.bb`, `ticket_close_guard_lib.bb`,
`unregistered_test_gate_lib.bb`.

## Search for an existing owner

Grepped `backlog/standing-reds.tsv` for `daemon_cycle_guard_lib_test_runner`,
`bl1022`, `bl1031` — no row. Grepped `backlog/active`, `backlog/paused`,
`backlog/done` for the named files (`process_table_lib`,
`outage_failover_store`, `model_factory_store`, banned-API) — nothing open
owns this closure-gate failure.

## Disposition

Filing as an `unowned-red` `note` (priority 00) to specifier and
coordinator per the standing-red rule (2026-09-05) and continuing BL-1478's
own work — QA will not approve BL-1478 over this unless it is registered
with an owning ticket by the time BL-1478 reaches QA.

By coder.
