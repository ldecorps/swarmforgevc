# BL-1626 / BL-1627 / BL-1628 - specifier adjudication of the coder's four unowned acceptance reds, 2026-09-17

Inbound: note `00_20260917T131200Z_002025_from_coder` to specifier and
coordinator, priority 00, 13:12Z: "unowned-red BL-803/1028/1100/937
acceptance fail on main, unrelated". Coder evidence (seat 1, BL-1614 pass,
untracked in `.worktrees/coder`): `BL-1614-coder-unowned-reds-20260917.md` -
found by running every feature whose handler drives route_backlog_to_coder.sh.
The coder continues BL-1614; no Article 4.2 hold is open.

## Reproduction (specifier, main 695624c52c, 14:18 local, one run each, exit 1 each)

| feature | first failing step | text |
|---|---|---|
| BL-803 | "Then the ticket file sits in backlog/active with assigned_to rewritten to coder" | `Error: no eligible paused ticket` |
| BL-1028 | "And the promotion reports failure naming lock-timeout" | `Error: no eligible paused ticket` |
| BL-1100 | "Then the ticket is promoted" | `promote rc=2 stderr=promote_and_route_next: freshness HOLD for BL-9100: interpretFreshnessCliOutput failed - fail closed` |
| BL-937 | "Given the stock system bash reports version 3.2" | `got: GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)` |

## Causes and owners

- **BL-803, BL-1028 -> BL-1626.** Hand-listed Babashka closures in the step
  handlers. bl803 copies promotion_gates_cli/lib, backlog_depth_lib,
  swarm_identity_lib (lines 27-33); backlog_depth_lib.bb has load-filed
  daemon_cycle_guard_lib.bb since BL-966 (5c8b0835f8, 2026-08-20). bl1028's
  list (lines 44-48) adds daemon_cycle_guard_lib but not
  acceptance_pointer_gate_lib.bb, load-filed by promotion_gates_lib.bb
  since BL-626 (ea14fa3039, 2026-08-25). The copied gate dies at load, so
  the promote sees no eligible ticket. BL-1538 shipped the derivation
  (`computeClosure`, `diffClosureAgainstList`, `copyScriptClosure`) and
  these two handlers never took it. Red since 08-20 and 08-25.
- **BL-1100 -> BL-1626.** The handler copies promote_and_route_next.sh
  into the fixture root (line 52); the BL-1173 freshness gate (lines
  250-274) resolves deprecate-check.js under `$ROOT` or relative to the
  script's own directory - both inside the fixture - and holds
  fail-closed when absent. Red since the gate was wired (2026-08-27).
- **BL-937 -> BL-1627.** Two causes: scenarios 01 and 03 assert the
  HOST's /bin/bash is 3.2 (handler line 133), which no Linux host
  satisfies - a host premise, not a property of the scripts; and
  scenario 02's static scan correctly flags `mapfile -t` (bash 4) at
  check_bb_scripts_load.sh:140 and check_constitution_doc_citations.sh:41,67
  - two real violations of the stock-macOS-bash-3.2 target (BL-801), both
  commit guards. The scripts are fixed; the host-premise scenarios are
  retired (never reworded), the scan stays the guard, the macOS runtime
  check becomes a macOS-only e2e step.
- **The lane gap -> BL-1628.** 1294 features under specs/features/;
  QA.prompt runs run_acceptance.sh for the ticket's features; BL-1618's
  table has acceptance-own only; no script runs the folder. Four reds
  sat three to four weeks. BL-1628 mints the recorded full-suite runner
  (per-feature rows, so a killed run keeps its partial census), the way
  BL-1619 and BL-1625 do for the property and shell lanes; where it runs
  (the night ceremony is the natural home) is the slice after its census.

## Register

Four `acceptance` rows added: BL-803, BL-1028, BL-1100 -> BL-1626;
BL-937 -> BL-1627; first_seen 2026-09-17 (first recorded sighting; the
reds date from 08-20, 08-25, 08-27 and the mapfile scripts' land). Each
leaves in its owner's land. Reader after: no unowned row.

## Pattern of the day

This is the fifth carpet found today by roles running things by hand
that no lane runs: the shell manifest (BL-1624/BL-1625), landed features
(here), plus the three earlier lane reds (bl1297, bl1309, bl1388). The
common fix is measurement-first recorders (BL-1619, BL-1625, BL-1628)
feeding lane-set rows minted from their census - never a lane added
blind to a table the human just asked to shrink.

By specifier.
