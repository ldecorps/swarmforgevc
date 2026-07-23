# Human directive — Resident Spy live screen: font-size +/- control in the header

**From:** human (via Claude Code coordinator session, screenshot of live screen)
**Date:** 2026-07-23
**Authority:** human-requested

## Problem

On the Resident Spy live screen (the Telegram Mini App that mirrors a live
agent pane's terminal output — `extension/src/bridge/residentSpyUiHtml.ts`,
`getResidentSpyUiHtml()`), the pane output text has one fixed font size with
no way to adjust it. The human wants:

1. A font-size **+ / -** control placed in the header.
2. The **default** font size bumped up a bit from what it is today.
3. The **+ / - buttons themselves** rendered very small/compact — the control
   should be unobtrusive, not the text it's adjusting.

## Where this lives today

- Pane output text uses one global rule:
  `residentSpyUiHtml.ts:199-213`, `font-size: 11px; line-height: 1.35;`
  (~line 208-209). Both the grid split-view tiles and the fullscreen pane
  (`#fs-pre`, ~line 245) share this same `pre` selector — no separate
  fullscreen override exists today.
- A density override already exists for crowded grids:
  `.split.pane-count-7 pre, .split.pane-count-8 pre { font-size: 9px; padding:
  6px; }` (~line 148-149) — any new font-size control must compose with this,
  not fight it (e.g. a user-chosen size should still be respected, or the
  density override should be understood as a separate concern the specifier
  reconciles).
- Two header contexts exist and either (or both) could host the control:
  - `buildFullscreenHeadHtml()` (~line 491-499) → `#fs-head`
    (~line 264 DOM stub, populated in `syncFullscreenContent()` ~line 522) —
    the persistent single-pane fullscreen header, matching the screenshot the
    human attached (ticket id/title, role, model, "entered Xm ago", RESIDENT
    badge).
  - `buildTicketBlockHtml()` (~line 474-489) → the ticket-strip header used
    in grid view.
  - Per **BL-564**'s retro-spec, the pane header (ticket id+title, role,
    model, entered-ago, badge) is a REQUIRED, protected element — "never
    displaced by future UI changes." A font-size control must be ADDED to
    this header without displacing or crowding out any of those required
    elements.
- **No existing font-size adjustment mechanism** anywhere in this file today
  (confirmed: no JS-driven `fontSize` state, no zoom control, nothing to
  reuse) — this is net-new.

## Constraint the implementer must not violate

Per this project's own Architecture Rules (§3): **no `localStorage`,
`sessionStorage`, or any browser storage in the webview.** This Mini App is
served through `bridge/bridgeServer.ts` into a webview-like context — the same
constraint applies. Whatever mechanism holds the chosen font size (in-memory
only for the session, vs. persisted via the extension host / a file / workspace
state so it survives reopening the Mini App) must go through the extension
host, never reach for browser storage as the easy path.

## Open questions for the specifier

- Exact default size bump (human said "a tad bigger," no specific number —
  specifier's call, keep it modest).
- Does the +/- control apply to both the grid split-view and the fullscreen
  view, or fullscreen only (what the screenshot shows)?
- Should the chosen size persist across reopening the Mini App (via the
  extension host, per the no-browser-storage constraint above), or reset each
  session? If persisted, where — new note, this is genuinely new state, not
  something existing infra already tracks.
- Min/max clamp on the adjustable range, and how it composes with the
  existing crowded-grid density override.

## Proposed ticket

Drain this intake into a properly-scoped ticket in `backlog/paused/` with a
Gherkin feature under `specs/features/`. Small/contained UI tweak — a single
ticket should suffice, no epic needed. `human_approval` still required before
promotion.
