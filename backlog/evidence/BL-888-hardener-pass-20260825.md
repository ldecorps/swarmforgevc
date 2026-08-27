# BL-888 hardener pass — 20260825

**Architect tip:** `3f1c582fcb`
**Task:** `BL-888-teardown-copilot-pkill-unscoped-kills-siblings`

## Product surface

Root-scoped copilot teardown kill in `kill_pipeline_swarm.sh`
(`copilot_argv_matches_root` / `copilot_pids_for_root` /
`reap_copilot_pid` + `SWARMFORGE_COPILOT_PS_FILE` seam). Shell-only —
no Stryker/CRAP/DRY wired (Engineering Rules degraded fallback for
Babashka/shell).

## Gates

| Gate | Result |
|------|--------|
| Unit `test_kill_pipeline_copilot_scope.sh` | ALL PASS (01–06) |
| Property `bl888_copilot_kill_scope_property_runner.sh` | ALL PROPERTIES HOLD (200 runs) + non-vacuity vs broken oracle |
| APS `BL-888-teardown-copilot-kill-scope.feature` | 3/3 passed |
| Soft Gherkin mutation | total=6 killed=6 survived=0 errors=0 `outcome: pass` |
| BL-637 lifecycle `test_lifecycle_script_scope.sh` | PASS=15 FAIL=0 |
| Standing Guard scans (parcel touched `specs/pipeline/steps/`) | tmuxReaper / bl968 / bl643 green; tmpDirMigration / tempDirTrap / socketFixture reds are outside parcel (BL-1112 step + extension/test / scripts debt — presumed ticketed per BL-1063) |

## Soft Gherkin

All three Outline columns load-bearing (`KNOWN_PROCESS_ROOT`,
`KNOWN_FATE`, literal log-line assert). Manifest stamped in the feature
file (`tested_at` 2026-08-25T13:35:18Z).

## Surgical mutants (restored; shell / no Stryker)

| Mutant | Verdict |
|--------|---------|
| drop-root-anchor (unscoped copilot+SwarmForge) | killed |
| drop-swarmforge-marker | killed |
| drop-copilot-token | killed |
| pids-always-empty (skip printf) | killed |
| ignore-ps-file-seam | killed |
| always-no-copilot-log | killed |

`mutants: killed=6 survived=0 skipped=0`

## Forward

`git_handoff` to `documenter`, priority `00`, same task name.
Authorize BL-888 paths only.

By hardender.
