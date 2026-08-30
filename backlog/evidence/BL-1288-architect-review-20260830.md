# BL-1288 — architect review (clean pass)

Commit reviewed: d1a584966c (Merge coder BL-1288-only-a-rejected-push-authorises-discarding-local-commits into cleaner. By cleaner.)

## Checks run

- `node extension/out/tools/dependency-gate.js test/bl1288OnlyRejectionDiscardsInvariants.property.test.js`
  → PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js test/bl1288OnlyRejectionDiscardsInvariants.property.test.js`
  → all co-change counts are 1, below the suspected-coupling threshold (3). No flag.
- Two-layer boundary / host-owns-IO / no-webview-storage / secrets: not implicated — this parcel touches only
  `.bb` reconcile-library logic, its bb test runner, an APS step handler + CLI wrapper, the step registry, and one
  fast-check property-test file. No webview, no VS Code API surface, no process-spawn-from-view.
- `required_wiring` anchor (`specs/pipeline/steps/index.js::bl1288`): confirmed registered
  (`require('./bl1288PushFailureClassificationSteps')` at index.js:837), matching the feature file's step text.
- Declared invariants (ticket YAML `invariants:`, BL-654):
  1. "Local-ahead commits are discarded only when the remote REJECTED the push" — encoded in
     `extension/test/bl1288OnlyRejectionDiscardsInvariants.property.test.js`, driving the real bb function via the
     CLI harness. Non-vacuity shown against a reconstructed mutant.
  2. "The push's own error text reaches the caller's result" — encoded in the same file. Non-vacuity confirmed.
  Both invariants have live, non-vacuous property tests. No missing/vacuous-test send-back needed.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` → ALL TESTS PASS (includes the
  self-audit fix for `surface-message`'s missing `:push-unavailable` branch, and the merge-failure-log-tail check).
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb` → ALL PROPERTIES HOLD, 500 runs,
  including a non-vacuity demonstration for "a mutant that always resets regardless of push success is flagged."
- `npx vitest run test/bl1288OnlyRejectionDiscardsInvariants.property.test.js --config vitest.properties.config.mjs`
  → 3/3 passed.
- Caller review: `handoffd.bb`'s `master-main-rematch-onto-origin!` relabels `:push-unavailable` to its own
  `failure-outcome` before surfacing (pre-existing behaviour for every rematch failure, documented explicitly in
  06f8e804c7's commit message as an observed-not-fixed scope boundary — correctly left alone, matches the ticket's
  invariant wording which is about the caller's own result, which does carry the reason).
- `post_hotfix_merge_origin_lib.bb`'s `finish-rematch-recovery` discarding `:outcome`/`:error` is likewise
  pre-existing and out of this ticket's scope, per the same commit message — not a regression introduced here.

## Correctness read

No defect spotted. `push-rejection?` fails closed (only a recognised non-fast-forward stderr pattern authorises
discard; unrecognised/transport/credential/hook-policy failures all keep commits) — matches the ticket's stated
"fails CLOSED" design intent and the BL-1198 genuine-divergence path is provably unchanged (dedicated regression
tests + BL-1198 fixtures updated only to spell the rejection the way git actually does).

## Verdict

Architecturally COMPLIANT. Forwarding to hardener with the same task name, commit d1a584966c.
