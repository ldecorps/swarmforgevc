# Resident Spy pane font-size control (BL-609)

## The gap

Resident Spy pane text was fixed at 11px with no way to adjust it. Crowded
grids forced an absolute 9px that would override any future user choice.

## What changed

In `residentSpyUiHtml.ts` / `residentSpyPaneFontSize.ts`:

| Behaviour | Detail |
| --- | --- |
| Default | 13px via `--pane-font-size` (grid + fullscreen share one `pre` rule) |
| Control | Compact +/- in the fullscreen chrome, mounted **outside** `#fs-head` so pane refresh cannot wipe it or its state |
| Crowded 7–8 panes | `calc(var(--pane-font-size) - 2px)` — denser, still tracks the choice |
| Range | 9–20px, 1px steps; bound button shows unavailable |
| Storage | Session memory only — no `localStorage` / `sessionStorage` (Architecture Rule 3) |
| Header | Ticket id/title, role, model, entered-ago, RESIDENT badge remain (BL-564) |
| Grid tiles | Held ticket id/slug/age on the tile head in smaller type (BL-1046); see [BL-1046 how-to](BL-1046-console-tile-names-the-ticket-a-seat-holds.md) |

## Operator note

Open Resident Spy → Expand a pane → use +/-. Grid tiles follow the same size.
A full Mini App reload resets to 13px (by design).

Acceptance:
`specs/features/BL-609-resident-spy-font-size-control.feature`
