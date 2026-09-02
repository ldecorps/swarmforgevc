# BL-1040 — architect pass, 2026-09-02

Role: architect. Ticket: BL-1040-seat-identity-never-escapes-on-the-observation-path.

## Received
Cleaner commit `345d66f35c` (efficiency cleanup to `heldRoleByTicketId`,
grouping ids by stage before the `ALL_SWARM_ROLES` pass; behavior-preserving).

## Architecture check
- Two-layer boundary intact: no new I/O added to the webview, no process
  spawned from TypeScript. The fix is entirely inside existing extension-host
  modules (`swarmState.ts`, `pipelineBoard.ts`) and the Babashka stage-map
  producer (`pipeline_stage_cli.bb`) — no boundary crossed.
- Dependency-rule gate (BL-259, hard gate): `node out/tools/dependency-gate.js
  src/concierge/pipelineBoard.ts src/swarm/swarmState.ts` (run from
  `extension/`) → **PASSED: no forbidden edges.**
- Co-change tool (BL-255): run against both changed TS files. All flagged
  files are `pipelineBoard.ts`'s long-standing, already-known hotspot
  neighbors (its own tests, `conciergeTick.ts`, other pipeline-board step
  handlers, `handoffd.bb`, etc.) — nothing newly or suspiciously coupled by
  this parcel's actual diff, which only adds an import of `stageOfSeat` from
  `swarmState.ts` (already an existing dependency direction) and a fold
  inside one function body.
- Reused chokepoint as directed: the bb-side change calls the existing
  `handoff-lib/seat-stage` rather than a fourth hand-rolled `@`-split;
  `seat-stage` is nil-safe (`(when role-name ...)`), so `role-for-observation`
  preserves the original nil-propagating behavior of the `:sent` branch's
  `some->` chain when no `to:` header is found — checked by reading
  `handoff_lib.bb:403-407` against the diff, not assumed.
- Fold placed at three independent layers (bb source, TS reader chokepoint,
  TS renderer) as the ticket required (stale-file case: a map written by a
  pre-fix producer must still read correctly) — not alternatives, and the
  qa_e2e step 5 scenario (a stage map recorded by an older producer) is
  present and passes.
- `role-order`/`compute-stage-map` now dedupes to distinct STAGES
  (`vec (distinct (map seat-stage ...))`), so a multi-seat stage occupies
  exactly one position in precedence order — verified against the ticket's
  invariant 2 and the "does not widen the board" qa_e2e step 4 scenario.

## Invariants Review (BL-633/654)
Three declared invariants; coder's evidence names the property file
(`extension/test/bl1040SeatIdentityObservationPath.property.test.js`, 4
properties, 300 runs each) and demonstrates non-vacuity (broken fold fails
inv 1/2/3, broken pipeline-order iteration fails the precedence property).
Re-ran independently:
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1040SeatIdentityObservationPath.property.test.js` → 4/4 pass.
No violation found on hand review of the three layers against each declared
invariant; property coverage exists and is non-vacuous.

## Property Testing pass (undeclared coverage)
The four properties already cover the touched pure functions
(`stageOfSeat`, `heldRoleByTicketId`, `normaliseBareRoleStage`/
`normaliseObjectStage`) against all three declared invariants plus the
precedence interaction. No additional property-shaped gap found on the
touched surface.

## Verification (independent re-run)
- `npm run compile` (extension) — clean.
- `npx vitest run test/pipelineBoard.test.js test/state.test.js` — 172/172 pass.
- `bash swarmforge/scripts/test/test_pipeline_stage_cli.sh` — ALL CHECKS
  PASSED, including all four BL-1040 cases.
- `node specs/pipeline/cli.js
  specs/features/BL-1040-seat-identity-never-escapes-on-the-observation-path.feature`
  — 6/6 pass, including the stale-file scenario.

## Correctness read
No defect spotted beyond what the cleaner already fixed (redundant O(roles ×
keys) rescan, addressed in `345d66f35c`, behavior-preserving and re-verified
green here).

## D1..Dn (Article 4.4 complete inventory)
NONE. Clean sweep — dependency gate, co-change, invariants, property
coverage, and correctness read all checked with no findings.

## Disposition
Architecturally compliant. Forwarding unchanged to hardener.

By architect.
