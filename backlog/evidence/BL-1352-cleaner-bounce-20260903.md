# BL-1352 — cleaner bounce (2026-09-03)

## Review pass completed before this bounce (Article 4.4 — complete inventory)

- Merged coder `83b4553945` into cleaner worktree; scope check confirmed the
  commit itself touches only files listed in its own diff-stat (the incidental
  `bl1332SharedPathLineLeakSteps.js` change came in via a separate routine
  main-sync merge, not from this ticket's work — not a scope defect).
- `bb swarmforge/scripts/test/bl1352_escalation_transport_test_runner.bb` —
  ALL PASS.
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1352-…feature` —
  7/7 pass.
- Mutation-site count (BL-485) on the two new JS files: 170 and 165 sites,
  both "over" the 100 advisory threshold, but consistent with sibling
  `specs/pipeline/steps/bl*Steps.js` files in this same registry (178–241
  sites) — not an outlier, no split warranted.
- `npm run test:properties -- bl1352EscalationVisibilityInvariants` — **FLAKY**.
  This is the one defect (`D1`) below.

## D1 — property test invariant 1 does not reliably reach all four branches

- **File**: `extension/test/bl1352EscalationVisibilityInvariants.property.test.js`
- **Class**: test-flakiness / non-vacuity gap (property generator reach not
  actually guaranteed, contrary to the file's own header comment "GENERATOR
  REACH (by construction)").
- **Blamed role**: coder (BL-654 property authorship rests with the coder,
  first pass; property tests are explicitly outside cleaner's domain —
  "Does Not Own: create, run, or maintain … property tests" in the cleaner
  role prompt).
- **Failure scenario**: `invariant 1` iterates `transport` over
  `['configured', 'unconfigured']`, and for each runs
  `fc.assert(fc.property(fc.uniqueArray(fc.constantFrom(...ROLES), {maxLength: 3}), ...), {numRuns: 5})`.
  `fc.uniqueArray` defaults to `minLength: 0`, so the empty-array ("Idle")
  case is only sometimes sampled within 5 runs per transport. When the
  `configured` pass never samples an empty array, `reach.configuredIdle`
  stays `0` and the closing
  `for (const [key, count] of Object.entries(reach)) assert.ok(count > 0, ...)`
  fails with `never exercised the configuredIdle case`.
- **Reproduction**: ran `npx vitest run --config vitest.properties.config.mjs
  bl1352EscalationVisibilityInvariants` 15 times in a loop — **5/15 failed**
  (~33% failure rate), all on the same `never exercised the configuredIdle
  case` assertion. `invariant 2` was stable across all 15 runs.
- **Consequence if forwarded unfixed**: `npm run test:properties` is a real
  gate the hardener and QA will both run; this ships them an intermittent red
  they did not cause, on a file they don't own fixing either (same "Does Not
  Own" boundary applies to every downstream pipeline role until it's back
  with the coder).
- **Remediation pointer**: either raise `numRuns` enough to make the
  empty-array case a near-certainty, or force reach directly — e.g. run the
  empty-array case once outside `fc.property` per transport (mirroring how
  `invariant 2`'s `reach.held`/`reach.changed` tracking already works,
  which stayed stable), or use `fc.record`/an explicit `fc.constant([])`
  arm so "Idle" is drawn deterministically at least once per transport
  instead of left to chance at `numRuns: 5`.

## Nothing else found

No other item is outstanding from this pass; D1 is the sole defect. All
non-property-test verification (bb unit runner, acceptance feature, scope,
mutation-site advisory) is clean and does not need to be re-run once D1 is
fixed, but the coder should re-run `npm run test:properties` several times
(not once — the failure is probabilistic) before forwarding again.

## Action taken

The bounced commit `83b4553945` was not yet an ancestor of `main`, so per
the bounce-revert rule its merge (`95f0713615`) was reverted out of the
cleaner branch (`76f3222eef`), and one incidental already-landed comment
line it took down with it (`bl1332SharedPathLineLeakSteps.js`, from origin/main
commit `a2a3bc6a40`) was restored separately (`434b759d39`).
