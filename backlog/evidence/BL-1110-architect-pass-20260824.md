# BL-1110 — architect pass (bounce re-fix), inventory NONE — 20260824

Reviewed cleaner `5078b3d812` (on coder bounce absorb `07e117da87` /
implementation `15e4c5da77`) into `swarmforge-architect`. Tip ancestry
confirmed. Prior architect revert `ae4925fb8` of the first BL-1110 merge
again caused a silent deletion-win on re-merge; restored parcel paths from
`5078b3d812` as merge hygiene. Kept BL-1102 step registration on this
worktree and added `bl1110HandoffdHeartbeatSteps` (tip had omitted BL-1102
after its earlier revert).

## Bounce context (Article 4.4 / BL-340)

Architect bounce `backlog/evidence/BL-1110-architect-bounce-20260824.md`
(`4bba8916b0`) named D1–D2 — BL-1113 feature hitchhiker + Spec/done
`&#160;` narrative.

## Bounce clearance this pass

| Item | Check | Result |
|---|---|---|
| D1 | BL-1113 feature / acceptance | 9/9; `HTML nbsp entity` |
| D2 | Spec `escapeHtml` entity | `&nbsp;` (no `&#160;`) |
| HOTFIX_PATHS | pack + board vs `27273f2b0a` | MATCH |

## Scope (own work)

`daemon_log_freshness_check.sh`: mid-cycle `handoffd.sweep-marker`
suppress (`suppress-in-sweep`) when in-flight sweep is under budget;
threshold stays `handoffd|120`. Cleaner tighten of
`in_flight_sweep_under_budget`. APS + property suite.

## Architecture

- Aligns cron freshness with BL-977 supervisor trust of the sweep marker —
  named healthy cause, not a silent skip.
- Invariant 2: budget not raised as the sole fix (`handoffd|120` unchanged).
- Over-budget in-flight still restarts (no forged liveness).
- No webview/host, secrets, or SwarmForge fork issue.

## Required hard gate

`node extension/out/tools/dependency-gate.js test/bl1110HandoffdHeartbeat.property.test.js`
→ PASSED.

## Invariants review (BL-633/BL-654) — 2 declared, both encoded, green

| # | Invariant | Encoding | Verified |
|---|---|---|---|
| 1 | Healthy loop never ages past budget without named stall; in-sweep is named suppress | property + feature + shell | Green |
| 2 | Threshold raise never sole close | conf still 120 + property | Green |

## Property-testing support (undeclared)

Declared pair covered (2/2). No additional undeclared property authored.

## Correctness read-through

- Acceptance 3/3; properties 2/2; BL-1110 freshness checks PASS.
- Suite still ends FAILURES on standing **BL-796** nvm-PATH cases (already
  ticketed; out of parcel).
- BL-1102 acceptance still 6/6 after index co-wiring.

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1110-handoffd-heartbeat-stale-past-budget-recurrence`, commit = this
evidence commit (BL-536 / BL-806).

By architect.
