# BL-1338 — architect pass, 2026-09-02

Reviewed commit `17b4e11ef4` (cleaner, forwarded unchanged) on top of coder
commit `69ae1c2ee3`.

## Dependency-rule gate (hard gate, BL-259)
`node extension/out/tools/dependency-gate.js src/tools/deprecate-check.ts`
→ PASSED, no forbidden edges.

## Co-change coupling (BL-255)
`node extension/out/tools/co-change-report.js src/tools/deprecate-check.ts`
→ every reported file at 1 co-change, below the default min-frequency (3).
No coupling flagged.

## Invariants review (BL-633/654)
Ticket declares two invariants, both encoded as property tests in
`extension/test/deprecateRoutingStampFingerprint.property.test.js`
(`invariant 1`, `invariant 2`).

- First run against the built `out/` failed invariant 2 — traced to a
  **stale build** (`out/tools/deprecate-check.js` predated the coder/cleaner
  commits and had no `fingerprintableTicketText` export at all). Ran
  `npm run compile`; both properties then passed. Not a code defect —
  documenting per the stale-build gotcha.
- Non-vacuity check: patched the compiled `computeTicketFingerprint` back to
  a whole-text hash (the pre-BL-1338 behavior) and reran the property file —
  invariant 2 failed as expected (counterexample:
  `id: BL-1\ntitle: " "\nstatus: todo\n`, role `coder` twice). Restored the
  real build; both properties green again. The test bites.
- `invariant 1` (substantive edit still re-arms) also verified passing on
  the correct build; construction (base ticket + substantive amendment,
  stamp applied on either side) matches the invariant's own wording.

## Unit tests
`npx vitest run extension/test/deprecateAdjudication.test.js` → 19/19 green.

## Acceptance
`specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-1338-a-routing-stamp-does-not-invalidate-an-adjudication.feature`
→ 5/5 green, including the promoted-ticket scenario driving the real
`promote_and_route_next.sh` against a git fixture.

## Correctness read
Traced `fingerprintableTicketText`'s two regexes against
`swarmforge/scripts/promote_and_route_next.sh`'s two routing-stamp writers
(append at line 417, in-place `sed` rewrite at line 413) — both mutation
shapes are exactly what the regexes neutralize. No asymmetry found between
the append case (stamp line fully removed) and the rewrite case (value
erased, line kept) that would let a real routing change slip past
undetected or a real spec edit slip past unre-armed.

## Verdict
No defect found in architect's domain. No property-coverage gap (both
declared invariants + the coder's own touched-module properties are
present and non-vacuous). Forwarding unchanged to hardener.

By architect.
