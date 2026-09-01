# BL-1313: cleaner review pass — 2026-09-01

Merged coder commit `eb32525012` into `swarmforge-cleaner` (merge commit
`15e744be0a`), resolving one conflict in `specs/pipeline/steps/index.js`
(both branches added a new `require` line adjacent to each other — kept
both entries, no content collision).

## Review against Cleanup Order

- Diff is nine files, minimal and scoped exactly to the ruled option 1
  (fix the two send-time guards only): two new functions in
  `handoff_lib.bb` (`handoff-files-with-batches`, batch-aware twin of the
  existing `handoff-files`; `my-handoff-files-with-batches`, same pattern
  as the existing `my-handoff-files`), and one call-site swap in each of
  `swarm_handoff.bb` and `duplicate_chain_guard_lib.bb`. No fold-in of the
  six other hand-rolled batch walkers — matches `human_ruling` in the
  ticket exactly.
- No `src/**/*.ts` or compiled `out/**/*.js` files touched — the changed
  surface is `.bb` libs plus acceptance step/property-test JS under
  `specs/pipeline/steps/` and `extension/test/`. `mutation-site-count.js`
  is not applicable (it scopes to compiled `out/`); Stryker's own mutate
  scope likewise does not reach `.bb`.
- Module structure: the new readers sit beside `handoff-files` and
  `batch-dirs` in `handoff_lib.bb` per the ticket's own direction ("one
  batch-aware in_process reader... beside `handoff-files`"). No new
  boundary crossed; both send-time guards already depended on
  `handoff_lib.bb`.
- DRY: `handoff-files-with-batches` composes the existing `handoff-files`
  and `batch-dirs` rather than re-deriving batch traversal — no new
  duplication introduced. The six pre-existing hand-rolled batch walkers
  elsewhere are explicitly out of scope per `approval_context`/`notes`;
  not touched here.
- CRAP / coverage: both new functions are exercised by the dedicated bb
  test runner, the shell fixture, and the JS property test (see below).
  No uncovered branches — each function is a single `if`/`concat`
  composition.

## Verification run

- `bb swarmforge/scripts/test/bl1313_handoff_files_with_batches_test_runner.bb`
  → ALL TESTS PASSED
- `bash swarmforge/scripts/test/test_swarm_handoff_inbound_non_forwarding_batch.sh`
  → ALL PASS
- `npx vitest run --config vitest.properties.config.mjs test/bl1313BatchGuardVisibilityInvariants.property.test.js`
  (from `extension/`) → 2/2 passed (placement-invariance, fail-closed
  preservation — the ticket's two declared invariants)
- `node -e "require('.../specs/pipeline/steps/index.js')"` → loads clean,
  confirms the merge-conflict resolution in `index.js` (kept both the
  BL-1313 and BL-1315 `require` lines) did not break step registration.

## Decision

**NONE** — no cleaner-owned defect found. Nothing to fix; forwarding the
merge commit as-is.
