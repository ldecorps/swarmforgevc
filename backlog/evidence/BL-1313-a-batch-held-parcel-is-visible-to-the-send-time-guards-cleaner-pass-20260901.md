# BL-1313-a: cleaner review pass — rework — 2026-09-01

Reviewed commit `5008be4f0c` (coder's rework after the architect's vacuous
-property-test bounce), merged into cleaner as `5008be4f0c` on top of my
earlier `f47a529602` pass.

## Scope of this rework vs my prior pass

Production Clojure (`handoff_lib.bb`, `duplicate_chain_guard_lib.bb`,
`swarm_handoff.bb`) is unchanged from the version I already reviewed under
`f47a529602` (BL-1313: cleaner review pass, NONE found) — confirmed via
`git diff f47a529602 5008be4f0c --stat`: only the property test, two
evidence files, and two ordering/registration fixups
(`specs/pipeline/steps/index.js`, `swarmforge/scripts/test/suite-manifest.tsv`)
changed. No new production behavior to re-review.

The rewritten property test
(`extension/test/bl1313BatchGuardVisibilityInvariants.property.test.js`) is
outside cleaner's domain (property tests are not owned by this role) —
verified it runs and passes, not reviewed for content.

## Checks run

- `npm run compile` (extension/): clean, no errors.
- `npx vitest run --config vitest.properties.config.mjs test/bl1313BatchGuardVisibilityInvariants.property.test.js`:
  3 tests passed (both declared invariants), non-vacuous per the coder's
  fix — confirmed by reading the assertions exercise the committed
  `handoff_lib.bb` closure via a real bb subprocess/isolated tmp seed, not a
  PATCH_EVAL redefinition.
- `bb swarmforge/scripts/test/bl1313_handoff_files_with_batches_test_runner.bb`: ALL TESTS PASSED.
- `bash swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding_batch.sh`: ALL PASS.
- `bb swarmforge/scripts/test/duplicate_chain_guard_lib_test_runner.bb`: ALL PASS.
- `bb swarmforge/scripts/test/handoff_lib_test_runner.bb`: ALL TESTS PASSED.
- `specs/pipeline/steps/index.js` / `suite-manifest.tsv` diff: pure
  reordering into sorted position for the same entries already present in
  my prior pass — no functional change, no duplicate/missing registration.

## Cleanup order (Article: Cleanup Order)

- Coverage: unchanged production files, already covered by the standing
  bb suites above plus the now-non-vacuous property test.
- CRAP / DRY: no production `.ts`/`.js` files changed by this rework;
  `.bb` files have no CRAP/DRY tooling wired (per Startup Tools) and are
  unchanged from my prior pass regardless.
- Module structure / mutation-site-count: no new or changed compiled
  `out/**/*.js` files in this rework (only `index.js` reordering and the
  test file, neither counted/flagged).

## Verdict

NONE found. Forwarding to architect.
