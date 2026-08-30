# BL-1232 — hardener pass

Hardener, 2026-08-30. Merged architect's `339e53b69a` (no defect found;
review confirmed all three declared invariants, `required_wiring`, and the
locked BL-1184 contract).

## Mutation cooldown gate (BL-149) — SKIPPED, in-cooldown

Both changed production files are inside the 3-day cooldown window:

```
extension/src/metrics/briefingChartSvgCommon.ts  DECISION: skip-cooldown  file_age_days: 2.38
extension/src/metrics/shiftVelocityChart.ts      DECISION: skip-cooldown  file_age_days: 2.34
load_avg: 9.48  cores: 20  busy_threshold: 2.00x (quiet)
```

Load was quiet (host would have permitted a run), so this is a genuine
cooldown skip, not a busy-host deferral. No Stryker mutation run performed
on either file this pass, per Article/BL-149.

## Re-verified the architect's headline claims (all clean)

- `npm run compile` (extension/) — clean.
- `npx vitest run test/bl1232ShiftVelocityChartReadable.test.js
  test/shiftVelocity.test.js` — 32/32.
- `npm run test:properties -- bl1232` —
  `bl1232ShiftVelocityChartInvariants.property.test.js` 6/6.
- `node specs/pipeline/cli.js specs/features/BL-1232-shift-velocity-chart-readable.feature`
  — 6/6 (acceptance pre-check, fresh compile first per BL-497).
- `node specs/pipeline/cli.js specs/features/BL-1184-*.feature` — 6/6, the
  locked `non-linear-time-axis-04` scenario still green.
- Full `npx vitest run --coverage` (whole suite): 26 files failed / 218
  tests failed, 549/9458 passed otherwise — identical count to the
  architect's and BL-1277's recorded standing baseline. No regression;
  `coverage-final.json` was not written on that run (all-failure-suppresses-
  write, documented lesson) so CRAP was measured on a scoped coverage run
  instead (below).

## CRAP (src/*.ts, scoped coverage run)

`npx vitest run --coverage test/bl1232ShiftVelocityChartReadable.test.js
test/shiftVelocity.test.js` (both files' own dedicated tests, 32/32) wrote a
clean `coverage-final.json`. `crapReport.js` against both changed `src/*.ts`
files:

```
briefingChartSvgCommon.ts  niceChartAxisMax            complexity=5  coverage=100%  CRAP=5.00
briefingChartSvgCommon.ts  pickLabelIndicesByPixelGap  complexity=4  coverage=100%  CRAP=4.00
shiftVelocityChart.ts      buildShiftVelocitySvg       complexity=3  coverage=100%  CRAP=3.00
shiftVelocityChart.ts      percentile                  complexity=2  coverage=71%   CRAP=2.09
shiftVelocityChart.ts      shiftVelocityAxisPlan       complexity=2  coverage=100%  CRAP=2.00
... (remaining functions complexity 1-2, all CRAP <= 2.09)
```

All changed functions <= 6.00 (max 5.00). No differential complexity
regression versus `main` — every touched function here is new code from
this ticket, not pre-existing debt.

## DRY

`npx jscpd src/metrics/briefingChartSvgCommon.ts
src/metrics/shiftVelocityChart.ts --min-lines 10`: 0 clones, 0% duplicated.

## Whole-tree standing guards (parcel touches `extension/test/` and
`specs/pipeline/steps/`)

Ran every non-property `test/*Guard*.test.js` (17 files). 3 failed —
`liveRepoDerivationGuard.test.js`, `socketFixtureShortRootGuard.test.js`,
`tempDirTrapGuard.test.js` — all three confirmed by grep to be the exact
pre-existing standing-red set named in the immediately prior
`backlog/evidence/BL-1277-hardener-pass-20260830.md` ("the same standing set
as BL-1280's pass... remain pre-existing red"). None names `bl1232` or
either changed source file. Not this parcel's defect.

## Property/property-lane

`npm run test:properties -- bl1232`: 6/6, matches architect's re-run.
Not folded into unit/CRAP/mutation figures.

## Orphan process check

`pgrep -fl 'node --test|stryker|vitest'` clean before handoff — no leftover
test/mutation processes.

## Verdict

Fully hardened within this pass's scope. Mutation testing deferred to the
next pass once the 3-day cooldown clears (both files land it at ~2026-09-02).
No mutation-coverage gap identified by inspection to flag ahead of that run.
Forwarding to documenter.
