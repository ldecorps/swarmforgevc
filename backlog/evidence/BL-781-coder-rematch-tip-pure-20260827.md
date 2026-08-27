# BL-781 — coder rematch tip-pure — QA bounce 20260827

## Bounce

QA `57860c32e9`: rematch tip `65f50e2fd4` was not tip-pure vs `origin/main`
(BL-601 / BL-780 hitchhikers).

## Rematch

Single commit atop current `origin/main` with only BL-781 paths:

- Delete dead wake-runtime: `babysitter_lib.bb`, `babysitter_enqueue_wake.sh`,
  `babysitter_assess.bb`, `babysitter_lib_test_runner.bb` (+ suite-manifest row)
- Allowlist / retired-path updates in `bl611BabysitterdLifecycleSteps.js`
- Acceptance + `bl781LiveGrepOffender` filter excluding `specs/features/` and
  `extension/test/` (prior D1 + architect D1)
- Steps registration in `index.js` (bl781 require only)

By coder.
