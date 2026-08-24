# BL-1008 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `35432db2df` (on coder `a54cc7ebdf`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

`boundedWatchWait` deadline base stays 10000ms; applied wait scales via
BL-1007 `effectiveBudgetMs` / recorded factor, then
`Math.min(scaled, testBudget - 1)` so it never meets the test effective
budget. Diagnostic message still names event + path. Quiet host / unusable
factor → 10000 unchanged.

## Architecture

- Matches HOW: derive from BL-1007 factor (no second sampler; no bare raise).
- Invariant 1: `describeWatchWaitTimeout` unchanged in substance.
- Invariant 2: strict `testBudget - 1` clamp, including ceiling factor.
- Required wiring: helper requires `contentionBudget`; steps registered.
- Cleaner correctly kept BL-1007 smoke file across merge conflict.

## Gates

| Gate | Result |
|---|---|
| Unit (`boundedWatchWait.test.js`) | **10/10** |
| Quiet-host (`bounceWatcher.test.js`) | **35/35** |
| BL-1007 smoke | **1/1** |
| Properties | **3/3** |
| Acceptance (BL-1008) | **8/8** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1008-the-bounded-watch-deadline-is-itself-an-absolute-constant`.

By architect.
