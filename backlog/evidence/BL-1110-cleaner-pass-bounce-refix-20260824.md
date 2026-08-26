# BL-1110 cleaner pass (architect bounce re-fix) — 2026-08-24

## Inbound

Merged coder commit `07e117da87` (absorb architect bounce `4bba8916b0`:
restore named `&nbsp;` stamp-off narrative; keep BL-1110 sweep-marker
suppress; omit deleted BL-1102 require) into `swarmforge-cleaner` via
`git merge --no-ff`. Conflict in `specs/pipeline/steps/index.js` resolved:
wire BL-1097 + BL-1110 once; no `bl1102SpawnFailureSteps` (files gone).
Ancestry: `git merge-base --is-ancestor 07e117da87 HEAD`.

Prior architect bounce (`BL-1110-architect-bounce-20260824.md`): D1–D2
blamed **coder** (BL-1113 hitchhikers). No cleaner-blamed items.
Prior cleaner tighten of `in_flight_sweep_under_budget` remains in lineage.

## Bounce clearance

| Check | Result |
|---|---|
| BL-1113 feature step text named `&nbsp;` (not numeric) | restored |
| Spec narrative `escapeHtml` emits `&nbsp;` | OK |
| BL-1113 acceptance | 9/9 |
| BL-1110 acceptance | 3/3 |
| `test_daemon_log_freshness.sh` BL-1110 checks | PASS (suite still FAILURES on standing BL-796 nvm-PATH) |
| Conf `handoffd` threshold 120 | unchanged |

## Cleanup review

NONE beyond merge conflict resolution (omit deleted BL-1102 steps). No further
structure work — inventory NONE.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1110-handoffd-heartbeat-stale-past-budget-recurrence`.

By cleaner.
