# BL-1110 — hardener pass, 2026-08-24

## Inbound

Merged architect `f9117f1ffa` (restore after silent revert drop; on cleaner
`5078b3d812` / coder `15e4c5da77`) into `swarmforge-hardender`. Index now
registers both `bl1102SpawnFailureSteps` and `bl1110HandoffdHeartbeatSteps`.

## Scope

`daemon_log_freshness_check.sh`: mid-cycle `handoffd.sweep-marker` suppress
(`suppress-in-sweep`) when in-flight under budget; conf stays `handoffd|120`.
APS + property. No `extension/src/**` — Stryker/CRAP/DRY N/A.

## Host

Load quiet (~2 on 20 cores).

## Process fix this pass

`bl1110HandoffdHeartbeat.property.test.js` used raw `fs.mkdtempSync` —
`tmpDirMigrationGuard` RED. Switched to shared `mkTmpDir`. Guards 125/125.

## BL-113 Gherkin

`outcome: "inapplicable"` (plain Scenarios only). Fell back to hand-authored
surgical on the checker (BL-638).

## Hand-authored surgical (`in_flight_sweep_under_budget` / suppress)

| # | Mutant | Result |
|---|--------|--------|
| M1 | age check always true | killed |
| M2 | age check always false | killed |
| M3 | drop suppress branch | killed |
| M4 | `suppress-in-sweep` → `restart` in record | killed |
| M5 | idle case returns under-budget | killed |

Survivors: 0.

## Verification

- Acceptance 3/3; properties 2/2
- BL-1110 shell cases PASS (suite still ends FAILURES on standing BL-796
  nvm-PATH cases — out of parcel / already ticketed)
- BL-1102 acceptance still 6/6 with co-wired index
- Standing whole-tree guards 13/13 (125 tests)
- HOTFIX pack + board match `27273f2b0a`
- Conf still `handoffd|120`

## Findings

NONE (after mkTmpDir migration).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1110-handoffd-heartbeat-stale-past-budget-recurrence`.

By hardender.
