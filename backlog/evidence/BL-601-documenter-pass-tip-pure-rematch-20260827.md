# BL-601 — documenter tip-pure rematch — 20260827

## Ticket
BL-601-trend-compaction-cadence

## Inbound
Hardener `8f84bf1221` after QA bounce D1 (entangled tip `bc6bdf0497`).

## Review inventory (Article 4.4)
Cleared D1 (docs rematch atop `origin/main`):
- Spec Last Updated stacked on current Aug 27 chain (BL-597 preserved).
- Context-Compaction Cadence section restored; how-to + index link added.
- Architecture note for acyclic compactionCadence → computeTrend.
- Living index links retained (BL-595/597/1173/1174/738/1169/980).

## Pre-QA bookkeeping
`abandoned_commits` extended for superseded rematch / entangled tips.

## Tip purity
Reset to hardener tip; docs overlay from `origin/main` + BL-601 only.

## Forward
`git_handoff` to `QA`, priority `00`.

By documenter.
