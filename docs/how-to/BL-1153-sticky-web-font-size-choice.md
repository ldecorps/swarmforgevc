# Sticky web UI font-size choice (BL-1153)

*How-to. Task-oriented: pick a readable text size once on phone Mini Apps and
have it survive reload, close, and return.*

Before BL-1153, persistence was inconsistent: the PWA dashboard already stuck
via a purge-exempt preferences Cache; Pipeline Board and Paused pager used
per-page `localStorage`; Live Screen ([BL-609](BL-609-resident-spy-font-size-control.md))
deliberately reset to 13px on every full Mini App reload.

BL-1153 aligns the three Mini App surfaces on one Rule-3-compatible contract:
the extension host persists choices in
`.swarmforge/operator/web-ui-font-size-preferences.json` — never webview
`localStorage` or `sessionStorage`. The PWA dashboard A-/A+ path is unchanged.

## Surfaces and defaults

| Surface | Control | Default | Clamp | Step |
| --- | --- | --- | --- | --- |
| Live Screen (`/resident-spy`) | BL-609 +/- in fullscreen chrome | 13px | 9–20px | 1px |
| Pipeline Board | A-/A+ in page chrome | 15px | 12–26px | 1px |
| Paused pager | A-/A+ in page chrome | 15px | 12–26px | 1px |
| PWA dashboard | A-/A+ in chrome | 28px | 16–40px | 2px |

Clamp ranges stay surface-specific; stickiness is what BL-1153 adds.

## Operator workflow

1. Open a Mini App surface (Live Screen, Pipeline Board, or Paused pager).
2. Adjust text size with its existing control (+/- or A-/A+).
3. Fully reload, close the Mini App, or leave and return — the chosen size
   should restore automatically.

On Live Screen, grid tiles and fullscreen panes still share
`--pane-font-size`; crowded 7–8 pane grids still use
`calc(var(--pane-font-size) - 2px)`.

## Host persistence (Rule 3)

Mini Apps load the stored size on startup via authenticated bridge routes:

- `GET /web-ui-font-size?surface=<live-screen|pipeline-grid|paused-pager>`
- `PUT /web-ui-font-size` with JSON `{ "surface", "fontSizePx" }`

The bridge writes atomically to
`.swarmforge/operator/web-ui-font-size-preferences.json` under the target
project root. Keys are per-surface (`live-screen`, `pipeline-grid`,
`paused-pager`).

Missing, corrupt, or out-of-range stored values fall back to each surface's
default — never crash or leave text unreadable.

## Verify stickiness (manual)

Match the ticket's QA procedure:

1. **Live Screen** — step away from 13px, fully reload the Mini App, confirm
   the chosen size returns.
2. **Pipeline Board / Paused pager** — set a non-default size, reload, confirm
   restore.
3. **PWA dashboard** — A-/A+ still restores after reload from the preferences
   Cache (unchanged).
4. **Corrupt fallback** — delete or corrupt
   `.swarmforge/operator/web-ui-font-size-preferences.json`, reload each Mini
   App surface, confirm defaults (13px Live Screen; 15px Pipeline/Paused).

## Regression locks

- Unit: `extension/test/webUiFontSizePreference.test.js`
- Acceptance: `specs/features/BL-1153-sticky-web-font-size-choice.feature`
- Live Screen +/- UX still owned by BL-609; persistence contract superseded
  here only.

## Siblings

- [Resident Spy pane font-size control](BL-609-resident-spy-font-size-control.md) — +/- control UX and Live Screen defaults
- [Live Screen grid tiles name the ticket a seat holds](BL-1046-console-tile-names-the-ticket-a-seat-holds.md) — ticket strip type sizes track `--pane-font-size`
