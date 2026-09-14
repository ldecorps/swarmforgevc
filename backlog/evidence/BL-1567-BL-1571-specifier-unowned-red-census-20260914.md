# BL-1567 .. BL-1571 - specifier unowned-red census, 2026-09-14

Trigger: coder `unowned-red x3` note (14:30Z, from the BL-1565 parcel), evidence
`backlog/evidence/BL-1565-unowned-red-swarm-handoff-inbound-non-forwarding-20260914.md`
on the coder branch (`d0a3809e40`, not yet on `main`). None of the three had a
row in `backlog/standing-reds.tsv`; none matched an open ticket
(`grep -rl <file> backlog/paused backlog/active backlog/hold` empty for each).

## Reproduction on `main` 674d50539a (specifier, this pass)

| file | result | first red |
|---|---|---|
| `test_swarm_handoff_inbound_non_forwarding.sh` | case 03 `expected exit 0, got 1` after `AUDIT_REQUIRED / HANDOFF_NOT_QUEUED` | 7115aa7595, 2026-09-12 (BL-1529 made the challenge exit non-zero) |
| `test_dispatch_gap_autoroute.sh` | case 01 `unexpected gaps: [{:id "BL-217", :assigned-to "coder", :status "todo"}]` | 393634823a, 2026-09-02 (BL-1301 added `:status` to `read-active-items`) |
| `test_operator_runtime_hotfix_certification_sweep.sh` | `the pre-seeded pending entry (no stamp ticket) triggered a coordinator nudge` FAIL; runtime.log carries `hotfix-certification-nudge-error 0000000001 ... FileNotFoundException: <fixture>/swarmforge/scripts/test/suite_inventory_lib.bb` from `unregistered_test_gate_lib.bb:51` | 31ffc314a0, 2026-08-31 (swarm_handoff.bb load-files the gate; the gate load-files `"test" "suite_inventory_lib.bb"` since 62109c3f75, 2026-08-30) |

### Root causes

1. **inbound_non_forwarding.** `run_send` calls `swarm_handoff.bb` ONCE per case
   with `SWARMFORGE_SKIP_DAEMON=1`. The first call of any git_handoff draft is
   the self-audit challenge (queues nothing; exits non-zero since BL-1529), so
   case 03's `[[ $rc3 -eq 0 ]]` cannot pass. Before BL-1529 the challenge exited
   0 and the case passed WITHOUT ever reaching delivery - it was vacuous from
   birth (BL-1302, 2026-08-30). A second identical call would still exit 1 in
   this fixture: no `.swarmforge/tmux-socket` is created and
   `SWARMFORGE_SKIP_DAEMON=1` turns the "tmux socket file missing" delivery
   failure fatal (`swarm_handoff.bb` -main `(skip-daemon?) (exit! 1 ...)`).
   The established escape is `test_mailbox_only_delivery.sh`'s
   `SWARMFORGE_MAILBOX_ONLY=1` with `SWARMFORGE_SKIP_DAEMON` unset, which prints
   `HANDOFF QUEUED (mailbox only, no tmux inject):`. BL-1530 fixed three files
   of this class; this one was green on 2026-09-11 only because the challenge
   still exited 0.
2. **dispatch_gap_autoroute.** `decide-dispatch-gaps` passes `read-active-items`'
   maps through unchanged; BL-1301 (393634823a) added `:status` to that reader
   for the parked-ticket sweep. Case 01 asserts exact map equality against
   `[{:id "BL-217" :assigned-to "coder"}]`. The bb runners over the same
   functions (`dispatch_gap_test_runner.bb`, `bl1097_router_dispatch_trail_test_runner.bb`,
   `bl1479_parked_active_sweep_test_runner.bb`, `dropped_parcel_test_runner.bb`)
   are all green - only the shell test pins the full key set.
3. **hotfix_certification_sweep.** The fixture's sandbox copies `swarm_handoff.bb`
   plus its derived load-file closure (`bb_load_closure_lib.bb`, JS twin
   `operatorRuntimeBbClosure.js`). Both walkers use the regex
   `\(load-file\b.*?"([^"]+\.bb)"`, which on
   `(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "test" "suite_inventory_lib.bb")))`
   captures the bare `suite_inventory_lib.bb` and drops the `test` segment
   (verified: both CLIs print `suite_inventory_lib.bb`). `copy_bb_closure`
   then `[[ -f "$src/$dep" ]] && cp` - the file is under `$src/test/`, so it
   is silently skipped. The BL-897 agreement runner passes because both twins
   agree on the wrong answer. The nudge send inside the tick throws
   FileNotFoundException and the log line the test greps for never appears.
   The multi-segment form exists exactly once in `swarmforge/scripts/*.bb`
   (`grep -rn 'load-file.*fs/path.*"[a-z_]*" "[a-z_]*\.bb"'`), reached from
   `swarm_handoff.bb` and `check_test_file_registration_cli.bb`;
   `operator_runtime.bb`'s own closure does not contain it, so the 15 JS
   handlers that copy `OPERATOR_RUNTIME_BB_FILES` by name see no subpath today.

## Census (BL-1445) - three populations, run sequentially on `main` 674d50539a

### A. Every shell test sourcing `lib/operator_runtime_sandbox.sh` (17 files)

```
grep -l 'operator_runtime_sandbox.sh' swarmforge/scripts/test/test_*.sh
```
14 green. Three more red, none owned, none registered:

| file | failure | cause | first red |
|---|---|---|---|
| `test_operator_runtime_fixture_reaper_sweep_liveness_undetermined.sh` | `the process rooted in the reaped root survives` + `records its own distinct liveness-undetermined message` | the file's header says "On this host /proc is already absent (macOS)"; on Linux/WSL `/proc` exists, liveness IS determined, the orphan is reaped. Rerun with `SWARMFORGE_PROC_DIR=/nonexistent-proc` (the seam `proc_fd_scan_lib.bb` has carried since the same commit): ALL CHECKS PASSED | 184f6ac467, 2026-08-11 (BL-877) on every Linux host |
| `test_operator_runtime_sandbox_sweep_liveness_undetermined.sh` | `a stale sandbox with nothing rooted in it is KEPT` + `records that liveness could not be determined` | same; same seam rerun: ALL CHECKS PASSED | same |
| `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh` | `bl-1159-03: down bridge uses recover (rearm) not bounce kill stub` | BL-1159 (43da3844ec, 2026-08-26 15:33) pointed `miniapp-bounce-bridge!` at `recover_miniapp_bridge.sh`; BL-653's 309e11bdef (same day, later) put `bounce_bridge_headless.sh` back and deleted the `recover-miniapp-bridge-script` def - the BL-571/BL-958 silent-revert class. `recover_miniapp_bridge.sh` is on main, unreferenced by any bb file. The `stop_bridge_headless.sh` front-desk guard from the same parcel survived, so a live bounce now runs `npm run compile` + a refused stop + a second `start_bridge_headless.sh` on the same port instead of re-arming the front desk | 309e11bdef, 2026-08-26 |

### B. Every shell test invoking `swarm_handoff.(sh|bb)` with a `type: git_handoff` draft (BL-1530's grep, 12 files today)

```
for f in $(grep -l -E 'swarm_handoff\.(sh|bb)' swarmforge/scripts/test/test_*.sh); do
  grep -q 'type: git_handoff' "$f" && echo "$f"; done
```
11 green (incl. BL-1530's three); only `test_swarm_handoff_inbound_non_forwarding.sh`
red. BL-1530 counted 11 on 2026-09-11; `test_bl1494_deferred_note_no_wake.sh`
and `test_swarm_handoff_bounce_never_stamped.sh` joined since.

Re-count 2026-09-15 on `main` 62da68ee2c (specifier, coder's priority-00 note
from the BL-1567 parcel): **13 files** - BL-1565's
`test_swarm_handoff_refuses_coordinator_git_handoff.sh` landed after the mint
and matches the predicate. BL-1567 scenario 05 amended to thirteen and pins
that file by name; ticket description amended to match.

### C. bb runners naming `dispatch-gap-items` / `read-active-items` (4 files)

All green (`dispatch_gap_test_runner.bb`, `bl1097_router_dispatch_trail_test_runner.bb`,
`bl1479_parked_active_sweep_test_runner.bb`, `dropped_parcel_test_runner.bb`).

## Owners minted this pass (all `type: defect`, `severity: high`, register rows added in the same commit)

| ticket | file(s) |
|---|---|
| BL-1567 | `test_swarm_handoff_inbound_non_forwarding.sh` |
| BL-1568 | `test_dispatch_gap_autoroute.sh` |
| BL-1569 | `test_operator_runtime_hotfix_certification_sweep.sh` (mechanism: both closure walkers + `copy_bb_closure`) |
| BL-1570 | both `*_liveness_undetermined.sh` files |
| BL-1571 | `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh` (production: BL-1159 routing restored) |

Timings measured this pass (red runs): 2.7 s, 0.1 s, 1.9 s, 1.1 s, 2.1 s, 3.2 s -
every acceptance scenario that shells one of these sits far inside the
BL-1358 per-mutant ceiling (BL-1541 rule).

Why 19 days unseen: nothing runs the standing shell suite (`suite-manifest.tsv`
`standing`, BL-1526's gap); each red surfaced only when a coder ran the file by
hand or, here, when this census ran the whole population.

## Mint-time gates (specifier, this pass)

- `gherkin_lint_gate.sh`: all five feature files parse cleanly.
- IR-DRY (`gherkin-parser` + `gherkin-ir-dry-checker`): 0/3/3/10/2 findings
  for BL-1571/1567/1568/1569/1570, all `medium` confidence, all reviewed:
  `runs` vs `is read` (a subprocess run vs a file grep), `exits zero` vs
  `exits non-zero`, and the BL-1569 outline step vs its fixed-walker sibling
  are deliberate distinctions, not drift; nothing normalized.
- `specifier_backlog_hygiene_gate.sh`: ok on all five once the features were
  staged. `pre-qa-gate-lib/read-required-wiring`: `:items` non-empty on all
  five. Strict YAML: `human_approval: pending`, no `ruling_options` (no
  choice posed), `severity: high`, `epic:`/`milestone:` set on all five.
- `standing_red_register_cli.bb`: 18 rows, `unowned: []`, oldest 7 days.
