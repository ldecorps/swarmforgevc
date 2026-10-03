# Brief: BL-1858 ten-tile live grid adds a phone row the crowded-step never covers

**Artifact**: Bubble / Telegram Mini App Live Screen grid (tmux pane tiles)
**Surface**: Telegram Mini App WebView, ~390px phone viewport, dark theme
**Reviewed**: 2026-10-03, source at `extension/src/bridge/residentSpyUiHtml.ts`
as changed by hotfixes c54b9060a6 and 93d6f69ba0 (QA sign-off request for
BL-1858, commit ad8499e1d8); no live tunnel (same method as the BL-1732
intake-form review, `docs/design/artifact-inventory.md`).

## What's wrong, as a human sees it

Before this parcel, a phone's live grid never showed more than 8 tiles —
2 columns × 4 rows. BL-1858 adds 9 and 10 tiles for the art-director and
coder@2 seats, still 2 columns on phone, which means **5 rows**, not 4: a
whole extra row of vertical squeeze the grid has never carried before.

The 2026-09-21 "crowded step" (BL-609) already recognised that 7–8 tiles
need tighter spacing and shrank two things for `.pane-count-7`/`-8`: the
fullscreen `.pane-title` font and the hidden-in-grid `pre` font. BL-1858
extends both of those same two selectors to `-9`/`-10` — but neither one
is what a grid tile actually shows. The grid tile's visible content is
`.pane-kind` (role name), `.pane-grid-model`, and `.pane-grid-ticket`
(id + 2-line slug + age), inside a `.pane-head` with a flat `16px 12px`
padding and `10px` gap that **never changes** with pane count.

Doing the row-height arithmetic for a real phone: a 700px-tall viewport
minus the ticket strip (~50–70px) leaves ~630px for 5 rows ≈ 126px/row.
A tile's own content — `.pane-kind` line + `.pane-grid-model` line +
`.pane-grid-ticket`'s id/2-line-slug/age block, plus 32px of head padding
and the 10px gap between the two groups — adds up to very close to that
same ~126px, on the one phone size used as the reference point; a
shorter real device (iPhone SE class, less than 700px of usable height
after Telegram's own chrome) has less room than that, not more. `.pane-col`
sets `overflow: hidden`, so a tile that doesn't fit does not scroll — its
bottom line (age, or the second slug line) is silently cropped, not
reflowed.

## Intended result

A 9- or 10-tile phone grid holds the full tile head — role name, model
label, ticket id, slug (both clamped lines), and age — with no visible
clipping, verified on the same real surface the human watches this on
(the live 10-seat swarm's Bubble Live tab, phone width). Concretely: add
`-9`/`-10` to the crowded-step treatment for `.pane-head` (tighter
padding/gap) and `.pane-grid-model`/`.pane-grid-ticket-id`/`.pane-grid-slug`/
`.pane-grid-age` (one font step down), the same way `.pane-count-7`/`-8`
already step `.pane-title` and `pre` — so the extra row BL-1858 introduced
gets the same crowding treatment the grid already has a mechanism for,
instead of inheriting the 8-tile spacing unchanged.

## Constraints

- Scope is CSS only (`residentSpyUiHtml.ts`'s `<style>` block) — no change
  to `captureLiveScreenPanes`, the roster logic, or the model-label fix;
  those are the part of BL-1858 that is correct and already reviewed.
- Keep the two-column phone layout and the five-column wide layout BL-1858
  chose; this brief is about row height inside that layout, not the
  column count.
- Don't regress the 1–8 tile cases: the new crowded step must be
  additive (`-9`, `-10` added to existing selectors or a new sibling
  rule), never a change to the existing `-7`/`-8` values.

## Disposition

Not blocking the hotfixes already on `main` — this is a follow-on
tightening of a layout they introduced, not a revert. Routed to the
specifier as a `note` to mint against BL-1858's fix owner; QA's sign-off
reply carries this brief as the defect.
