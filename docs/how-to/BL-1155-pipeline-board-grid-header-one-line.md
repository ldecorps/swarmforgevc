# Pipeline Board stage header stays one line (BL-1155)

*How-to. Task-oriented: keep the eight-stage Telegram Pipeline Board header on
one phone line with an intact QA label.*

On phone Telegram, the Pipeline Board `<pre>` matrix was soft-wrapping the stage
header so **QA** split mid-label (Q on one line, A on the next), even after
BL-1117 made `escapeHtml` emit numeric `&#160;` instead of named `&nbsp;`.
The pinned preview could still show one line; the message body did not.

BL-1155 fixes the **layout budget**, not another entity-only tweak.

## What changed

`extension/src/concierge/pipelineBoard.ts` exports durable width constants:

| Constant | Value | Role |
| --- | --- | --- |
| `PIPELINE_BOARD_GRID_MAX_WIDTH` | 30 | Composed header must fit inside this phone `<pre>` budget |
| `PIPELINE_BOARD_STAGE_CELL_WIDTH` | 2 | Each stage glyph cell (DC…QA) is exactly two characters |
| `PIPELINE_BOARD_GRID_MAX_ROWS` | 12 | Row budget (unchanged dropping axis from BL-979) |

Header cells use `padStartNbsp` into 2-wide cells with **no per-cell leading
NBSP** (BL-1155). Separators between cells remain a single NBSP. Arithmetic:
id gutter (≥3, or widest display id) + 8×2 stage cells + 7 separators ≤ 30 at
today's id widths.

## Operator check

After the next Pipeline Board post in the standing topic:

1. Stage header is **exactly one line** on phone.
2. **QA** appears intact — not split across lines.
3. Mark columns still align under their stage glyphs.

Evidence of the pre-fix wrap:
`backlog/evidence/INTAKE-pipeline-board-grid-header-wrap-20260826.jpg`.

## Verify (fixture-backed)

```bash
npm test -- extension/test/pipelineBoard.test.js extension/test/bl979PipelineBoardTicketRows.test.js
npm test -- extension/test/pipelineBoard.property.test.js
bash swarmforge/scripts/test/bl1155_pipeline_board_header_mutation_sweep.sh
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1155-pipeline-board-grid-header-one-line.feature
```

## Siblings

- [Stamp-off: Pipeline Board numeric &#160;](BL-1117-swarm-stamp-pipeline-board-numeric-nbsp.md) — entity fix that preceded this width budget (BL-1117)
- [Checking Pipeline Board ticket links](BL-513-pipeline-board-current-folder-links.md) — link list below the grid
