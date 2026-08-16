# Raw intake — Bottleneck line ranks on queue-wait, so specifier (fast) looks slow

Status: new intake, not minted. Capture only (human via Cursor 2026-08-16
~08:23 CEST). Human: "Bottleneck: specifier (1.3x the next slowest stage)
This looks wrong. Use the processing time to derive the bottleneck.
Specifier is super fast, it can't be the bottleneck."

Instrument: BL-102 `nameBottleneck` / briefing `:stage-dwell-section`.

## Live evidence (24h CLI, 2026-08-16 ~08:24 CEST)

`node extension/out/tools/stage-dwell-report.js --hours 24` printed:

| role | parcels | wait median | processing median |
|---|---|---|---|
| specifier | 14 | **1h 51m** | **1m** |
| documenter | 14 | 1h 28m | 1m |
| architect | 16 | 52m | 7m |
| QA | 9 | 43m | 14m |
| cleaner | 17 | 39m | 9m |
| hardender | 15 | 38m | **25m** |
| coder | 20 | 3m | 6m |

Reported bottleneck: **specifier (1.3x)**. That is queue+processing:
specifier ~112m vs documenter ~89m. Processing-only ranking would name
**hardender** (~25m, ~1.8x QA).

The wait is mailbox time while the mono-router resident is elsewhere — not
specifier capacity. Same lie would hit documenter.

## Goal

Bottleneck (and its "Nx the next slowest" multiple) is derived from
**median processingMs only**. Queue wait stays on the per-stage line; it
must not pick the bottleneck.

## Locked human decisions

1. Rank on processing time. Specifier is not a capacity bottleneck.
2. Do not "fix" it by excluding specifier. The formula is wrong for every
   dormant role.

## Specifier should decide (defaults welcome)

- Keep `totalDwellMs` on the JSON as processing median (rename if the field
  name would lie), or add `processingMedianMs` and rank that.
- Trend (`+35m vs prior`) currently follows queue+processing too; default:
  leave trend on total dwell unless it would keep lying in the briefing
  bottleneck sentence — then split.

## Out of scope

- Recomputing how queue-wait / processing are measured from headers.
- Coordinator (already excluded from the forward-chain report).

## Requested outcomes

1. Minted defect, Gherkin: a stage with huge wait and tiny processing cannot
   beat a stage with larger processing median.
2. Briefing/CLI "Bottleneck:" line matches that ranking.
