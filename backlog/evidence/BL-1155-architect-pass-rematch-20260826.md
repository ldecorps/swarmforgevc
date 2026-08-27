# BL-1155 — architect pass (rematch) — 20260826

- QA bounce follow-up: detached review at cleaner tip `f54a89bbda` (8 paths vs
  `origin/main`; zero BL-545/catchUp scrub — prior bounce remediated).
- Did **not** merge recut into stacked architect branch (re-pollution guard).

## Architecture / boundaries

- Layout contract in `pipelineBoard.ts`: `PIPELINE_BOARD_STAGE_CELL_WIDTH = 2`,
  `computePipelineBoardGridLineWidth` exported; header composed as 2-wide cells
  with NBSP separators (26-char width at 3-digit ids, inside `MAX_WIDTH = 30`).
- Pure grid logic in concierge module; bridge surfaces unchanged for this slice.
- APS handler `bl1155PipelineBoardGridHeaderOneLineSteps` registered in
  `specs/pipeline/steps/index.js`.

## Invariants (BL-633)

- `pipelineBoard.property.test.js`: 12/12 green (width-budget contract, not
  entity-only &#160; assertion per scenario 03).

## Verification

- Dependency gate (`pipelineBoard.ts`, bridge surfaces): **PASSED**
- `pipelineBoard.test.js` + `bl979PipelineBoardTicketRows.test.js`: **151/151**
- `pipelineBoard.property.test.js`: **12/12**

Inventory: NONE

Pass → hardender (clean tip only).

By architect.
