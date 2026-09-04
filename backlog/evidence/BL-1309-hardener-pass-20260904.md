# BL-1309 — hardener pass, 2026-09-04

Merged architect commit `ccc7614d87` (which itself carries the coder's
BL-1375-narrowed rebuild `aba92d6998` + `44814585e7`) into the hardender
worktree. Independently re-ran every gate rather than trusting the
evidence trail.

## Checks re-run, all independently

- `swarmforge/scripts/test/land_main_publish_test_runner.sh` — 12/12 PASS.
- `specs/pipeline/scripts/run_acceptance.sh` on the BL-1309 feature —
  10/10 PASS.
- `npx vitest run --config vitest.properties.config.mjs
  bl1309LandDecideEntanglementInvariants` — 3/3 PASS.
- `swarmforge/scripts/test/bl1309_entanglement_mutation_sweep.sh` —
  killed=9 survived=0 equivalent=2 skipped=0. Re-read both EQUIV
  justifications; both are demonstrable from the code (BL-234 shape), not
  assumed: the marker-substring mutant because `entangled_sibling_report`'s
  only stdout writes are the three `println`s inside one `when` block (all
  or nothing), and the detector-presence-guard mutant because the `|| true`
  around the same call already catches the resulting `load-file` crash
  (verified: dropping only the `-f` check left unit row 06 passing
  byte-for-byte).
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` — ALL PASS
  (unchanged dependency `blocking-siblings`/`entangled-siblings`, checked
  since the new guard is the first mandatory-path caller of it).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.

## BL-113 Gherkin mutation (both Scenario Outlines in the feature)

Ran `run_gherkin_mutation.sh` soft over
`specs/features/BL-1309-the-mandatory-land-decide-step-is-blind-to-entanglement.feature`
against `specs/pipeline/steps/index.js` (discovery registry, post-BL-1371).
14/14 mutants killed, 0 survived, 0 errors. Manifest stamped in the feature
file (only the stamp changed — 2 lines).

## CRAP / DRY

Both `npm run crap` and `npm run dry` are scoped to `extension/src/**` per
`extension/package.json`. This parcel touches no file under `extension/src`
(only `swarmforge/scripts/land_main_publish.sh`, a shell/bb-fronted step
handler + property test, and shell/bb test files) — CRAP/DRY are N/A,
matching the cleaner's own stage-skip reason on the ticket
("one guard added to one 60-line shell script beside the decision it
already computes; there is no second copy to de-duplicate and no structure
to extract").

## Result

No defect found beyond the two spec gaps the coder already routed to the
specifier by priority-00 note (stale `invariants:` wording, and the
`required_wiring` entry made unsatisfiable by BL-1371's discovery registry
landing concurrently) — both correctly left to the specifier, not mine to
edit. No orphaned test/mutation processes left behind (confirmed via
`pgrep`). Forwarding to documenter.

By hardender.
