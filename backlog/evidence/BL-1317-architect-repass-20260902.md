# BL-1317 — architect re-pass after required_wiring amendment, 2026-09-02

Reviewed cleaner commit `420a30bd31` ("cleaner pass — NONE, no defect
found"), which forwards the coder's rework commit `00cc6872eb` ("rework on
the required_wiring amendment — Adapt is Babashka-only") unchanged.

## Context
QA bounced (`BL-1317-qa-bounce-20260902.md`, D1): required_wiring item 1
named a TypeScript caller (`effortDialAdapt.ts`) that cannot exist — the
outcome signal Adapt reacts to lives entirely on the Babashka side. The
specifier amended `required_wiring` (see ticket `notes:`) to name the real
Babashka-only wiring instead. The coder then deleted the unwired TS module
and repointed the property/parity tests at the live bb implementation.

## required_wiring verification (post-amendment)
1. `seat_difficulty_lib.bb::adapt-effort-decision` — present, line 249.
2. `handoff_lib.bb::record-effort-adapt!` — present, line 684.
3. `done_with_current_task.bb::record-effort-adapt-for!` — defined line 74,
   **called at line 123** inside `-main`'s real completion path (the exact
   flow every role's `done_with_current_task.bb` runs), immediately after
   `record-lean-ledger!` and before `run-ready!`. Confirmed live, not a stub.

Dead code check: `extension/src/tools/effortDialAdapt.ts` is deleted;
`grep -rln "effortDialAdapt" --include="*.ts" --include="*.js" .` (excluding
node_modules) returns nothing — no orphaned references.

## Checks run
- `npm run compile` (fresh) + `node out/tools/dependency-gate.js` on
  `effortDial.ts` and the two touched test files — PASSED, no forbidden
  edges.
- `npx vitest run test/bl1317AdaptSingleApplierPerLanguage.test.js` — 3
  passed (enforces one Adapt applier per language; TS has none).
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1317AdaptEffortInvariants.property.test.js` — 4 passed. Both
  declared invariants encoded: invariant 1 (never rewrites pack conf on
  disk) and invariant 2 (one-notch climb, whole-streak drop) — each folded
  through the REAL `seat_difficulty_lib.bb::adapt-effort-decision` in a bb
  subprocess per BL-897 discipline, not a JS mirror.
- `bb swarmforge/scripts/test/seat_difficulty_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb` — ALL PASS
  (unrelated quarantine/ambulance fixtures in the same file are pre-existing
  and unaffected).
- `bash swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh` — 5/5
  checks pass (BL-897 cross-language ladder parity, repointed at the bb lib
  vs `effortDial.ts`'s `EFFORT_LEVELS`, since the TS decision module is
  gone).
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1317-adapt-tier-effort-from-outcome-signals.feature` —
  3/3 scenarios pass, driving the real
  swarm_handoff/ready_for_next_task/done_with_current_task pipeline.

## Architecture read
- Policy stays pure-bb (`adapt-effort-decision`), IO edge separate
  (`record-effort-adapt!`), best-effort/non-blocking at the consumer
  (`record-effort-adapt-for!` wrapped in try/catch — a completion can never
  become a failure because the dial couldn't be retuned). Matches the
  BL-1316 sibling pattern.
- No pack-conf mutation on disk (invariant 1) — in-memory/respawn only,
  consistent with BL-235/BL-236 posture.
- Removing the dead TS module rather than leaving it in place resolves the
  QA bounce correctly (BL-149-class defect: untested-by-nothing-live code
  removed, not left as a trap).

## Verdict
Clean sweep. No defect found. Forwarding to hardener.
