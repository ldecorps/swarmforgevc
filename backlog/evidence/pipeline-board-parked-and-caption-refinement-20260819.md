# Pipeline Board: parked-section + caption refinement (human directive, 2026-08-19)

## What changed

Three rendering changes in `extension/src/concierge/pipelineBoard.ts`,
applied directly by the human (not through the pipeline):

1. **Grid caption lines now show the full ticket title** instead of just
   the epic slug. `gridCaptionLine` renders
   `<displayId> <title>` (e.g. `942 Mutation-and-CRAP defer to a quiet
   host that never arrives…`) rather than the previous
   `<displayId> <epic>` (e.g. `942 code-quality-gates`).

2. **Collapsed-epic entries capped to 3.** New constant
   `PIPELINE_BOARD_COLLAPSED_EPICS_MAX = 3`; only the top 3 epic
   trackers by priority appear in the PARKED section.

3. **Plain parked entries capped to 3.** `PIPELINE_BOARD_PAUSED_MAX`
   reduced from 10 to 3. Awaiting-approval tickets are still uncapped.
   Overflow renders as `+N more parked`.

## Why

The phone-screen pipeline board was too cluttered with parked entries and
the grid caption lines (epic slug only) gave too little context to
identify tickets at a glance. The human asked for "less parked entries
(top 3 from top 3 epics)" and "full summary description for all shown in
the grid".

## Impact on existing tickets / acceptance

- No acceptance scenario encodes the old caption format or the old
  `PIPELINE_BOARD_PAUSED_MAX = 10` value — no scenario breaks.
- Any future ticket touching the pipeline board rendering should be aware
  of these new caps and the caption shape.
