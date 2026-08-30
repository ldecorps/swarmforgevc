# BL-604 — architect review

Architect, 2026-08-30. Reviewed cleaner's merge of coder's `4d8bf05993`
(cleaner made no further changes). No merge conflicts this time.

## Checks run, all clean

- `node extension/out/tools/dependency-gate.js` (full-repo AND the parcel's
  own `extension/src`/`extension/test` files) — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js` — the only broad coupling
  flagged is `handoffd.bb` and `specs/pipeline/steps/index.js`, both
  high-traffic files with many unrelated tickets touching them; nothing
  surprising for the seam this ticket plugs into.
- Invariants Review (BL-633/654): both declared invariants have live,
  non-vacuous property tests
  (`bl604TrendAnalysisInvariants.property.test.js`). Re-ran
  `npm run test:properties -- bl604`: 4/4. Confirmed by reading the test file
  directly: invariant 1 compares the PARSED RENDERED TEXT against
  `computeTrend` called directly (not the struct that produced it — catches a
  builder that carries a correct field but prints the wrong word), and
  invariant 2 checks both directions of the "if and only if" with series
  length drawn from `{0, 1, many}` plus a dedicated throwing-loader property
  and a separate bound-only test, so the two reasons a bullet can be absent
  (untrendable vs. bounded) are never conflated.
- Re-ran the coder's headline claims directly:
  - `npx vitest run test/trendAnalysis.test.js`: 19/19.
  - `npm run test:properties -- bl604`: 4/4.
  - `node specs/pipeline/cli.js specs/features/BL-604-...feature`: 8/8
    (confirmed the ticket's own qa_e2e_procedure states "9 subtests" but the
    scenario/Examples enumeration it gives sums to 8, matching what the
    feature actually runs — an arithmetic slip in the procedure text, not a
    missing scenario; already flagged by the coder and independently
    reconciled here).
  - `bash test_handoffd_briefing_email_wiring.sh`: ALL PASS (unrelated to
    this ticket's own wiring test, but confirms no regression to the
    consolidated daemon's briefing sweep).
  - Full `vitest run --config vitest.config.mjs`: 26 failed / 218 failed —
    identical to the standing baseline. No regression.
- Read the source directly against the ticket's contracts:
  - `trendAnalysis.ts`: `analyseSeries` omits exactly when
    `computeTrend(...).direction === 'unknown'`, which (verified by reading
    `trend.ts`) is precisely when `series.length < 2` — so the
    null-guards on `delta`/`currentValue`/`priorValue` are defensive
    type-narrowing, never a second threshold. `trendSignificance` ranks by
    `|delta / prior|` (falling back to `|delta|` only when prior is exactly
    zero) — deliberately relative, so no series is permanently favored by
    unit scale; `significanceLine` names only the SHAPE of the move (small/
    material/doubled/steady), never whether it is good or bad news, which is
    exactly what invariant 1 forbids a second judgement from doing.
  - `loadTrendAnalysis` reuses `loadPointsSafely` (BL-603's own per-series
    try/catch) rather than reimplementing degrade-on-throw; confirmed by
    reading `trendsBoard.ts` directly.
  - `briefing_email_lib.bb`/`handoffd.bb`: the two-line adapter shape and one
    new `:trend-analysis-section` vector entry match all nine existing
    siblings exactly; `node-tool-line` (the shared shell-out helper) already
    degrades ANY CLI failure (throw or non-zero exit) to `nil`, so a
    catastrophic failure in the tool still cannot crash the sweep.
  - `trend-analysis-section.ts`'s `main()` prints nothing when the section is
    empty rather than a bare heading — correctly extends "absence of data is
    never a finding" all the way to the sent email, not just the builder.
- Architecture: no layering concern. Pure builder / impure loader / thin CLI
  split matches the established briefing-section shape exactly; no new
  producer or instrumentation, `computeTrend` and the registry untouched.

No defect found. Forwarding to hardener.
