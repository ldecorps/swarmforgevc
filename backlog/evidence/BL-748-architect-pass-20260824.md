# BL-748 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `9ba5fc6b58` (on coder `0b2a34d292`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

`log-routing-skip!` catches journal I/O failures, reports on stderr, returns
`:failed` — same posture as `try-sync-deliver!`. Cleaner shares
`report-nonfatal!`. Guard scoped to recording only (not the whole `-main`
let).

## Architecture

- Matches approval: observational recording cannot withhold delivery;
  suppression is never silent.
- Ordered let still: outbox → record (nonfatal) → sync-inject → draft delete.
- Scenario 03 shape preserved: hops that skip recording untouched by journal
  faults.

## Gates

| Gate | Result |
|---|---|
| Acceptance (BL-748 feature) | **4/4** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka/APS) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-748-bl623-log-routing-skip-uncaught-exception-blocks-delivery`.

By architect.
