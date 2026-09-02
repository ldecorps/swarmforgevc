# BL-1332 — architect pass, 2026-09-03

Reviewed cleaner commit `327fbbf238` (no production defect, one downstream
observation), forwarding coder's `fd94ef4a63` (human ruling option 1, refuse
on a shared path with an unlanded sibling).

## The fix, verified against human ruling option 1
`swarmforge/scripts/land_step_lib.bb::own-paths` — new `cond` branch,
confirmed correctly positioned AHEAD of the existing sibling-only-exclusion
branch (read the source: lines 336-354 fire before 358-364), so a shared
path is caught before the pre-existing exclusion logic can silently drop or
keep it. Refuses naming path, landing ticket, and sibling(s) — confirmed by
reading the refusal string construction.

## Checks run (not assumed)
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1332-a-shared-path-carries-the-siblings-lines.feature`
  — 6/6 scenarios pass.
- `node extension/out/tools/dependency-gate.js` on the property test —
  PASSED, no forbidden edges.
- Property test flakiness check (given today's session pattern, BL-1343 and
  BL-1323): the coder proactively used the shape-by-construction discipline
  from the start (each ownership corner gets its own dedicated property
  pass) rather than a weighted `fc.oneof`. Ran 8 consecutive times — 8/8
  clean, consistent with deterministic reach. Cleaner independently ran 5x
  clean.
- required_wiring: both entries confirmed present at the exact cited
  locations — `land_step_cli.bb:65` calls `land-step-lib/replay!`;
  `specs/pipeline/steps/index.js:21` registers
  `bl1332SharedPathLineLeakSteps`.
- BL-1315's landed per-path decision confirmed untouched for the
  single-owner and unattributed cases (scenarios 1-3, and the property
  test's own non-refusal-shape assertion).

## Cleaner's downstream observation — verified, and the suggested remedy corrected
The cleaner correctly flagged that scenario 04's Then-step
("the feature-handler registration guard passes against every tip
produced") asserts only `r.status !== null`, which proves the guard *ran*,
not that it *passed*. I verified this is a real assertion-strength gap by
reproducing the exact fixture by hand in an isolated repo (landing ticket's
own commit + a shared `index.js` carrying a `require()` for a handler file
that does not exist) and running `check_feature_handler_registration.sh`
against it directly: **it exits 1** (correctly refuses), not 0. So the
cleaner's suggested tightening (`assert.equal(r.status, 0, ...)`) would
actually **break this passing scenario** — the fixture is deliberately the
dangerous shape, and the guard is SUPPOSED to fail against it if it ever
shipped raw. The real safety property this scenario exists to prove — that
no such tree ever reaches the guard in the first place — is already fully
covered by the preceding `assert.equal(st.ownPaths.paths, null, ...)`
assertion. **Not exploitable**: there is no path through the current code
where a bad tip ships and this weak assertion is the only thing standing in
the way. A future tightening pass (whoever next owns this acceptance file)
should assert `r.status !== 0` if it wants the scenario to also prove the
fixture reproduces the historically dangerous shape, not `=== 0`. Recording
this correction so the wrong remedy direction doesn't propagate.

## Verdict
No defect. The one acceptance-test naming imprecision is real but inert and
outside architect/cleaner ownership (Gherkin/step-file authorship rests
with specifier/hardener); flagged accurately for whoever next touches this
file. Forwarding to hardener.
