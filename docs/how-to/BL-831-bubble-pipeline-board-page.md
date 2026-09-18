# Bubble's Pipeline page: the board's own read model, a blurb per ticket, a detail sheet (BL-831)

A Bubble pager page (per [BL-829's pager](BL-829-bubble-remote-page-pager.md))
showing the in-flight pipeline board: agents as rows, in-flight tickets as
columns, a mark where each ticket currently sits — plus, below the grid on
the same main view, a short blurb for every in-flight ticket, and a
tap-through detail sheet with the ticket's fuller spec and its Gherkin
scenario titles.

## Invariant 1: one board read model, no second computation

`bubblePipelinePage.ts`'s `captureBubblePipelineBoard` calls the same
`computeLivePipelineBoard` (`pipelineGridLive.ts`) the existing Mini App
`/pipeline-board` route already drives — the same `ticketMeta`/`roleHeld`
build, the same `PIPELINE_BOARD_COLUMN_ORDER` stage-column set
(`concierge/pipelineBoard.ts`). This module only reshapes those rows into
JSON and attaches a blurb; it derives no stage placement of its own.

## The blurb: first sentence of `description:`, bounded, title fallback

`pipelineGridLive.ts`'s `blurb(item)` — the `required_wiring` anchor — is
the first sentence of the ticket's `description:` (matched up to `.`/`!`/`?`,
or the first line when there is no sentence terminator), truncated at 160
characters with an ellipsis. A ticket with no `description:` falls back to
its `title`, which is always shown as the ticket's label regardless, so the
blurb adds information rather than repeating it. A dedicated `summary:`
schema field was considered and rejected — see the ticket's own
"specifier calls" section — so every in-flight ticket gets a blurb without
a new field every future ticket would have to fill.

## Invariant 2: the main view never requires the detail sheet

Every in-flight ticket the grid lists carries its blurb on the same main
view. The detail sheet is a drill-down for more, never where you go to
learn what a ticket is about at all.

## The detail sheet: readable sections, not a YAML dump

`captureBubblePipelineDetail(targetPath, ticketId)` reads the ticket from
`backlog/active/` or `backlog/paused/` and returns plain sections —
description, invariants, out-of-scope — plus, when the ticket's
`acceptance:` names a `.feature` file that exists, that file's `Scenario`
/ `Scenario Outline` titles (`parseFeatureScenarioTitles`). A missing
feature file still opens the sheet, with `scenariosNote` stating none are
recorded rather than the sheet failing to open.

## Where it's served and ordered

`bubblePipelinePage` (id in `letsTalkRoutes.ts`, `order: 2`) is merged
into the UI bundle manifest the same way BL-775's Live page and the
health/host/operator-docs pages are, giving the pager order: Talk
(native, first), Live, **Pipeline**, Health, Host thinking — Pipeline
answers "what is in flight," checked often but less urgently than the
live panes.

## Out of scope (this slice)

Removing or redirecting the Mini App `/pipeline-board` route and the fate
of the Telegram board pin (BL-830 slice E, later — dual-run is fine).
Editing tickets, approving them, or any write action from this page.
Redesigning the backlog dashboard or the static PWA projection. Changing
what the board read model considers a stage — a wrong placement is its
own defect ticket, not a fix inside a page.

## Verify

```bash
cd extension
npm test -- bubblePipelinePage pipelineGridLive backlogReader
node ../specs/pipeline/scripts/run_acceptance.sh \
  ../specs/features/BL-831-bubble-pipeline-board-page.feature
```

Acceptance: `specs/features/BL-831-bubble-pipeline-board-page.feature`.
