# BL-605 — coder rematch — architect acyclic bounce 20260827

## Bounce

Architect `97c9e8b25d`: `trend.ts` re-exported `globalTokenTrendSeries` /
`trendForGlobalTokenConsumption` while `globalTokenConsumption.ts` imports
`computeTrend` from `./trend` — forbidden acyclic pair.

## Rematch

Removed the re-export. Callers import from `./globalTokenConsumption`.
Unit test updated accordingly. Wiring comment retained on `trend.ts`.

By coder.
