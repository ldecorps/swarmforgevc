# Documenter evidence — BL-601 (acyclic rematch)

## Ticket
BL-601-acyclic-cycle-bounce / BL-601-trend-compaction-cadence

## Hardener tip
995881da0c

## Review inventory (Article 4.4)
NONE.

## Docs impact
- Spec Last Updated + Context-Compaction Cadence section (signal, ledger,
  aggregation, acyclic import rule).
- How-to `docs/how-to/BL-601-trend-compaction-cadence.md` + `docs/index.md`.
- `architecture.mmd` note: compactionCadence → computeTrend, no re-export.

## Pre-QA bookkeeping
- `abandoned_commits`: first-lineage / bounce / cleaner tips not on rematch tip
  (`8cea3c3e59`, `d483f10527`, `809f0dab14`, `1228838bc3`, `2f777fc113`,
  `a2e4e88a34`, `2faa3e5210`).
- `required_wiring` needles realigned to tip-pure paths after acyclic fix
  (store + `aggregateCompactionCadence` / `trendForCompactionCadencePerHour`;
  `trend.ts` = `computeTrend` only, no back-export).

## Acceptance cross-check
Aligned with `specs/features/BL-601-trend-compaction-cadence.feature`.

By documenter.
