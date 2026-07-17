# Pipeline board: real root cause of the freeze, now unmasked by BL-497 — message exceeds Telegram's 4096-char limit

Operator-diagnosed, 2026-07-17 ~14:22 UTC. Follow-on to `backlog/evidence/pipeline-board-frozen-live-outage-20260717.md`
and BL-497 (shipped, `backlog/done/`). BL-497 fixed the SILENCE (the swallowed error) — it did not
and could not fix this, since the real cause was invisible until BL-497 landed and logged it for the
first time:

```
syncBoardIfWired: failed-post (unknown): Telegram API responded with status 400: Bad Request: text is too long
```

## Confirmed live (2026-07-17 ~14:22 UTC, current build, current backlog)

Reproduced directly against the CURRENT `extension/out` build and CURRENT `backlog/active` +
`backlog/paused` + `backlog/done` (today's much-smaller backlog, well after the tickets that inflated it
this morning have since shipped):

- Grid + parked/recently-closed body: 1500 chars (fine on its own).
- The BL-465 tappable GitHub link list (`renderPipelineBoardLinks`, one `<a href=...>` line per grid row +
  parked + recently-closed entry): **3006 chars** on its own, for only 16 linkable entries.
- Combined wrapped message: **4522 chars — over Telegram's 4096 sendMessage limit.**

This is NOT the old "backlog ballooned overnight" size problem (that backlog has since shrunk to 3
active / 9 paused). It is a STRUCTURAL defect: the per-entry link line
(`<a href="https://github.com/.../blob/main/backlog/....yaml">backlog/....yaml</a>`) costs roughly
150-190 chars each, and BL-465 attaches one for every row + parked + recently-closed entry with no cap
or length budget. At current board size (2 rows + 9 parked + 5 recently-closed = 16 links) it is ALREADY
over the limit; it will keep failing for any backlog of comparable or larger size, not just today's
historical peak.

## Why BL-497 can't recover this on its own

BL-497's error classifier (correctly) treats an unrecognized error as `unknown`/transient and never
recreates the topic (the right call for THIS error — the topic is fine, the payload is not). But a
"text too long" failure is not actually transient: retrying the SAME oversized payload will fail forever
until the payload shrinks. Current live state: `consecutiveFailures: 1`, retry cap
`PIPELINE_BOARD_ALERT_FAILURE_CAP = 5` (`pipelineBoardSync.ts` L20) — so BL-497's one bounded alert WILL
fire once the cap is hit, correctly notifying that the board is stuck, but the board itself will remain
frozen indefinitely afterward since nothing shrinks the payload.

## Recommended fix (architect's call on mechanism)

The board's own grid/parked/recently-closed TEXT stays comfortably under the limit; the link list is what
blows the budget. Candidates:
  1. Cap the link list length (a max-N-links budget, like `PIPELINE_BOARD_RECENTLY_CLOSED_MAX` already
     bounds the recently-closed section) — simplest, but silently drops some links past the cap (needs a
     "+N more" indicator, per this codebase's own no-silent-cap posture — see engineering rule + the
     `[[no-silent-caps]]` workflow guidance: log/render what was dropped).
  2. Post the link list as a SEPARATE follow-up message (own change-gate) rather than appended to the
     same board post — keeps the grid always postable regardless of link-list size, and the two can be
     independently change-gated.
  3. Shorten each link line (e.g. just the ticket id as the link text/tooltip instead of the full repo
     path) to raise the practical entry budget before hitting the cap again at a larger backlog size.

Whichever mechanism, this should reuse BL-497's own new failure-surfacing/classification scaffolding
(`pipelineBoardSync.ts`) — a "message too long" Telegram error is itself now visible and could be given
its own explicit classification (distinct from topic-gone / unknown) so future occurrences are at least
correctly labeled even before this fix, rather than lumped under "unknown."

## Priority

Live outage, still ongoing (board frozen since ~00:44 UTC, now for a DIFFERENT reason than originally
diagnosed). Recommend picking this up immediately behind/alongside BL-497's own alert firing, same
expedite posture as BL-497.
