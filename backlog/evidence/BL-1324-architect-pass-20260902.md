# BL-1324 — architect pass, 2026-09-02

Reviewed commit `96b8249a74` (cleaner re-pass after bounce fix), merged into
architect as `946a179b98`. This is a review-only BL-848 stamp-off parcel: no
production wiring is touched — only new step handlers, a property test, and
evidence files.

## Checks run
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1324ClaudeSeatQwenCloudContextWindowInvariants.property.test.js` —
  3/3 pass, including invariant 2 (the bounce's fix, confirmed still green).
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1324-claude-seat-qwen-cloud-context-window.feature` —
  11/11 pass, matches qa_e2e_procedure's 8 scenarios plus the retired-BL-1325
  scenarios 07-08.
- Dependency gate (full-repo scan): PASSED, no forbidden edges.
- Co-change report on the new step-handler file: only expected sibling
  BL-1324 files, all below the frequency-3 threshold.
- `required_wiring` verified by hand against the live `swarmforge.sh` and
  pack conf: `extra_cli_targets_qwen_cloud`, the billing-guard branch, the
  `launch_role` elif, and the pack's `--model qwen3.8-max` window lines (at
  commit `4ed88430b2`, per qa_e2e_procedure item 1) all present and matching
  the ticket's description verbatim. `bl1324ClaudeSeatQwenCloudContextWindowSteps`
  registered at `specs/pipeline/steps/index.js:919`.
- Confirmed the ticket's own constraints are honoured: no production path
  touched by this parcel (`d6600cf186`/`ae33eaae99`/bounce-fix only add
  review apparatus and fix the property test); `backlog/hotfix-ledger.yaml`'s
  `4ed88430b2` row is still `state: stamp-open`, not certified/waived by this
  pass (invariant 2 held).
- Later operator commit `441fd35112` restaffs the pack's non-coder roles off
  qwen3.8-max back onto claude-sonnet-5 — outside this review's scope
  (qa_e2e_procedure reviews the state AT `4ed88430b2`), and already reported
  as such in `backlog/evidence/BL-1324-coder-stampoff-4ed88430b2-20260902.md`.
  Not a defect in this parcel.

## Architecture
- Two-layer boundary, webview storage, secrets, integrate-not-fork: N/A —
  parcel adds only acceptance-step JS and a property test exercising shell
  script behaviour already landed outside this parcel.
- No forbidden dependency edges; no unrelated co-change coupling.

## Verdict
Clean sweep — no defect found. Forwarding to hardener.
