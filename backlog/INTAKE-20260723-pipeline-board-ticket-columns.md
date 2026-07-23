# Human directive — Pipeline board: one matrix, ticket columns instead of a repeated grid per ticket

**From:** human (via Claude Code coordinator session)
**Date:** 2026-07-23
**Authority:** human-requested

## Problem

Today's pipeline board (rendered to the pinned "Pipeline Board" Telegram message)
repeats the full 8-role grid for **every ticket**, grouped under a `-- epic --`
heading whenever the epic changes. Example (from a live board today):

```
-- swarm-reliability --
537
NS X
SP .
CO .
CL .
AR .
HD .
DC .
QA .
576
NS .
SP .
CO X
CL .
AR .
HD .
DC .
QA .
```

Each ticket gets its own vertical 8-line block (`NS`/`SP`/`CO`/`CL`/`AR`/`HD`/
`DC`/`QA`), so with N active tickets the grid is 8×N lines even though only one
role is ever marked (`X`) per ticket. The human wants a single matrix instead:
**one column per active ticket, one row per role** — shared role rows, ticket
numbers as column headers — so N tickets add columns, not repeated blocks. The
epic name moves to a small note/caption per ticket-column instead of a section
heading that currently causes the repeat-per-epic-group structure.

## Where this lives today

`extension/src/concierge/pipelineBoard.ts` (a "pivoted" design by explicit
comment at the top of the file — X-axis = ticket block, Y-axis = role line,
i.e. the opposite of what's wanted now):

- `renderPivotedTicketBlock(row)` (~line 598) — emits one ticket's full 8-line
  block, one line per `PIPELINE_BOARD_COLUMN_ORDER` entry.
- `renderGridLines(rows)` (~line 616) — loops the epic-sorted row list, calling
  `renderEpicHeading(row.epic)` (~line 608, `-- ${epic} --`) whenever the epic
  changes, then `renderPivotedTicketBlock` per row. **This whole per-row
  full-block emission is what needs to become a true matrix**: rows = roles
  (`COLUMN_LABEL` map, ~line 153: `specifier→SP, coder→CO, cleaner→CL,
  architect→AR, hardender→HD, documenter→DC, QA→QA, not-started→NS`), columns =
  tickets.
- Entry points that call into this: `renderPipelineBoardBody` (~line 723,
  Telegram) and `renderPipelineBoardGridOnly` (~line 711, BL-526 phone-miniapp
  variant, grid-only) — both need the new layout.
- Epic data is already available per row/ticket — `PipelineBoardRow.epic`
  (~line 16) / `PipelineBoardTicketMeta.epic` (~line 88), fallback
  `NO_EPIC_LABEL = '(no epic)'` (~line 166) — so the requested "epic as a note
  below" needs no new data plumbing, just a different place to print `row.epic`.
  `renderEpicHeading`/epic-grouping-as-section-header goes away in favor of this.

## The one real design gap: no width/overflow budget exists for the grid

The pipeline board already has a **message-size budget for its link list**
(`PIPELINE_BOARD_MESSAGE_MAX_LENGTH = 4000`, ~line 197, BL-502's Telegram-4096
safety margin) with truncation + a "+N more" overflow line
(`pipelineBoardOverflowLine`/`buildLinks`). **The grid itself has none.** A
ticket-per-column matrix grows wider (not taller) as tickets pile up — the
opposite failure mode of today's per-ticket-block grid, which just grows
taller. Telegram `<pre>` blocks don't wrap, and BL-505 already made the grid
phone-narrow on purpose (bare ticket numbers, 2-word slugs) specifically to
avoid horizontal scrolling on a phone. **The specifier must design a width
budget/overflow strategy for the new matrix** (e.g. cap visible ticket-columns
and add a "+N more" indicator analogous to the existing link-list pattern,
or scroll/paginate) — this is not optional polish, it's the load-bearing
constraint that makes the ticket-columns approach viable on a phone at all.

## Existing tests that will need rewriting, not just updating

- `extension/test/pipelineBoard.test.js` (~1278 lines) has many assertions
  tied to the CURRENT per-ticket-block/epic-heading format, e.g.: "a pivoted
  ticket block lists every stage column vertically" (~line 270), "each ticket
  id renders on its own line in the pivoted grid" (~306), "rows sharing an
  epic render under one heading" (~326), "a no-epic row renders under its own
  heading" (~341), "pivoted ticket ids align with the mark column" (~518), and
  the empty-board placeholder assertion (~265-267, `-- (no active tickets) --`
  — decide whether this placeholder text still makes sense with epic-as-caption
  instead of epic-as-heading).
- `extension/test/pipelineBoard.property.test.js` (~195 lines) — likely has
  structural invariants over the current grid shape; also note **BL-559** (a
  separate already-filed defect: this property test's prefix-check doesn't
  match the current link-line render format) — the specifier/architect should
  check whether BL-559 and this new ticket end up touching the same test file
  concurrently and sequence accordingly (Concurrent Work Orthogonality).

## Proposed ticket

Specifier: drain this intake into a properly-scoped ticket (or epic — this is
a real layout rewrite plus a new overflow-budget design, may warrant slicing)
in `backlog/paused/`, with a Gherkin feature under `specs/features/`.
`human_approval` still required before promotion. Check for file/scope overlap
against BL-559 (same test file) before sequencing against the current active
work.
