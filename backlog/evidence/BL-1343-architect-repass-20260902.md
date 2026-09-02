# BL-1343 — architect re-pass after D1 rework, 2026-09-02

Reviewed cleaner commit `e81e1bdbfc` (readability fix only), forwarding
coder's rework `f89d6eadff` ("rework on architect bounce D1 - the coverage
floor is reached by construction").

## D1 verification (from BL-1343-architect-bounce-20260902.md)
The generator now draws a SHAPE (`all-sibling` / `mixed` / `none-sibling`)
rather than an independent per-commit credit, and runs each shape as its
own dedicated `fc.assert` pass (`numRuns: 9` × 3 shapes = 27 cases,
matching the file's own claim of "breadth did not shrink" vs the old
`numRuns: 25`).

Re-derived the reach math by hand:
- `all-sibling` shape: `creditsFor` returns `'sibling'` for every file on
  EVERY draw — `reach.fullySubtracted` is now reached deterministically
  (P=1), not probabilistically.
- `none-sibling` shape: every credit is `'own'`/`'nobody'`, never
  `'sibling'` — `reach.nothingSubtracted` deterministic (P=1).
- `mixed` shape: forces index 0 to `'sibling'` and index 1 (when present)
  to a survivor — deterministic for `files.length >= 2`. Only degenerates
  to all-sibling when `files.length === 1` (an edge case of the `mixed`
  shape's own array generator, `minLength: 1`). Residual failure
  probability for `reach.partiallySubtracted`: needs all 9 `mixed`-shape
  draws to land `length === 1`, ≈ `(1/4)^9 ≈ 4×10⁻⁶` — and even then,
  `fullySubtracted`/`nothingSubtracted` are unaffected since they run in
  their own dedicated, fully deterministic shape loops.

**Empirical**: ran the property file 8 consecutive times — 8/8 clean (2/2
tests each run). Cleaner independently ran it 6 times post-reindent — 6/6
clean, same conclusion. Combined 14/14, consistent with the
now-near-deterministic design (contrast BL-1343's original: 1 failure in 6
runs pre-fix).

## Unchanged from my prior (already-approved) review
- `swarmforge/scripts/land_step_lib.bb`: byte-identical to the version I
  reviewed and approved before the bounce (`git diff` between the two
  commits' copies of this file — empty). Only the test changed, exactly as
  the bounce required.
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1343-replay-drops-the-tickets-own-path.feature` — 6/6
  scenarios pass.
- `node extension/out/tools/dependency-gate.js` on the touched test file —
  PASSED, no forbidden edges.
- `specs/pipeline/steps/index.js` registration for
  `bl1343ReplayDropsTheTicketsOwnPathSteps` confirmed present (restored by
  this rework after my earlier bounce-revert removed it along with the rest
  of the reverted commit).

## Verdict
D1 resolved correctly and verified independently non-flaky. No new defect.
Forwarding to hardener.
