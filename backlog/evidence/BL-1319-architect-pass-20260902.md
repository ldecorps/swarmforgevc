# BL-1319 — architect pass, 2026-09-02

Role: architect. Ticket: BL-1319-stage-dwell-names-the-stage-not-a-seat.

## Received
Cleaner commit `004d940eaf` (no cleanup findings; clean sweep). Merged into
architect — the merge also carried BL-1286's legitimate retirement (specifier,
`d472067646`: premise false at mint, feature demoted to `.feature.draft` with
byte-identical scenarios), named in the merge commit message per the
merge-deletion guard.

## Scope taken
Coder took the human ruling (`ruling_options` item 2: fold plus ops
seat-detail) over the stale `approval_context` prose, correctly flagging the
contradiction rather than silently picking a side — this is the right call
per Article 5.3 (a human ruling governs over prose written before it).

## Two spec gaps raised by the coder
Both routed by `note` (priority `00`) to the specifier, per Article 4.4 —
not this parcel's to encode:
1. The defect is a silent DROP (PIPELINE_ORDER filter excludes non-bare
   seats entirely), not a split-into-two-rows as the ticket's prose and
   qa_e2e describe — verified by reading `computeStageDwellReportForRoles`'s
   pre-fix filter and `PIPELINE_ORDER` (bare names only). Confirmed correct:
   this is strictly worse than what the ticket describes, and the fix (fold
   BEFORE the PIPELINE_ORDER filter, on the folded stage) still closes it.
2. Scenario 03's second clause is mathematically unsatisfiable under median
   ranking (a combined median can never exceed both inputs' medians) —
   confirmed by hand: if the folded stage outranks the comparison stage, at
   least one seat alone must too. The coder's step handler asserts the
   satisfiable part of the intent instead, with an explanatory comment
   rather than a silent reword. Correct handling.

## Architecture check
- Two-layer boundary intact; no I/O added to the webview; no process
  spawned from TypeScript. Change confined to `extension/src/metrics/`
  and `extension/src/tools/`.
- Dependency-rule gate (BL-259, hard gate): `node out/tools/dependency-gate.js
  src/metrics/stageDwell.ts src/tools/stage-dwell-report.ts` (from
  `extension/`) → **PASSED: no forbidden edges.**
- Co-change tool (BL-255): flagged neighbors are all pre-existing,
  already-tight (bridgeState.ts, swarmMetrics.ts, the CLI's own tests) — no
  new suspicious coupling from this parcel's diff.
- Reused `stageOfSeat` (exported by BL-1040 earlier the same day) rather than
  adding a second TS seat-splitter — `stageDwell.ts` already imported from
  `swarm/swarmState.ts`, so no new dependency edge, no cycle.
- Fold placed BEFORE `nameBottleneck` ranks (grouping into `seatsByStage`
  ahead of building report rows) — confirmed by reading the diff; ranking
  after picking would have left the ticket's stated consequence 2 (wrong
  bottleneck, not just wrong label) unfixed. `nameBottleneck` also folds
  defensively at its own entry since it is exported and ranks whatever it
  is handed — correct belt-and-braces, not duplicated logic.
- Ops seat-and-model view (`computeSeatDwellDetail`/`SeatDwellDetail`) is
  deliberately NOT wired into `StageDwellReportResult` — confirmed by
  grepping `bridge/bridgeState.ts`: it imports only
  `computeStageDwellReportForRoles`/`StageDwellReportResult`, never
  `computeSeatDwellDetail`/`SeatDwellDetail`. The bridge `/stage-dwell`
  payload therefore structurally cannot carry a seat id; the ops surface
  rides the CLI's own `--json` only, matching the ticket's requirement that
  "ops surfaces may show seat detail; the optimizer payload may not."
- Per-seat attribution preserved in `DwellRecord.role` (invariant 3) —
  folding happens only at report assembly, never at the record-read layer.

## Invariants Review (BL-633/654)
Three declared invariants, four properties in
`extension/test/bl1319StageDwellNamesTheStage.property.test.js` (120 runs
each). Coder's evidence documents one property (invariant 1) that was
initially VACUOUS — passing for the wrong reason (seat dropped, not folded)
until an assertion that folded rows account for every configured seat's
parcels was added — and shows all four properties now fail against a
deliberately broken implementation and pass restored. Re-ran independently:
`npx vitest run --config vitest.properties.config.mjs
test/bl1319StageDwellNamesTheStage.property.test.js
test/closingCeremonyDwellOccupancy.property.test.js` → 6/6 pass.

## Property Testing pass (undeclared coverage)
The four properties already cover the touched pure functions
(`computeStageDwellReportForRoles`, `nameBottleneck`,
`computeSeatDwellDetail`) against all three invariants. No additional gap
found.

## Verification (independent re-run)
- `npm run compile` — clean.
- `npx vitest run test/stageDwell.test.js test/stageDwellReportCli.test.js
  test/bridgeState.test.js test/swarmMetricsCli.test.js` — 100/100 pass.
- `node specs/pipeline/cli.js
  specs/features/BL-1319-stage-dwell-names-the-stage-not-a-seat.feature`
  — 5/5 pass, including the single-seat losslessness scenario.

## required_wiring
None declared, and the ticket explains why (no consumer wiring gap is
possible here since both live consumers already call into this module) —
correct, not an omission.

## D1..Dn (Article 4.4 complete inventory)
NONE. Clean sweep — dependency gate, co-change, invariants, property
coverage, bridge/CLI boundary, and correctness read all checked with no
findings.

## Disposition
Architecturally compliant. Forwarding unchanged to hardener.

By architect.
