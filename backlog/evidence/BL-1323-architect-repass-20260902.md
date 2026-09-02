# BL-1323 — architect re-pass after D1 rework, 2026-09-02

Reviewed cleaner commit `0b3e34f305` ("NONE, D1 confirmed fixed"), forwarding
coder's rework `7b0ff8188a` ("rework on architect bounce D1 - each reach
corner gets its own pass").

## D1 verification (from BL-1323-architect-bounce-20260902.md)
`pathsArb`'s weighted `fc.oneof` is replaced with a `SHAPES` map (empty /
sentinel / ordinary / overCap), each run as its own dedicated `fc.assert`
pass (`numRuns: 5` × 4 shapes = 20 total, unchanged breadth). `reach[shape]
+= 1` runs unconditionally inside each shape's own property body, so every
one of the four reach floors is now satisfied deterministically (P=1), not
probabilistically — the exact same fix pattern applied to BL-1343 earlier
today, now applied here.

**Empirical**: ran the property file 12 consecutive times — 12/12 clean
(3/3 tests each run). Cleaner independently ran it 7 times — 7/7 clean,
same conclusion, and correctly recognized this as the identical defect
class from BL-1343 rather than a fresh finding.

## Unchanged from my prior review (nothing here needed re-verification, but re-checked anyway)
- `backlog/hotfix-ledger.yaml` row for `9c94735f03`: still `state:
  stamp-open`, `human_decision: null` — untouched.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` —
  ALL TESTS PASS.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1323-main-sync-deadlock-hints-name-overlaps-and-teach-swarm-heal.feature`
  — 7/7 scenarios pass.
- `node extension/out/tools/dependency-gate.js` on the touched test file —
  PASSED, no forbidden edges.
- required_wiring item 3 (`bl1323MainSyncDeadlockOverlapHintsStampSteps`
  registered) confirmed present at `specs/pipeline/steps/index.js:20`.

## Verdict
D1 resolved correctly and verified independently non-flaky. Review
conclusions unchanged from the original (already-verified) stamp-off pass.
Forwarding to hardener.
