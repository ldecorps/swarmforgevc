# BL-1319 — hardener pass, 2026-09-02

Reviewed commit `aefa5f0fe4` (architect clean sweep) plus the coder's spec-
amendment commit `425fa839d6` (acceptance handler rework), both merged into
hardender. Real production change: the stage-dwell instrument's seat fold in
`extension/src/metrics/stageDwell.ts`, plus its CLI/bridge consumers.

## Load / process hygiene
- `uptime`: load average quiet (0.86-3.18 on 20 cores).
- `pgrep -fl 'node --test|stryker'`: no strays before starting.

## Verification (independent re-run)
- `npm run compile` — clean.
- `npx vitest run test/stageDwell.test.js test/stageDwellReportCli.test.js
  test/bridgeState.test.js test/swarmMetricsCli.test.js` — 221/221 pass
  (combined with BL-1283's `conciergeTick.test.js` in the same run, since
  this batch processed both tickets together).
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1319StageDwellNamesTheStage.property.test.js
  test/closingCeremonyDwellOccupancy.property.test.js` — 6/6 pass.
- `node specs/pipeline/cli.js
  specs/features/BL-1319-stage-dwell-names-the-stage-not-a-seat.feature`
  — 5/5 pass, matching architect's evidence.

## Stryker blocked again — hand-authored fallback
- Attempted Stryker on `out/metrics/stageDwell.js` with the same
  temporary-config technique used for BL-1040 earlier today (uncommitted
  `vitest.stryker-*.tmp.config.mjs` excluding the ~24 already-confirmed
  unrelated standing reds, plus `bl1300HeadroomProofIsPinned.test.js`, whose
  git-archive step fails only inside the Stryker sandbox — the specific
  BL-1040 sandbox failure). Confirmed the excluded set green standalone
  (569 files, 9609 tests) before launching.
- Hit a THIRD, different sandbox-only unrelated failure inside Stryker's
  own dry run: `checkFreshnessViaCli runs the real built CLI and returns
  its stdout` — "expected the real CLI to produce output" — a failure mode
  specific to the sandbox environment, not reproducible in a plain
  `vitest run`. Given three distinct unrelated sandbox failures across two
  tickets in one day (BL-1040: `liveRepoDerivationGuard` +
  git-archive-of-historical-commit; BL-1319: this CLI-output failure),
  stopped chasing an open-ended exclusion list rather than keep widening
  it — consistent with BL-1244's documented "main and origin/main have
  diverged significantly" observation. All temporary Stryker artifacts
  deleted, nothing committed, `git status` confirmed clean.
- **Fell back to a hand-authored mutation sweep** on every function this
  parcel's diff touched or added, verified against `test/stageDwell.test.js`
  and the property test (4 properties, 120 runs each per architect's
  evidence) — each mutant hand-applied, compiled, confirmed to fail the
  suite, then reverted and confirmed green:
  1. `nameBottleneck`: remove the `stageOfSeat(s.role)` fold, use `s.role`
     directly — killed (1 unit + 1 property failure).
  2. `computeStageDwellReportForRoles`: filter membership on `entry.role`
     (bare) instead of `stageOfSeat(entry.role)` (the exact pre-fix drop
     bug) — killed (2 unit + 1 property failures).
  3. `computeStageDwellReportForRoles`: keep the fold's filter correct but
     key the merge map on `entry.role` instead of `stage` (seats of one
     stage no longer merge into one row) — killed (2 unit + 1 property
     failures). Distinct from mutant 2: this isolates the MERGE-KEY
     mechanism from the FILTER mechanism, per the "overlapping guards each
     need an isolating test" discipline.
  4. `computeSeatDwellDetail`: use `entry.role` instead of
     `stageOfSeat(entry.role)` for the `stage:` field — killed (1 unit + 1
     property failure).
  All four confirmed real, not vacuous. `stageDwell.ts` restored to its
  exact pre-mutation state after each, verified via `git status --short`
  (empty) after the final restore.

## CRAP and DRY
- `npx jscpd extension/src/metrics/stageDwell.ts
  extension/src/tools/stage-dwell-report.ts --min-lines 15 --min-tokens 50`
  — 0 clones.
- `node scripts/crapReport.js src/metrics/stageDwell.ts
  src/tools/stage-dwell-report.ts` (coverage forced via
  `--coverage.reportOnFailure=true`, same unrelated-standing-red workaround
  documented in BL-1040's evidence): **zero functions exceed CRAP<=6** in
  either file. Highest is `formatSeatDwellDetail` at exactly 6.00 (the
  threshold, not over it). No regression to fix this pass.

## Babashka side
No `.bb` file touched by this parcel (`git diff --stat` against the
Babashka scripts glob is empty) — nothing to hand-sweep here.

## Whole-tree acceptance guard sweep
Parcel touches `specs/pipeline/steps/` and `extension/test/`: ran all 16
`test/*Guard*.test.js` files — 3 pre-existing failures
(`tempDirTrapGuard`/`socketFixtureShortRootGuard`/`liveRepoDerivationGuard`,
tracked BL-1289/1290/1291, same as confirmed during BL-1040's pass earlier
today) — grepped, none name any BL-1319 file.

## Lessons
No new `rule_proposal`. The Stryker-sandbox-blocked pattern is now
confirmed across three distinct failure classes in one day; if a fourth
recurrence happens on a future ticket, that would be worth escalating as a
`type: defect` per the standing rule's "escalate on the second one"
discipline for a different-but-related class of tool failure — not yet
warranted here since each was a genuinely distinct cause.

## Verdict
Clean sweep — no defect found, no CRAP regression, mutation coverage
confirmed real via hand sweep. Forwarding to documenter.
