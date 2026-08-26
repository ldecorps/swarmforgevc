# BL-1153 — architect pass (rematch) — 20260826

- merge_and_process cleaner tip `817bcfa516` (bridge add/add conflicts in
  `bridgeServer.ts`, `residentSpyUiHtml.ts`, `pipelineGridUiHtml.ts`,
  `pausedPagerUiHtml.ts` — resolved to cleaner/incoming).
- Tree preserved: **8816** tracked paths (additive merge).

## Architecture / boundaries

- Host-persisted preference in `webUiFontSizePreference.ts` under
  `.swarmforge/operator/`; routes in `webUiFontSizeRoutes.ts`; shared Mini App
  script in `webUiFontSizeMiniAppScript.ts`. Webview fetches `/web-ui-font-size`
  only — no localStorage/sessionStorage in BL-1153 HTML generators (Rule 3).
- Extension host owns I/O; webview presentation + postMessage/fetch seam only.
- Dependency gate (BL-1153 bridge sources): **PASSED**.
- Co-change: expected coupling within the BL-1153 slice (preference + three Mini
  App HTML generators + routes + tests); no forbidden cross-layer edges.

## Prior bounce D1 — resolved

- `residentSpyUiHtml.test.js` + `webUiFontSizePreference.test.js` run green under
  vitest (16/16); rematch restores vitest registration (prior `node:test` load
  failure cleared).

## Invariants

1. **No browser storage in Mini App persistence path** — `residentSpyUiHtml.test.js`
   Rule-3 grep + APS scenario 04 (static HTML inspection).
2. **Corrupt/missing fallback to surface default** — `webUiFontSizePreference.test.js`
   (corrupt JSON, missing key, non-number value) + `resolveWebUiFontSizePx` unit
   coverage.

Both encodings non-vacuous (corrupt-file test fails if fallback removed).

## Required wiring

- APS `bl1153StickyWebFontSizeChoiceSteps` registered in `index.js`.

## Property-testing pass (undeclared)

- `webUiFontSizePreference.ts` is pure; clamp/round-trip could carry properties,
  but declared invariants already encoded in unit + APS lanes. No new
  `*.property.test.js` added.

## Out-of-ticket merge artifacts (BL-506 note for QA)

- Cleaner merge carries BL-728 docs/evidence, batch-recovery tool paths,
  stop-swarm cron, BL-660 yaml — not BL-1153 core; stage only BL-1153 paths at
  QA integration.

Pass → hardender.

By architect.
