# BL-1056-a — architect pass, 2026-09-02

Reviewed commit `85c8e8607a` (cleaner, merged as this worktree's tip).

## Checks run
- `node extension/out/tools/dependency-gate.js` on all changed files (after
  fresh `npm run compile`): PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js` on all changed files: only
  expected coupling (own test file, `specs/pipeline/steps/index.js`,
  sibling metrics modules already co-changed under BL-627). No new suspected
  coupling worth a note.
- Unit tests: `pricingTable.test.js`, `costTelemetry.test.js`,
  `costHealthSidecar.test.js` — 125 passed.
- Property tests (declared invariants, BL-654 review):
  `pricingWindows.property.test.js` — both declared invariants encoded
  (rate resolution at a constructed boundary offset; fail-loud null on an
  uncovered instant). Confirmed NON-VACUOUS by hand-breaking
  `resolveRatesAt`'s boundary comparison (`< endOfWindow` → `true`) and
  observing invariant 2 fail (0.3 !== null) before restoring.
- Acceptance: `node specs/pipeline/cli.js specs/features/BL-1056-a-...feature`
  — 10/10 scenarios pass. Step handler registered in
  `specs/pipeline/steps/index.js` per `required_wiring`, scoped to this
  feature (BL-425 discipline).

## Architecture read
- Pure data/logic change in `extension/src/metrics/`; no I/O added beyond
  the existing roster-scan pattern in `pricingTable.ts` (unchanged).
- `pricing-windows.ts` CLI is a thin wrapper over `listPricingWindowAlerts`
  (`runCliMain`/`printJsonToStdout` from `swarm-metrics`), consistent with
  the CLI thin-wrapper rule.
- No webview/VS Code API touched. No secrets. No seat/model mutation of any
  kind — ticket's FIRM governance note (query only) is respected: the diff
  only reads/costs, never writes a seat or conf.

## Verdict
Clean sweep. No defect found. Forwarding to hardender.
