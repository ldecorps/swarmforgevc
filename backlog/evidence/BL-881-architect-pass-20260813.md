# BL-881 — architect re-review after bounce fix (2026-08-13)

Reviewed commit: `b95dacf5a` (coder), merged via `39e2b68676` (cleaner,
merge_and_process only — no additional cleaner diff on BL-881 files).

Addresses my own bounce `af62f336e` (evidence:
`backlog/evidence/BL-881-bounce-20260813.md`), item D1 — the only item
raised, and the only item outstanding.

## D1 — `nowMs` DI seam not wired at its call site: FIXED

`extension/src/bridge/bridgeServer.ts:1550` now reads
`compute: () => captureMonoRouterLiveScreen(targetPath, nowMs)`, matching
the three sibling routes in the same `buildJsonRoutes` table exactly as my
remediation specified. One line changed, plus a non-vacuous regression test
(`bridgeServer.test.js`, spies on `residentPaneLive`'s exported
`captureMonoRouterLiveScreen` and asserts the server-injected `nowMs`
reaches the call) — coder's evidence records reverting the fix and seeing
the new test fail (`expected 1786611600000, got undefined`) before
restoring it. No broken variant was ever committed.

## Checklist re-run (Article 4.4 — complete inventory, one pass)

- Dependency-rule gate (`node extension/out/tools/dependency-gate.js
  src/bridge/bridgeServer.ts`): **PASSED**, no forbidden edges.
- Co-change report on the changed files (`bridgeServer.ts`,
  `bridgeServer.test.js`): top hits are `bridgeServer.ts` ↔ its own test
  file (30 co-changes, expected) and a long tail of other bridge routes
  (`consoleMenuUiHtml.ts`, `epicReorderUiHtml.ts`, etc.) reflecting
  `bridgeServer.ts`'s pre-existing role as a wide routing hub — not new
  coupling introduced by this one-line parameter-threading fix. No action
  needed.
- Invariants review (BL-633/654), 3 declared — unaffected by this fix
  (it touches only the bridge HTTP call site, not `residentPaneLive.ts`'s
  cache logic):
  1/2. Encoded in `residentPaneLive.property.test.js`; independently reran:
     **1/1 pass**.
  3. No separate property test; stated non-encodability reason (fixed HTML
     constant) still sound, unaffected.
  No violation found in any of the three.
- Property-testing pass (undeclared properties on touched pure modules): no
  further untested property-shaped behavior in the touched modules — this
  fix's own new test is a wiring/spy assertion, not property-shaped, and is
  the correct test type for verifying DI threading.
- Ran the full verification set myself (not just trusting the coder's
  evidence file):
  - `npm run compile`: clean.
  - `npx vitest run test/bridgeServer.test.js`: **84/84 pass** (includes the
    new nowMs regression test).
  - `npx vitest run test/residentPaneLive.test.js`: **12/12 pass**,
    unchanged.
  - `npx vitest run --config vitest.properties.config.mjs
    test/residentPaneLive.property.test.js`: **1/1 pass**, unchanged.
  - Acceptance (`specs/pipeline/scripts/run_acceptance.sh
    specs/features/BL-881-resident-pane-live-capture-ttl-cache.feature`):
    **3/3 scenarios pass**.
- Correctness read: no further defect found. The fix is exactly the
  narrowly-scoped one-line change my bounce specified, with a properly
  non-vacuous regression test guarding it.

## Disposition

Architecturally compliant. No outstanding invariant, dependency, or
correctness issue. Forwarding to hardener.

By architect.
