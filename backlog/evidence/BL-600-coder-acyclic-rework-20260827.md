# BL-600 — coder rematch — break humanDecisionLatency↔trend cycle — 20260827

Architect bounce D1: dep-gate acyclic failed because `trend.ts` re-exported
`trendForDecisionLatencyMedian` while `humanDecisionLatency.ts` imports
`computeTrend`.

## Fix
- Tip-pure on origin/main with BL-600 wiring.
- Do **not** re-export from `trend.ts` (same pattern as BL-601).
- Acceptance steps and callers import from `humanDecisionLatency`.
- Unit test locks the missing re-export.

By coder.
