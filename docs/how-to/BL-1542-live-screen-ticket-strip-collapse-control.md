# Live screen ticket-strip collapse control (BL-1542)

## The gap

Ticket titles now run to several hundred characters. On a phone, the live
screen's top `#ticket-strip` (id, full title, role · model · claim-age line)
filled the viewport by itself, pushing the pane grid below it off-screen.
The existing BL-609 pane text-size control changes font size, not
visibility, so it did not help.

## What changed

In `residentSpyUiHtml.ts`:

| Behaviour | Detail |
| --- | --- |
| Control | A chevron collapse control on the ticket strip, separate from the BL-609 +/- text-size control |
| Collapsed | Title clamps to one ellipsized line; ticket id and the role/model/claim-age line stay visible |
| Expanded | Full title shown again |
| Live refresh | The collapsed/expanded state changes only on a human tap or a loaded preference — never on a pane-data refresh or the 1s claim-age tick (BL-1542's own invariant, property-tested) |
| No working ticket | The strip (and its collapse control) is hidden, same as before this parcel |
| Storage | Host-persisted per surface through the bridge preference store, never browser storage (Architecture Rule 3) — human ruling A |

`webUiFontSizePreference.ts` gains `resolveWebUiTicketStripCollapsed` /
`writeWebUiTicketStripCollapsed`, storing `ticketStripCollapsed` per
surface in the same `web-ui-font-size-preferences.json` file BL-1153 uses
for `fontSizePx` — see
[BL-1153 how-to](BL-1153-sticky-web-font-size-choice.md). New routes
`GET`/`PUT /web-ui-ticket-strip-collapsed` (`webUiTicketStripCollapseRoutes.ts`)
mirror the shape of the existing font-size routes and require the same
control auth.

## Operator note

Open the live screen (Bubble or the Telegram Mini App) on a rotation
layout → tap the chevron on the ticket strip to collapse it to one line;
tap again to expand. The choice is remembered per surface and survives a
reload, the same way the pane text size is.

Acceptance:
`specs/features/BL-1542-live-screen-ticket-strip-collapse-control.feature`
