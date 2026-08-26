# INTAKE — Live Screen: activity dot on each role tile

**Source:** human via Cursor, 2026-08-26 ~09:21 BST (re-filed 2026-08-26 ~15:20
BST at operator request: mint this intake)  
**Surface:** Telegram Mini App Live Screen (`extension/src/bridge/residentSpyUiHtml.ts`)
— the square-ish role-tile grid (BL-994). Phone view at `e.musicalsifu.com`
shows COORDINATOR / SPECIFIER / CODER / CLEANER / ARCHITECT / HARDENDER /
DOCUMENTER / QA tiles with Expand only.

Status: **filed for specifier mint** — sibling to BL-1046 (held ticket on tile,
landed locally 2026-08-26); this slice is per-tile activity/freshness dots only.

## Why this is in front of you

Today the Live Screen has a **single** fixed status dot
(`#dot`, `position: fixed` bottom-left of the viewport). `setStatus(kind)`
drives one global ok / stale / err colour from overall poll freshness
(`tickAge` vs `lastOk`). On a multi-tile grid that one dot sits in the
viewport corner and reads as if it belongs to whichever tile happens to
overlap it (DOCUMENTER on the 2×4 phone layout) — not as per-role health.

Human ask (verbatim intent): **add an activity dot for each tile.**

## Goal

1. Every role tile in the grid gets its **own** activity/status dot
   (same visual language as today's green / amber / red circle).
2. Placement is **inside the tile** (consistent corner — prefer
   bottom-left of the tile content, mirroring today's size ~8px).
3. Dot state reflects **that pane's** freshness / availability when the
   payload already carries per-pane signal; if only whole-poll freshness
   exists today, still show a per-tile dot driven by the honest signal
   available (and name any follow-on for true per-pane heartbeats).
4. Fullscreen Expand view keeps a clear status cue (keep or relocate the
   existing single-dot behaviour — do not leave fullscreen without one).

## Preferred shape (specifier may refine)

1. Move or duplicate `.dot` from body-fixed into each `.pane-col` /
   tile head so grid overview always shows N dots for N tiles.
2. Colour semantics stay: ok = green (`#3fb950`), stale = amber
   (`#d29922`), err = red (`#f85149`); hidden when never successfully
   polled / offline if that matches current single-dot hide rules.
3. Do not clutter tiles: grid shows role name + held-ticket strip (BL-1046)
   + Expand + the dot — no transcript in the tile (BL-994 posture).

## Out of scope

- Bubble Live port (separate intakes).
- Changing the Expand / fullscreen transcript layout beyond status cue.
- New status meanings (CPU, model, ticket) — this is the existing
  activity/freshness dot, per tile.

## Related

- BL-994 — Live Screen role tiles are a square-ish grid
- BL-1046 — held ticket id/slug/age on grid tiles (operator qjump 2026-08-26)
- `extension/src/bridge/residentSpyUiHtml.ts` — `.dot`, `setStatus`,
  `tickAge`, pane grid render
- Screenshot / human observation: single green dot appears once on the
  8-tile phone grid

## Acceptance sketch

- Feature: with N role panes in the split grid, the overview shows N
  activity dots, one visually owned by each tile.
- Feature: ok / stale / err colours match today's single-dot palette.
- Feature: offline / never-polled behaviour does not leave misleading
  "all green" tiles.
- Property/unit or HTML fixture: rendered grid markup includes one status
  indicator node per pane column (or equivalent testable seam).
