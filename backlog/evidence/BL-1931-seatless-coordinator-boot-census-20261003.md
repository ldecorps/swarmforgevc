# Seatless coordinator boot — census of what still expects a coordinator seat (2026-10-03)

Read-only census for the deterministic-coordinator seatless boot (BL-1125
remaining slice, split into BL-1931 launch, BL-1932 keep-alive, BL-1933
wake/inject). Line numbers are as of main 639119f16c on 2026-10-03 and will drift;
re-grep the named functions.

Only two places check `coordinator-config-lib/deterministic-coordinator?`
today, both in handoffd: the promotion hop (`handoffd.bb:2805`, BL-1846) and the
mail relay (`handoffd.bb:857`, BL-1847).

## The shaping constraint: keep the coordinator's roles.tsv row, drop only the seat

Skipping `provision_coordinator` entirely (as secondary mode does,
`swarmforge.sh:1236`) would break a first boot four ways:
- `swarm_handoff.bb:232` refuses any parcel addressed `to: coordinator` (QA
  approvals and the close guard break);
- handoffd refuses delivery (`handoffd.bb:614`);
- the BL-1847 relay looks up `(get roles "coordinator")` (`handoffd.bb:854`);
- on a rotation-router pack `is_sequential_dormant` (`swarmforge.sh:1311`)
  assumes the last role is the coordinator; without it QA becomes a second
  standing session.

Live trap on this host: `.swarmforge/launch/coordinator.sh` exists (10-03
10:20) and the launcher never deletes launch scripts (`swarmforge.sh:1443` only
`mkdir -p`), so any repair path that finds it recreates the seat.

## A. Launch path (BL-1931)

| Site | Does | Deterministic pack today | Tests |
|---|---|---|---|
| `swarmforge.sh:1188` -> `provision_coordinator` 1235-1281 (`register_role` 1280) | provisions the seat | BLOCKER: seat created | `test_coordinator_provisioned_infrastructure.sh` (secondary-mode regression at :162-178 is a template) |
| `swarmforge.sh:3042-3047` `create_role_session` loop; 3088-3104 `launch_role` loop | starts the session | BLOCKER | none |
| `swarmforge.sh:1303-1312` `is_sequential_dormant` | dormancy gate | BLOCKER if the row is removed; treating the coordinator as dormant runs 3113-3119, which writes `coordinator.sh` | `test_rotation_sequential_pack.sh`, `bl448MonoRotatePackSteps.js` |
| `swarmforge.sh:841-881` `check_local_model_seat_windows` | refuses launch | BLOCKER only if the pack keeps `coordinator_agent local-model` and that card misses the served window | `test_local_model_launch_script_dead_zone_gate.sh` |
| `swarmforge.sh:3146`, 3160-3162 | GUI terminal windows | NOISE | none |

## B. Keep-alive path (BL-1932)

| Site | Does | Deterministic pack today | Tests |
|---|---|---|---|
| `swarm_ensure.bb:1010` `ensure-role!` -> 314 -> 279-292 | respawns the seat (does not check the script exists) | BLOCKER: always creates `swarmforge-coordinator` | `test_swarm_ensure.sh` |
| `swarm_ensure.bb:1004` -> 587 `topology-action`; `mono_router_lib.bb:113-127` (resident + coordinator are "standing") | restores the standing seat (router) | BLOCKER | `mono_router_lib_test_runner.bb` |
| `babysitter_check.bb:231-241`, 1257 -> `babysitterd_sweep_lib.bb:145-149` (CRIT + repair) -> `babysitter_check.bb:1395-1405`, 1166 | repair + escalation | BLOCKER while the stale script exists (one repair per 10 min, `sweep_lib:40-41`); without it NOISE (`pane-coordinator` CRIT, operator escalation every 30 min, `REPAIR [no-launch-script]`) | `babysitterd_sweep_lib_test_runner.bb`, `bl1017…Steps.js`, `bl1169…Steps.js` |
| babysitterd control-plane recovery -> `./swarm ensure` | respawn | as the ensure rows | — |
| `launch_contract_lib.bb:57-69` via `swarm_ensure.bb:476` | gate | NOISE; if a non-claude `coordinator_agent` is kept without `coordinator_model`, ensure exits 1 and refuses every dead-pane respawn (547-552) | `launch_contract_test_runner.bb` |

## C. Wake / nudge / inject path (BL-1933)

Root cause is one function: on a router pack `handoff_lib.bb:1266-1271`
`resolve-wake-session` redirects any recipient with no session to the
resident's pane. On a standing pack it returns nil and callers skip safely.

| Site | Does | Deterministic pack today | Tests |
|---|---|---|---|
| `handoffd.bb:5663-5687` `closing-context-clear-sweep!` | injects `/clear` | BLOCKER-grade on router: `idle?` always true (the relay keeps the mailbox empty) and fullness is read from the resident pane, so every new done ticket at >=75% sends `/clear` + re-read into the resident | `test_handoffd_closing_context_clear_wiring.sh`, `closing_context_clear_test_runner.bb` |
| `babysitter_check.bb:1460` `nudge-resident! "coordinator"` (`babysitter_nudge_lib.bb:91-140`) | nudges | router: finding text goes into the resident pane (only aider seats skipped); standing: `:no-session` every sweep, dedup stamped only on success (1462) so it repeats | `babysitter_nudge_lib_test_runner.bb`, `test_babysitter_nudge_driver_seat_skip.sh` |
| `handoffd.bb:507-548` `maybe-notify!`, 709-735 `startup-notify-pending!` | wake | NOISE: a non-note parcel (e.g. `git_handoff`) wakes the resident for nothing (notes already suppressed, `mono_router_lib.bb:733-744`) | `handoff_wake_session_test_runner.bb`, `test_handoffd_wake_no_session_standing_pack.sh` |
| `babysitter_check.bb:1013-1027` `dispatch-note-pending?` | gate | NOISE (inferred): `check-resident-stranded` (`sweep_lib:521-541`) may CRIT after 10 min and nudge as above | `bl685_resident_stranded_property_runner.bb` |
| `handoffd.bb:2254` `chase-sweep!` (coordinator at 1205) | wake/rotate | only when the relay fails; rotation refused (`handoff_lib.bb:1426`): NOISE | — |

## D. Operator runtime — nothing starts/wakes/injects the seat

`relaunch-tmux!` (`operator_runtime.bb:1418-1438`) relaunches via
`swarmforge.sh`, inheriting A. `coordinator-inbox-has-fresh?` (1731) reads the
mailbox only (HARMLESS). Notes the operator sends to the coordinator
(`operator_handoff.bb:80`, `operator_runtime.bb:1117`, 1661,
`operator_file_question.bb`) are relayed back to the OPERATOR topic by BL-1847
(the human sees their own hand-offs echoed: NOISE).

## E. Other / cosmetic (later)

`model_factory_default_launch_seam.sh:47-61` waits 120 s for the coordinator
session and reports a false FAILED; `failover_to_gpt.sh:48` (codex pack only);
`swarm_status.bb:168-200` DOWN row; `open_swarm_spy_router.sh:135`,
`spy_router_pane_label.sh`, `swarm_attach.sh:87-105` cosmetic;
`relaunch_resume_cli.bb` returns a dead coordinator's claims to new mail, where
BL-1847 relays them (helpful). Extension `coordinatorLossTrigger.ts:77-90` fires
only on live-to-dead (`paneTailer.ts:539`); a never-booted seat does not
trigger it (an old seat torn down with the panel open might — speculative).

## Prose that says the coordinator always exists (specifier's to amend, BL-798)

`PIPELINE.md:10`, 13-16, 25, 79-84; `constitution/articles/reference/pipeline-detailed.md:140`,
240, 273; `swarmforge.sh:1105` (error text), comments 315, 1191-1200;
`mono_router_lib.bb:5`; Article 1.1 (`01_roles.md:3-13`) gives promotion and
bookkeeping to the coordinator, which BL-1846/1847 now do in the daemon.

## Order for a viable first boot of the all-local router pack

A (row kept, no seat) -> B (else the stale script recreates the seat within
~10 min) -> C (closing clear and coordinator nudges into the resident). NOISE
items and prose follow.
