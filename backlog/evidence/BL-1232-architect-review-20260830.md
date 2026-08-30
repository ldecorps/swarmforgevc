# BL-1232 — architect review

Architect, 2026-08-30. Reviewed cleaner's merge of coder's `9c6200d726`.
Resolved one merge conflict in `specs/pipeline/steps/index.js`: cleaner's tip
still carries the `require('./bl1182DayLongBobTrialLifecycleSteps')` line
from the still-open BL-1182 (bounced back to coder, D1 unfixed as of this
review — `backlog/evidence/BL-1182-architect-bounce-20260830.md`). This
branch correctly has BL-1182's files reverted out; a naive union resolution
would have re-added a `require` for a file this branch does not have and
broken `index.js` at load. Excluded that line, kept BL-1232's own
registration, and verified `node -e "require('./specs/pipeline/steps/index.js')"`
loads clean afterward.

## Checks run, all clean

- `node extension/out/tools/dependency-gate.js` (full-repo AND the parcel's
  own `extension/src`/`extension/test` files) — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js` — only expected coupling
  (the shift-velocity/burndown chart family and BL-1184's own files); no
  surprising coupling introduced.
- Invariants Review (BL-633/654): all three declared invariants have live,
  non-vacuous property tests
  (`bl1232ShiftVelocityChartInvariants.property.test.js`). Re-ran
  `npm run test:properties -- bl1232`: 6/6. Worth flagging as a model of the
  practice this constitution asks for: the coder's own first cut of
  invariant 2 (end-to-end render over drawn lengths) was measured GREEN
  against the pre-fix index-thirds picker — i.e. vacuous, since it never
  actually exercised the failure mode — and was replaced with a property
  quantified over the picker directly against constructed clustered layouts,
  with a reach floor on how many draws are actually discriminating (40). Read
  the test file directly to confirm this is real, not just asserted in prose:
  confirmed.
- Re-ran the coder's headline claims directly:
  - `npx vitest run test/bl1232ShiftVelocityChartReadable.test.js`: 15/15.
  - `npm run test:properties -- bl1232`: 6/6.
  - `node specs/pipeline/cli.js specs/features/BL-1232-...feature`: 6/6.
  - `node specs/pipeline/cli.js specs/features/BL-1184-*.feature`: 6/6 (the
    locked `non-linear-time-axis-04` scenario survives).
  - `npx vitest run test/shiftVelocity.test.js`: 17/17.
  - `npm run test:properties -- bl1184BriefingShiftVelocity`: 3/3.
  - Full `vitest run --config vitest.config.mjs`: 26 failed / 218 failed —
    identical to the standing baseline. No regression.
- Read the source directly against the ticket's three contracts:
  - `nonLinearTimeX` in `shiftVelocityChart.ts`: age is normalized to `0..1`
    BEFORE the log (`Math.min(Math.max(age / maxAge, 0), 1)` then
    `log(1 + k*normalizedAge) / log(1 + k)`), fixing the units-dependence
    the ticket diagnosed as the shared root cause of failures 2 and 3.
  - `shiftVelocityAxisPlan`: body bound is `max(median×3, p75×2, 1)` (both
    terms, not one — the evidence file documents why a single percentile
    failed the coder's own property at a 5-day series); an over-cap value
    draws as a distinct triangle marker at the cap line carrying its true
    value as text, never silently clipped off-screen.
  - `pickLabelIndicesByPixelGap` in `briefingChartSvgCommon.ts`: right-to-left
    greedy walk, always keeps the most recent index, `MIN_DATE_LABEL_GAP_PX =
    72` derived from the rendered label width rather than a magic constant —
    matches `required_wiring`'s literal anchors exactly, confirmed both
    functions exist at the named paths.
  - Metric/aggregation untouched: `buildShiftVelocitySvg` still plots
    `landedMax` as received; `shiftVelocity.ts` (the 8h-window adapter) is
    absent from this parcel's diff.
- Architecture: no layering concern. `pickLabelIndicesByPixelGap` correctly
  lands in the shared `briefingChartSvgCommon.ts` (consumable by the burndown
  chart later, per the ticket's own `required_wiring` note) rather than
  private to `shiftVelocityChart.ts`. No dependency-direction change.

No defect found. Forwarding to hardener.
