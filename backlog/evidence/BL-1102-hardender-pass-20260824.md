# BL-1102 — hardener pass, 2026-08-24

## Inbound

Merged architect `350e3f5365` (restore of spawn-failure tip after silent
revert drop; on cleaner `212b012649` / coder `31dce875c1`) into
`swarmforge-hardender`.

## Scope

`daemon_cycle_guard_lib.bb` `sh!` returns `{:exit 127 :spawn-failed? true …}`
on spawn failure instead of throwing. Parcel is `.bb` + APS + property —
no `extension/src/**`. Stryker/CRAP/DRY N/A (degraded `.bb` gate).

Stamp-off hygiene: all six HOTFIX_PATHS still `git diff --quiet 27273f2b0a`.

## Host

Load ~2.2 on 20 cores (quiet / under 2× busy).

## Process fix this pass

Architect restore tip re-registered
`require('./bl1110HandoffdHeartbeatSteps')` in `specs/pipeline/steps/index.js`
after BL-1110 had been reverted and the module deleted. Acceptance and
`bl968StepRegistryMaterializedTreeGuard` both failed to load the registry.
Stripped the hitchhiker; DOMAINS keeps `bl1102SpawnFailureSteps` only.

## BL-113 Gherkin (soft)

```
total=3 completed=3 killed=3 survived=0 errors=0
outcome: "pass"
```

Manifest stamped on the Outline scenario.

## Hand-authored surgical (`sh!` spawn path)

| # | Mutant | Result |
|---|--------|--------|
| M1 | `:spawn-failed? true` → `false` | killed (unit) |
| M2 | exit 127 → 0 | killed (unit) |
| M3 | exit 127 → 124 | killed (unit) |
| M4 | `(spawn-failure-result e)` → `(throw e)` | killed (unit) |
| M5 | catch rethrows instead of `::spawn-failed` | killed (unit) |
| M6 | omit `:spawn-failed?` key | killed (unit) |

Survivors: 0.

## Verification

- Unit: `daemon_cycle_guard_lib_test_runner.bb` → ALL PASS
- Acceptance: 6/6
- Properties: 3/3
- Standing whole-tree guards: 13 files / 125 tests pass
- CRAP / DRY / Stryker: N/A

## Findings

NONE (after hitchhiker strip).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1102-bounded-sh-throws-on-spawn-failure`.

By hardender.
