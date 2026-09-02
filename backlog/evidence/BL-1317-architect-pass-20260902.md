# BL-1317 architect pass — 2026-09-02

Reviewed commit: df349fbc73 (cleaner tip, forwarded unchanged from coder's
self-audited cfdb532b64).

## Architecture boundary checks
- Two-layer boundary: `effortDialAdapt.ts` is pure decision logic
  (`decideAdaptEffort`); `adaptRoleEffort` is the sole TS-side IO edge, reusing
  `switchRoleEffort` rather than composing a second write path. No new tmux
  bypass, no webview storage, no secrets touched.
- Dependency gate (`node extension/out/tools/dependency-gate.js`), scoped to
  the parcel's changed files AND full-repo: PASSED, no forbidden edges.
- Co-change report on `effortDialAdapt.ts`: all flagged co-changers are the
  expected pair (unit test, bb mirror, its test runner, the two consumer call
  sites) — no unexplained logical coupling.

## Invariants review (both declared, both required-wiring anchors present)
- `record-effort-adapt!` (handoff_lib.bb) and `decideAdaptEffort`
  (effortDialAdapt.ts) are both real call sites, not just declared —
  confirmed `record-effort-adapt-for!` calls the former from
  done_with_current_task.bb:123.
- Invariant 1 (never rewrites pack conf on disk): encoded as a non-vacuous
  property test (bl1317AdaptEffortInvariants.property.test.js), green.
- Invariant 2 (asymmetric one-notch climb / streak-gated drop): encoded as a
  non-vacuous property test with two explicit "rejects a decision that
  breaks this" checks, green.
- Cross-language ladder mirror (BL-897 constant-across-boundary rule): a real
  gate exists (test_bl1317_effort_ladder_parity.sh) reading both literals
  from their real sources, not restated. Initially reported FAIL on
  first run — traced to a stale `extension/out/` (the fallback source-regex
  path can't parse `ADAPT_EFFORT_LADDER = EFFORT_LEVELS`, an import rather
  than an array literal); recompiled (`npm run compile`) and the gate passes
  clean. Not a defect (architect-stale-build-gotcha).

## Test run (all green)
- `npx vitest run test/effortDialAdapt.test.js` — 18/18
- `npm run test:properties -- test/bl1317AdaptEffortInvariants.property.test.js` — 4/4
- `bb swarmforge/scripts/test/seat_difficulty_lib_test_runner.bb` — ALL PASS
- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb` — ALL PASS
- `bash swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh` — ALL PASS (after recompile)

No defect found in architect's domain. Forwarding to hardender.

By architect.
