# Live Screen: per-tile activity dots (BL-1160)

*How-to. Task-oriented: read per-role health on the phone grid at a glance.*

## What you'll see

The Live Screen phone grid (`/resident-spy`, `residentSpyUiHtml.ts`) used to show
**one** viewport-fixed status dot (`#dot`, bottom-left of the screen). On the 2×4
layout that dot overlapped a single tile (often DOCUMENTER) and read as **global**
freshness, not per-role health.

BL-1160 gives **each grid tile its own activity dot** (~8px, bottom-left inside
the tile head). Colour semantics are unchanged:

| Signal | Colour |
| --- | --- |
| ok | green (`#3fb950`) |
| stale | amber (`#d29922`) |
| err | red (`#f85149`) |

Never-polled or unavailable panes hide the dot or show non-ok — the grid must
not read as all-green when only aggregate poll data exists.

Fullscreen **Expand** keeps `#fs-dot` as a visible status cue; grid dots and
Expand read the same signal path (`resolvePaneStatusKind`, `updatePaneStatusDot`,
`setStatus`).

## What changed (and what did not)

- **Grid:** one `[data-status-indicator]` dot per `.pane-col`, inside `.pane-head`.
- **Signal:** prefers optional per-pane `activitySignal` when present; otherwise
  falls back to aggregate poll freshness for available panes only.
- **Sibling:** complements [BL-1046 held-ticket strip](BL-1046-console-tile-names-the-ticket-a-seat-holds.md)
  on the same tile — role name, ticket strip, Expand, dot.
- **Out of scope:** new status meanings, Bubble Live port, per-pane heartbeat
  plumbing beyond what the payload already carries.

## Operator checks

1. Open Live Screen on phone width with eight tiles — **eight** dots, each inside
   its tile.
2. When one pane is stale/err and per-pane signal exists, only that tile's dot
   turns amber/red.
3. A never-polled pane — dot hidden or non-ok, not misleading green.
4. Expand a tile — status cue still visible in fullscreen.
5. Unit coverage: `extension/test/residentSpyUiHtml.test.js` (BL-1160 scenarios).

## Verify (fixture-backed)

```bash
cd extension && npm test -- --run residentSpyUiHtml.test.js
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1160-live-screen-activity-dot-per-tile.feature
```

## Related

- [BL-1046 — held ticket on tile](BL-1046-console-tile-names-the-ticket-a-seat-holds.md)
- [BL-609 / BL-1153 — font-size controls](BL-609-resident-spy-font-size-control.md)
- Module: `extension/src/bridge/residentSpyUiHtml.ts`
