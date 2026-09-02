# BL-1343 — cleaner pass on rework (2026-09-02)

One readability fix; otherwise NONE. Forwarded to architect.

## Reviewed

The coder's rework (32da1b6837..f89d6eadff) fixes architect bounce D1: the
property test's generator used to draw each commit's sibling-credit
independently (P≈0.12 per case of reaching the all-sibling corner), giving
each of the two invariant tests a ~4.6% chance of a spurious coverage-floor
red. The rework draws the SHAPE (all-sibling / mixed / none-sibling) instead
and runs each shape as its own property pass, so every corner is reached by
construction. No production code differs from the previously-reviewed
`land_step_lib.bb` fix — only the test's generator changed, matching the
bounce's diagnosis exactly.

## Fixed

`extension/test/bl1343ReplayNeverDropsOwnPathInvariants.property.test.js` —
wrapping each test body in `for (const shape of SHAPES) { fc.assert(...) }`
left the inner body at the old (pre-wrap) indentation, 2 spaces short of its
new nesting depth, plus a stray triple-blank-line where `filesArb` used to
sit. Re-indented both test bodies (invariant 1: lines ~191-225; invariant 2:
lines ~243-278) to match their actual nesting, collapsed the triple blank
to one, and stripped trailing whitespace left on two now-blank lines by the
reindent. No logic changed.

## Verification run (not assumed)

- `node --check` on the edited file → syntax OK.
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` → ALL PASS.
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1343-replay-drops-the-tickets-own-path.feature` → 6/6 pass.
- `npx vitest run --config vitest.properties.config.mjs bl1343ReplayNeverDropsOwnPathInvariants`, run 6 times consecutively after the reindent → 6/6 clean (2/2 tests each run), confirming D1 is resolved and the readability fix introduced no regression.

## Merge note

This batch item also required resolving a `specs/pipeline/steps/index.js`
merge conflict: kept the incoming `bl1343ReplayDropsTheTicketsOwnPathSteps`
require, since the coder's rework restores the step handler file this
branch's earlier bounce-revert (8bd2b3fe3b) had deleted. Confirmed the file
exists on disk and the module tree loads cleanly before committing.
