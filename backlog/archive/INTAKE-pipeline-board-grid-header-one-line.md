# ARCHIVED — drained by specifier 2026-08-26

Disposition: minted backlog/paused/BL-1155-pipeline-board-grid-header-one-line.yaml

---

# INTAKE — Pipeline Board grid header must stay one line (QA must not wrap)

**Source:** human via Cursor / Telegram Pipeline Board screenshot, 2026-08-26 ~11:25 BST  
**Surface:** Telegram Pipeline Board `<pre>` matrix in
`extension/src/concierge/pipelineBoard.ts` (`renderGridMatrixLines` /
`escapeHtml` / `wrapPipelineBoardHtml`), posted by concierge board sync.

Status: **new intake, not minted.** Specifier: mint and spec (defect /
polish on the live board). Human locked ask is narrow: **the first line of
the grid should be one line** — `QA` must not split across two lines.

## Why this is in front of you

Live Pipeline Board topic on phone still soft-wraps the stage header so
`QA` breaks mid-label:

```text
          NS SP CO CL AR HD DC Q
A
658  .  .  .  .  .  .  .  X
.
```

Pinned preview on the same topic still reads as one line
(`… HD DC QA …`), which makes the wrap in the message body obvious.

Evidence:
`backlog/evidence/INTAKE-pipeline-board-grid-header-wrap-20260826.jpg`

This is **after** tip `646ffe85d` / BL-1117 stamp-off (`escapeHtml` emits
numeric `&#160;` for U+00A0 because named `&nbsp;` is not in Telegram's
HTML named-entity set). The code comment already admits the residual:
"Raw NBSP alone still soft-wraps before QA on some clients." Live phone
render shows the residual is still user-visible — entity emission alone
did not keep the header on one line.

## Goal

1. On a typical phone Telegram client width, the stage header
   `NS SP CO CL AR HD DC QA` renders as **exactly one line** (no wrap
   between `Q` and `A`, and no wrap that orphans a trailing mark on the
   data rows either if the same width budget is the cause).
2. Column alignment between header and ticket mark rows stays intact.
3. Prefer a durable layout/budget fix over another entity-only tweak that
   leaves the line wider than the client viewport.

## Preferred shape (specifier may refine)

- Revisit `PIPELINE_BOARD_GRID_MAX_WIDTH` / gutter / `STAGE_CELL_WIDTH` so
  the composed header fits the phone `<pre>` without soft-wrap, **or**
- Another house-legal Telegram HTML layout that keeps stages glanceable
  without mid-glyph wrap.

Do not "fix" this by dropping the QA column or renaming stages without
an explicit human/specifier decision.

## Out of scope

- Re-certifying BL-1117 / rewriting the stamp-off how-to alone (that tip
  may stay correct for entity rendering and still fail this ask).
- Pipeline Board Mini App / web grid (`pipelineGridUiHtml.ts`) unless the
  same wrap shows there.
- Unified s1/s2 grid work (BL-1009) unrelated to this wrap.

## Related

- BL-1117 — stamp-off tip `646ffe85d` (numeric `&#160;`)
- BL-1113 — earlier Pipeline Board HTML spacing / named `&nbsp;` era
- BL-979 / BL-505 / BL-452 — matrix layout, narrower grid, board topic
- `pipelineBoard.ts` `escapeHtml`, `renderGridMatrixLines`,
  `PIPELINE_BOARD_GRID_MAX_WIDTH`
- Hotfix ledger row `646ffe85d` (pending human certify/waive)

## Acceptance sketch

- Feature: rendered stage header for today's eight columns is a single
  line with intact `QA` (no mid-label wrap) under the board's stated phone
  width budget.
- Feature: header cells still align over the matching mark columns.
- Property/unit: width / wrap contract named in the feature (not only
  "entity string contains `&#160;`").
- Live: Pipeline Board topic on phone shows one header line after the next
  board post.
