# BL-1538 / BL-1539 / BL-1540 / BL-1541 — specifier unowned-red census, 2026-09-11

Trigger: one coder `unowned-red` note, 16:04Z, priority 00:
`unowned red bl1028_promotion_refusal_property_runner.bb: P0 fails on main`.
No row in `backlog/standing-reds.tsv` for that file; no open ticket names it
(`grep -rln bl1028_promotion_refusal_property_runner backlog/active
backlog/paused backlog/hold` empty). BL-1496 (paused, approved) owns the
SIBLING shell fixture of the same surface and the same rot, but its census
grepped `swarmforge/scripts/test/*.sh` only, so this `.bb` runner was never
counted.

Every run below is on `main` 84067ea1ce (`main...origin/main` 0/0).

## 1. bl1028_promotion_refusal_property_runner.bb → BL-1538

```
FAIL P0 (control: an accepted promotion really does commit in this fixture)
  exit=1 head-moved=false
FAIL coverage: the generator reached :control-commit only 0 time(s), floor 1
2 failure(s)            exit 1, 2.5 s
```

Cause: `make-fixture!` (runner lines 94-96) copies a hand list of five `.bb`
files - `promotion_gates_cli.bb promotion_gates_lib.bb backlog_depth_lib.bb
swarm_identity_lib.bb daemon_cycle_guard_lib.bb`. `promotion_gates_lib.bb`
has since gained three `load-file` edges: `acceptance_pointer_gate_lib.bb`
(ea14fa3039, BL-626, 2026-08-25), `headroom_cap_raise_lib.bb` (798c6d630e,
BL-1128, 2026-08-25), `slice_size_envelope_gate_lib.bb` (392e2cbf89,
BL-634, 2026-08-27). Replicated with the same five files in a scratch root:

```
Type:     java.io.FileNotFoundException
Message:  .../swarmforge/scripts/acceptance_pointer_gate_lib.bb (No such file or directory)
Location: .../swarmforge/scripts/promotion_gates_lib.bb:30:1
```

The runner's own design caught it: P0 is a control that an ACCEPTED
promotion really commits. Without P0 every refusal property (P1-P3) passes
vacuously - a promotion that dies at load also produces no commit and leaves
the index alone. The full closure today
(`bb swarmforge/scripts/bb_load_closure_cli.bb swarmforge/scripts
promotion_gates_cli.bb`) is 8 files: the five listed plus the three above.

Census (BL-1445): bb runners under `swarmforge/scripts/test/` naming the
promotion surface (`grep -ln 'promotion_gates\|promote_and_route_next'
*.bb`) = 11; bb runners that `fs/copy` files into a fixture = 5. Each run:

| runner | exit | note |
|---|---|---|
| bl963_nudge_gate_chain_property_runner | 0 | |
| bl1469_not_before_promotion_gate_property_runner | 0 | |
| bl626_acceptance_executable_property_runner | 0 | |
| **bl1028_promotion_refusal_property_runner** | **1** | this section |
| expedite_lib_test_runner | 0 | |
| dispatch_gap_test_runner | 0 | |
| mono_router_lib_property_runner | 0 | |
| promotion_gates_cli_test_runner | 0 | |
| promotion_gates_lib_property_runner | 0 | |
| promotion_gates_lib_test_runner | 0 | |
| land_step_lib_test_runner | 0 | |
| bl998_guard_membership_property_runner (fs/copy) | **1** | §2, different cause |
| bl1033_temp_root_cleanup_property_runner (fs/copy) | 0 | |
| bl983_stage_queue_property_runner (fs/copy) | **1** | §4, different cause |
| pre_qa_gate_gather_lib_acceptance_contract_test_runner (fs/copy) | 0 | |

Only bl1028 is the closure-rot shape among bb runners. The closure guard
(`specs/pipeline/steps/lib/bbFixtureClosureGate.js`) has kinds `module`,
`vitest-module`, `shell-copy`, `shell-sandbox` - none can read what a
bb-authored fixture copies, so this runner could not have been enrolled
even if someone had tried.

## 2. bl998_guard_membership_property_runner.bb → BL-1539

```
FAIL membership  case: {:helper "ready_for_next.bb", :helper-kind :direct, :anchor :real-dir, :executed? true ...}
  expected flagged=true got=false
FAIL membership  case: {:helper "done_with_current.bb", :helper-kind :direct, :anchor :real-dir, :executed? true ...}
  expected flagged=true got=false
4 property check(s) failed          exit 1, 5 s
```

The runner copies seven real helpers into a sandbox and drives the REAL
guard `swarmforge/scripts/test/test_shell_fixture_dispatch_isolation.sh`
(unchanged since 2026-08-21, 19e0ad093f). Reproduced by hand: a test file
binding `H1_VAR="$SCRIPT_DIR/../ready_for_next.bb"` and executing it is
answered `PASS: no shell test dispatches ...`, exit 0. `bash -x` shows the
derivation's `SELF_ROOTING` set is `ready_for_next_batch.sh
ready_for_next_task.sh` only - neither `.bb` dispatcher.

Two independent causes, both in the guard's step 1
(`self_rooting_scripts`, `code_only "$f" | grep -qE "$SELF_ROOTING_RE"`
under `set -euo pipefail`):

- **SIGPIPE under pipefail.** `grep -q` exits at its first match; `sed`
  is still writing the rest of a 16 377-byte file and dies with SIGPIPE;
  under `pipefail` the pipeline reports 141 and the `if` reads it as "no
  match". Measured: the -q form kept `ready_for_next.bb` 0 of 20 times on
  the real file and 1 of 20 in the sandbox; the same pipeline with `grep
  -E ... >/dev/null` (no early exit) kept it 20 of 20. Over the real
  scripts dir the guard therefore ALSO derives today without
  `ready_for_next.bb` - a test executing it through the real dir would go
  unflagged. Onset: the file grew past the race window as BL-1237/BL-1266
  (2026-08-29) and BL-1515 (2026-09-11) added guards to it.
- **Regex gap.** `SELF_ROOTING_RE` names `run-dispatch!`;
  `done_with_current.bb` has called `dispatch-lib/run-dispatch-forwarding-args!`
  since 206381f7e9 (BL-652, 2026-08-25), which does not contain that
  substring. Deterministic; `first_seen` for the row is that date.

Census: over the real scripts dir the derivation finds 31 self-rooting
scripts today, 31 with the pipe fixed, 32 with the regex extended (the
one addition is `done_with_current.bb`; `run-dispatch-forwarding-args!` is
defined in `dispatch_lib.bb` and called only there).

## 3. test_shell_fixture_dispatch_isolation.sh → BL-1540

The guard itself is red on `main`:

```
FAIL: these shell tests execute a self-rooting helper from the REAL scripts dir,
        test_bl1097_router_refuses_dispatched_ticket.sh:$ROUTE_SH -> route_backlog_to_coder.sh
        test_ceremony_handoff_cli.sh:$CEREMONY -> ceremony_handoff.sh
exit 1
```

Both are genuine offences by the guard's rule (a helper that
`cd "$(dirname "$0")"`s, executed through `$SCRIPT_DIR/../`):
`test_ceremony_handoff_cli.sh` line 19/61 (0ad07895b1, BL-1360,
2026-09-03) and `test_bl1097_router_refuses_dispatched_ticket.sh` line
21/45 (3c8e08e3e4, BL-1415, 2026-09-05). Both postdate the guard; the
guard runs in no standing lane, so nothing said so. `first_seen`
2026-09-03. Previewed with §2's two fixes applied to a scratch copy of the
guard: the offender list is the SAME two files - repairing them greens the
guard both before and after BL-1539 lands.

## 4. five bb runners drafting a `git_handoff` → BL-1541

Census: bb runners invoking `swarm_handoff.bb` = 28; of those, drafting
`type: git_handoff` = 12. Each run:

| runner | exit | failure |
|---|---|---|
| **bl983_stage_queue_property_runner** | **1** | every draw `N parcels sent but 0 accounted for`, `redeliver`/`forward` coverage 0 of 16 |
| **bl982_multi_seat_identity_property_runner** | **1** | `stage-addressed parcel did not land in the bare seat's inbox` every draw |
| **bl992_declaration_ref_lookup_property_runner** | **1** | dies printing the audit challenge text |
| **bl991_binding_stages_property_runner** | **1** | `Cannot open <nil> as a Reader` at send! line 176 (slurps the queued file named in the CLI output; none) |
| **bl951_stage_skip_recording_property_runner** | **1** | same, line 120 |
| bl1306_audit_reroute_test_runner | 0 | tests the two-call audit itself |
| tree_collapse_guard_lib_test_runner | 0 | |
| handoff_lib_test_runner | 0 | |
| pre_qa_gate_lib_test_runner | 0 | |
| bl1494_deferred_note_no_wake_property_runner | 0 | |
| ceremony_handoff_lib_test_runner | 0 | |
| duplicate_chain_guard_lib_test_runner | 0 | |

Cause, replicated with bl983's exact shape (fixture git root, roles.tsv,
one `git_handoff` draft under the sender's seat dir, ONE real
`swarm_handoff.bb` call): the CLI prints the self-audit challenge, exits
0, and queues nothing. 44d2d42591 (2026-08-30, "two-call AUDIT_REQUIRED")
answers the first invocation of a `git_handoff` draft fingerprint with
`AUDIT_REQUIRED` / `HANDOFF_NOT_QUEUED`; all five runners predate it and
assert the queue after one call. Same landing as BL-1529's two shell rows;
different site (the runners are the senders, not a script verb), so a
separate owner. `first_seen` 2026-08-30 for all five.

## Register

Eight rows added in the mint commit: bl1028 runner (BL-1538), bl998 runner
(BL-1539), the guard (BL-1540), five runners (BL-1541). All lanes `bb`
except the guard (`shell`). `bb swarmforge/scripts/standing_red_register_cli.bb .`
reported `"unowned":[]` before and after (rows name open paused tickets).
