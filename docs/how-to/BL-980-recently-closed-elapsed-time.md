# RECENTLY CLOSED lines show closure age on the Pipeline Board (BL-980)

*How-to. Task-oriented: read the relative “how long ago” suffix on each
RECENTLY CLOSED ticket line in the Telegram Pipeline Board.*

Human example (verbatim from intake 2026-08-20): `966 effective-backlog
(10min ago)`.

## What you see

Only the **RECENTLY CLOSED** section gains a parenthetical age after the
id + slug. PARKED, AWAITING APPROVAL, ROOT INTAKE, the stage grid, and
grid captions are unchanged — no age suffix there.

## Age ladder

Computed at render time from the durable closure instant, not file mtime:

| Elapsed since closure | Label |
| --- | --- |
| under 1 minute | `just now` |
| under 1 hour | `Nmin ago` |
| under 1 day | `Nh ago` |
| otherwise | `Nd ago` |

Both render paths agree: plain-text body and HTML Telegram message carry
the same suffix (BL-956 lockstep).

## Data source

`conciergeTick.ts` maintains `TickState.doneClosedAtMs` — stamped **once**
when a ticket is first observed in `backlog/done/`, never restamped on later
ticks (so a stuck completion-message retry cannot rejuvenate the age).
`recentlyClosedItems` already sorts by this map; BL-980 carries
`closedAtMs` through to `pipelineBoard.ts` and `formatRecentlyClosedAgeLabel`.

A ticket with **no** entry in `doneClosedAtMs` renders **without** any
parenthetical — never `(unknown)` and never a guessed age from YAML mtime.

## Module map

| Piece | Location |
| --- | --- |
| Closure stamp + sort key | `extension/src/concierge/conciergeTick.ts` |
| Age formatter + render | `extension/src/concierge/pipelineBoard.ts` — `formatRecentlyClosedAgeLabel` |
| Unit tests | `extension/test/bl980RecentlyClosedElapsed.test.js` |
| Property tests | `extension/test/bl980RecentlyClosedElapsed.property.test.js` |

## Verify

```bash
cd extension && npm test -- bl980RecentlyClosedElapsed
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-980-recently-closed-elapsed-time.feature
```

Acceptance:
`specs/features/BL-980-recently-closed-elapsed-time.feature`

Related: [Checking Pipeline Board Ticket Links](BL-513-pipeline-board-current-folder-links.md),
BL-465 (RECENTLY CLOSED section), BL-979 (sibling intake split).
