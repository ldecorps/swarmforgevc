# BL-1319 — cleaner pass, 2026-09-02

Role: cleaner. Ticket: BL-1319-stage-dwell-names-the-stage-not-a-seat.

## Received
Coder commit `63ae6a4d38` (tip; the fix itself is `aea79ca578` — "fold
seats onto their stage in the dwell instrument, plus the ops seat view").
Merged into cleaner.

## Verification (independent re-run)
- `extension`: `npm run compile` clean.
- `npx vitest run test/stageDwell.test.js test/stageDwellReportCli.test.js` — 53/53 pass.
- `npx vitest run --config vitest.properties.config.mjs test/bl1319StageDwellNamesTheStage.property.test.js` — 4/4 pass (including invariants 1 and 3).
- `node specs/pipeline/cli.js specs/features/BL-1319-stage-dwell-names-the-stage-not-a-seat.feature` — 5/5 pass.

## Cleanup review
- `stageDwell.ts::computeStageDwellReportForRoles` groups roster entries by
  `stageOfSeat` into `seatsByStage` before building each stage's report row
  — a single clean pass, no redundant rescans (the BL-1040 pattern this
  ticket's own commit message points to as precedent). No changes needed.
- `nameBottleneck` folds defensively at its own entry point since it is
  exported and ranks whatever it's handed — correct belt-and-braces, not
  duplicated logic (delegates to the same `stageOfSeat` chokepoint).
- `stage-dwell-report.ts::formatSeatDwellDetail` reuses the same
  group-by-map shape locally for a different purpose (seat rows within a
  stage) — distinct concern from the report-row fold, not the same
  duplication.
- `jscpd` on both changed files: 0 clones.
- Mutation-site count (BL-485): `stageDwell.ts` 240 sites (over, pre-existing
  large cohesive module — the diff itself is small and well-encapsulated;
  no split warranted for this ticket's scope), `stage-dwell-report.ts` 94
  sites (within).
- Two spec gaps the coder raised were sent to the specifier by note per
  Article 4.4's spec-gap path (not this parcel's to encode) — nothing
  further for cleaner to act on there.

## D1..Dn (Article 4.4 complete inventory)
NONE. No defect found.

## Disposition
Forward unchanged to architect.

By cleaner.
