# BL-1277 — hardener pass

Hardener, 2026-08-30.

## Scope

`specs/pipeline/stepRegistry.js` gained only a read-only `listDefinitions()`
accessor; every other changed file is `extension/test/**` test/guard code or
`specs/pipeline/steps/**` step-registration churn (no handler logic changed).
No `extension/src` involvement — Stryker/CRAP/DRY do not apply (same basis
as the architect's two reviews and the prior BL-1274/1279/1280 passes this
shift).

## Re-verified the bounce fixes myself

- D1 (raw NUL byte): `python3 -c "... .count(b'\x00')"` on
  `bl1277StepCollisionInvariants.property.test.js` → **0**. `file` reports
  UTF-8 text (not `data`). Confirmed fixed independently of the architect's
  own re-pass.
- The architect's self-caught merge-drop
  (`require('./bl1277UnscopedStepCollisionSteps')` missing from
  `specs/pipeline/steps/index.js` after a three-way merge): confirmed present
  at line 877 in my own merged tree.

## Hand-authored mutation sweep

**Mutant: replace the marker-based verdict extraction in
`shippedCollisionVerdict` with a naive "last line of stdout".** The code
comment states this exists specifically because several shipped step files
import `node:test`, whose runner prints its own TAP report at exit — "found
by MARKER, never as the last line, which would be whatever TAP happened to
flush last." Hand-mutated (dropped the `.find(l => l.startsWith(MARKER))` in
favor of `lines[lines.length - 1]`, keeping the marker-strip as a
best-effort fallback) and re-ran
`bl1277UnscopedStepCollisionGuard.test.js`: the one test that calls the REAL
`shippedCollisionVerdict()` against the shipped repository goes red —
`SyntaxError: Unexpected token '#', "# duration"... is not valid JSON` —
because the real shipped step-file set does trip `node:test`'s TAP output
after the verdict line, exactly as the comment claims. Restored; diff clean;
6/6 green again. This is a genuine, already-covered mutant — good existing
coverage of the ticket's own most fragile mechanism, confirmed rather than
assumed.

## Verification

- `npx vitest run test/bl1277UnscopedStepCollisionGuard.test.js` — 6/6.
- `bl1277StepCollisionInvariants.property.test.js` (properties lane) — 5/5
  (collect phase ~45s — loads and permutes the real ~800-file step registry,
  consistent with the ticket's own "exhaustive over the ambiguous corpus"
  design).
- `node specs/pipeline/cli.js specs/features/BL-1277-...feature` — 5/5.
- The two features the collisions had silently broken:
  `BL-1268-stale-claim-branch-must-name-this-ticket.feature` — 7/7 (was
  2/7); `BL-378-no-single-file-bounds-the-suite.feature` — 4/4 (was 3/4).
- Full `vitest run --config vitest.config.mjs` (after `npm run compile`):
  **26 failed files / 218 failed tests / 9443 passed** — same failing-file
  count as the BL-1280 hardening baseline; the two new BL-1277 test files
  (guard + property) both pass, adding to the passed total, no new file
  entered the red set.
- Whole-tree guards for `extension/test/`: the same standing set as
  BL-1280's pass minus the one BL-1280 already fixed —
  `liveRepoDerivationGuard`, `socketFixtureShortRootGuard`,
  `tempDirTrapGuard` remain pre-existing red, confirmed by grep to name
  neither `bl1277` nor `stepCollisionGuard`. The new
  `bl1277UnscopedStepCollisionGuard.test.js` is itself picked up by the
  `*Guard*.test.js` glob and passes cleanly alongside them.

## CRAP / DRY / mutation-site count

Not applicable — no `extension/src` file in this ticket's diff; the one
`stepRegistry.js` change is a pure accessor addition with no branching
logic.

Forwarding to documenter.
