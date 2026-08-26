# BL-1162 hardener pass — start/stop swarm cron lifecycle symmetry — 20260826

**Architect tip:** `1c47af8664`
**Task:** `BL-1162-start-stop-swarm-cron-lifecycle-symmetry`

## Merge

- `merge_and_process architect 1c47af8664` — conflicts resolved in
  `specs/pipeline/steps/index.js`, `Specification.MD`, BL-588 feature stamp;
  kept bl1162 handler registration + BL-653/BL-1159 spec changelog entries.

## Gates

| Gate | Result |
|------|--------|
| `test_bl1162_start_stop_swarm_cron_lifecycle.sh` | ALL CHECKS PASSED |
| `bl1162_swarmforge_cron_property_runner.sh` | ALL CHECKS PASSED (13 checks) |
| APS BL-1162 | 4/4 scenarios |
| Gherkin mutation | inapplicable (no Scenario Outline) |
| Surgical mutation sweep | 7/7 killed |

## Hardening added

- Property runner: marker-only freshness line, shift-schedule bracket markers,
  `swarmforge_cron_root_has_lines` positive/negative cases.
- `bl1162_swarmforge_cron_mutation_sweep.sh`: surgical mutants over
  `swarmforge_cron_lib.sh`, `legacy_operator_schedule_lib.bb`,
  `uninstall_swarmforge_crons.sh`, `stop-swarm.sh`.

Pass → documenter.
