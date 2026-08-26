# BL-660 hardener pass — three shift packs — 20260826

**Architect tip:** `7fb0a18e67`
**Task:** `BL-660-three-shift-packs-conf-selectable`

## Gates

| Gate | Result |
|------|--------|
| `swarm_shift_lib_test_runner.bb` | ALL TESTS PASSED |
| `bl660_swarm_shift_property_runner.bb` | ALL INVARIANTS PASSED |
| `test_shift_schedule_applier.sh` | ALL CHECKS PASSED |
| `swarmShiftCore.test.js` | 5/5 |
| APS BL-660 | 14/14 |
| Gherkin mutation (hard) | total=9 killed=9 survived=0 errors=0 |
| Stryker | N/A — Babashka + property runner cover shift lib; TS unit tests on `swarmShiftCore` |

## Hardening delta

- APS evening-midnight Outline: anchor/start_day/stop_day routed through allowlist maps so malformed anchor mutants fail at Given (m1/m2 were surviving).
- Merge hygiene: restored BL-728 wiring dropped by architect merge (same class as BL-588 batch).

By hardender.
