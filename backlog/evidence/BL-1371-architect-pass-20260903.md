# BL-1371 — architect pass, 2026-09-03

Reviewed commit `b8eac3c258` (cleaner, no functional change over coder's `5a54d66774`).

## Architecture checklist

- Two-layer boundary (view/tmux substrate), extension-host I/O ownership, no
  webview storage, secrets-in-host-only, integrate-not-fork: not applicable —
  this parcel touches only the acceptance-pipeline step registry
  (`specs/pipeline/steps/index.js`), its own new step handler, and the
  TypeScript feature-handler-registration gate. No webview/extension-host/UI
  code touched.
- Dependency-rule gate (`node out/tools/dependency-gate.js`), scoped to the
  parcel's two changed `.ts` files and full-repo: **PASSED, no forbidden
  edges**, both scoped and full-repo.
- Co-change report (`node out/tools/co-change-report.js`) over the parcel's
  changed files: all flagged coupling is intra-parcel (evidence files, the new
  handler, its tests, `featureHandlerRegistrationCheck.ts`/`Types.ts`,
  `index.js`) or pre-existing BL-1303-era coupling on
  `featureHandlerRegistrationCheck.ts` — nothing suggesting an
  out-of-parcel/cross-ticket entanglement.
- `grep -rl` swept: no other-role failure encountered this pass to route.

## Invariants review (Article, BL-633/654)

All three declared invariants have non-vacuous property-test encodings,
confirmed present and green this pass, reach floors recorded by the tool
itself:

- Invariant 1 (set equality/superset, never count) →
  `bl1371StepDiscoveryInvariants.property.test.js` P1, 120 draws
  (`equalSized:120, noHandlers:27, withSubdir:81`), plus the coder's one-time
  937-identity / 13754-registration set-diff and 19693-step resolution-parity
  migration proof.
- Invariant 2 (loud, file-naming failure on an unloadable handler) → P2, 120
  draws across 4 failure shapes × 3 positions, `loadHandler()` wraps and names
  the file while preserving the cause's stack.
- Invariant 3 (no shared-file edit to register a handler) → P3, 120 draws,
  asserts the registry byte-identical and exactly one file added.

No violation found against any of the three.

## Correctness read

- `isDiscovered()` / `discoveredHandlers()` in
  `featureHandlerRegistrationCheck.ts` correctly narrows (not retires) the
  BL-1303 commit gate, matching the ticket's explicit instruction not to
  delete a gate as a side effect. The `HANDLER_SUFFIX` literal is mirrored
  between `specs/pipeline/steps/index.js` and
  `extension/src/tools/featureHandlerRegistrationTypes.ts`, and
  `bl1371StepDiscovery.test.js:210-213` asserts the two literals agree
  (BL-897's rule) — checked directly, not taken on the coder's word.
- `stepCollisionGuard.js` and `materializedRegistryGuard.js` were updated to
  ask `discoverHandlerFiles()` directly rather than restating a glob or
  reading `require.cache`, so neither guard can drift from what the runner
  actually loads.
- Discovery stays eager at module load (`HANDLERS = loadHandlers()` at
  `index.js:102`), preserving BL-968 invariant 1's "nothing changes what a
  step file may do at module load" semantics — checked against the coder's
  stated decision and found consistent with the code.
- No correctness defect found.

## Verification run this pass (not merely trusted from prior verdicts)

- `dependency-gate.js` (scoped + full-repo): PASS.
- `co-change-report.js`: reviewed, no cross-ticket coupling.
- `npx vitest run` on the 3 touched unit suites: 45/45 pass.
- `npx vitest run --config vitest.properties.config.mjs` on the 2 touched
  property files: 6/6 pass, reach floors as above.
- `swarmforge/scripts/test/test_check_feature_handler_registration.sh`: 9/9
  PASS.
- `run_acceptance.sh` on the BL-1371 feature: 5/5 scenarios pass.

## Verdict

PASS. No architecture violation, no invariant violation, no correctness
defect. Forwarding to hardener.
