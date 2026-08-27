# BL-599 — architect pass — 20260827

## Review inventory (Article 4.4)

NONE.

## Inbound

Cherry-picked cleaner parcel tip-pure (avoided polluted merge `afeb7370e9` that
would have pulled BL-780/781/980 hitchhikers): coder `9653d3e368` + cleaner
`8109a5dfb`. Six paths only vs prior architect tip.

## Scope

Acceptance steps + property tests wiring existing `deliveryMetrics.ts`
intake-balance helpers (`deriveIntakeBalanceEvents`, `computeIntakeBalance`) to
BL-599 feature scenarios. Core implementation already on `main`; this parcel is
verification surface only.

## Architecture

- Steps import compiled `extension/out/metrics/deliveryMetrics` — metrics layer
  stays in extension host; no webview or tmux boundary touched.
- No new git-history reader; steps exercise the same adapter the ticket
  requires.
- Dep-gate: no `extension/src` changes in parcel — **N/A** (nothing to scan).
- Co-change among parcel files only (steps, property test, index registration)
  — expected, not a boundary leak.

## Invariants (BL-654)

| invariant | encoding |
|---|---|
| Same git-history adapter — no second reader | acceptance scenario 01 + steps call existing exports |
| Epic trackers excluded from filed/closed | property P1 + acceptance scenario outline row 3 |
| Pure aggregator over derived events | property P2 + acceptance scenario 02 |

## Gates

| Gate | Result |
|---|---|
| Dep-gate | **N/A** (no src changes) |
| Properties (`deliveryMetricsIntakeBalance.property.test.js`) | **3/3** |
| Acceptance (BL-599 feature) | **7/7** (local run required restoring missing `bl1155` step file from `main` — worktree drift, not parcel defect; cleaner verified 7/7 on clean line) |
| Co-change | informational only |

## Forward

`git_handoff` to `hardender`, priority `00`.

By architect.
