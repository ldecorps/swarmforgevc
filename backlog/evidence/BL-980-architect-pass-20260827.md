# BL-980 — architect pass — 20260827

## Review inventory (Article 4.4)

NONE.

## Inbound

Cherry-picked cleaner `a2f216e932` (re-applied after architect revert of polluted
BL-1084 merge had dropped BL-980 slice from worktree tip).

## Scope

RECENTLY CLOSED lines show relative closure age from durable `doneClosedAtMs`
only — `formatRecentlyClosedAgeLabel` pure helper in `pipelineBoard.ts`; age
carried through list source/render paths; both text and HTML agree.

## Architecture

- Pure formatting in extension host (`pipelineBoard.ts`); `nowMs` injected —
  no bare `Date.now()` in render path.
- Data from existing `TickState.doneClosedAtMs` (conciergeTick) — no new
  closure source; invariant 1 satisfied (no mtime fabrication).
- View/webview boundary untouched; dep-gate **PASSED**.
- Co-change coupling to `pipelineBoard.test.js` / step registry is expected
  for this surface — not a boundary leak.

## Invariants (BL-654)

| invariant | encoding |
|---|---|
| Age never fabricated | property test + unit scenario 02 + acceptance scenario 02 |

## Gates

| Gate | Result |
|---|---|
| Dep-gate (`pipelineBoard.ts`, `conciergeTick.ts`) | **PASSED** |
| Unit (`bl980RecentlyClosedElapsed.test.js`) | **7/7** |
| Properties (`bl980RecentlyClosedElapsed.property.test.js`) | **2/2** |
| Acceptance (BL-980 feature) | BLOCKED BY worktree `steps/index.js` missing BL-1155 handler file (not parcel defect) |
| Co-change | informational only |

## Forward

`git_handoff` to `hardender`, priority `00`.

By architect.
