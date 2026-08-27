# Live Screen grid tiles name the ticket a seat holds (BL-1046)

## What you'll see

On the Live Screen (`/resident-spy`, shared by the Telegram Mini App and Bubble
Live), each role tile in the phone grid now shows **who the seat is** and **what
it is doing**:

| Tile element | When shown | Source |
| --- | --- | --- |
| Role name | Always | Tile label (uppercase, largest type) |
| Ticket id | Seat holds a parcel | Same `ticketId` as fullscreen Expand |
| Short slug | When `ticketTitle` is present | Same `ticketTitle` as Expand |
| Claim age | When `claimEnteredAtMs` is present | Compact form (`32m`, not `entered 32m ago`) |
| `+N` | Batch role holds more than one parcel | `heldParcelCount - 1` (cleaner, hardender) |
| Expand | Always | Opens fullscreen transcript + full metadata |

Ticket id, slug, and age render in **clearly smaller type** than the role name so
the eight-tile phone grid stays readable.

An idle seat shows only its role name and Expand — no held ticket strip.

## What changed (and what did not)

BL-994 moved held-ticket metadata off the grid and into fullscreen Expand only.
BL-1046 restores it on the grid at operator request, with two guardrails:

1. **One derivation.** The grid reads the same payload fields the Expand view
   already uses (`PaneLiveSnapshot` from `residentPaneLive.ts` /
   `resolveResidentHeldTicketMetaForRoles` in `residentPaneSpy.ts`). The tile
   never recomputes mailbox state on its own.
2. **Per-seat resolution.** Ticket id comes from that seat's own
   `inbox/in_process/` handoffs, not from the pipeline board's stage fold.

Out of scope for this slice:

- The **not-held / last-acted-on** form from BL-1044 (terminal title bars).
- Per-ticket colour coding (BL-139).
- The static backlog-dashboard PWA.

## Operator checks

1. Open the Live Screen on a phone-width viewport with at least one role holding
   work.
2. Confirm holding tiles show ticket id + slug + age under the role name.
3. Tap **Expand** on a holding tile — ticket id must match the grid strip.
4. For cleaner or hardender with multiple parcels in `in_process/`, confirm
   `+<count>` matches extra handoffs beyond the oldest claim.
5. Confirm coordinator or specifier tiles show claim age (not only coder/resident).

## UI approval mock

Before treating UI approval as done, generate a phone-width mock:

```bash
cd extension && npm run compile
node extension/scripts/render-console-tile-mock.js
```

Artifact: `backlog/evidence/BL-1046-console-tile-mock-20260826.html` (375px
viewport, sample ids on holding seats). Link or attach it from the Approvals ask
when `RESEND_API_KEY` and the operator inbox are configured — reuse
`daemon_alarm_lib.bb` `send-alarm-email!`; do not add a second mailer.

## Related

- [Resident Spy pane font-size control](BL-609-resident-spy-font-size-control.md)
  — grid and fullscreen share `--pane-font-size`; sticky persistence via
  [BL-1153](BL-1153-sticky-web-font-size-choice.md); ticket strip type sizes are
  independent clamps.
- BL-1044 — terminal title bars (sibling surface; not-held form stays there).

Acceptance:
`specs/features/BL-1046-the-console-tile-names-the-ticket-a-seat-holds.feature`
