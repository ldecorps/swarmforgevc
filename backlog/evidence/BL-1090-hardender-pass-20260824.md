# BL-1090 — hardener pass, 20260824

## Inbound

Merged architect `88e31a4537` into `swarmforge-hardender`.

## Scope

Shared `approvalAskRecordedOnLiveTopic` predicate; edge path
`suppressEdgeApprovalRequestedWhenAskOnLiveTopic` so a lost tick baseline
does not re-post a live Approvals ask (still remints stale topic ids).

## Host / cooldown

- `approvalAskReconcile.ts`: **DECISION: run** (age ~35d)
- `conciergeTick.ts`: **skip-cooldown** (age ~1.5d) — Gherkin + surgical only

## BL-113 Gherkin (soft)

```
total=6 completed=6 killed=6 survived=0
outcome: pass
```

(Outline: live / stale / nowhere × already-live yes|no.)

## Stryker (`approvalAskRecordedOnLiveTopic` body)

Mutate `out/concierge/approvalAskReconcile.js:24-31` with reconcile +
conciergeTick vitest.

| Score | Killed | Survived |
|---|---|---|
| 84.62% | 11 | 2 |

Survivors (equivalent under `topicId: number`):

1. `if (liveApprovalsTopicId === undefined)` → `if (false)`
2. Empty block for the undefined-live early return

Fall-through `ask !== undefined && ask.topicId === undefined` is still
false for every typed ask; same observable as `return false`.

## Hand-authored surgical

| Surface | Mutant | Result |
|---|---|---|
| reconcile | always-false live predicate | killed |
| reconcile | ignore topicId match | killed |
| reconcile | undefined-live returns true | killed |
| tick | never-suppress (force false) | killed |
| tick | suppress without mark emitted | killed |
| tick | skip suppress call (`edgeEvents = raw`) | killed |

## Verification

- Acceptance 6/6 (after `tsc` — `out/` is gitignored)
- vitest approvalAskReconcile + conciergeTick: 120/120

## Findings

NONE (2 equivalent Stryker survivors documented).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1090-a-lost-tick-baseline-reposts-an-exact-duplicate-approval-ask`.

By hardender.
