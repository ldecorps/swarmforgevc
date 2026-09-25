# BL-1728 - unowned red on `npm run test:properties`, 2026-09-25

Committing BL-1728's parcel, the shared pre-commit hook
(`check_property_suite_drift.sh`) ran the full property lane and refused:

    property-suite-guard: test/bl1505DedupSuppressedChaseCountInvariants.property.test.js still fails when run alone
    Commit rejected: property suite failed with non-allowlisted files:
    test/bl1505DedupSuppressedChaseCountInvariants.property.test.js

Full run: 1 file failed, 458 passed (459); 3 failed, 1329 passed (1332).
All 3 failures in the one file, re-run alone (guard's own second pass) and
still red - not a flake. Refusal log:
`.swarmforge/property-guard-refusals/refusal-000012-20260925T072840Z.log`.

    FAIL test/bl1505DedupSuppressedChaseCountInvariants.property.test.js >
      BL-1505/BL-654 invariant: chaseCount equals attempted sweeps
      regardless of landed vs dedup-suppressed
    AssertionError: expected chaseCount 1 after a mixed landed/suppressed
      sequence [false], got 0
    (+2 more failures in the same file, same shape: expected count 1, got 0)

BL-1505 itself is `backlog/done/` (landed 2026-09-10). `git log` on the test
file shows its last touch was BL-1652 ("the chase sweep never respawns a
busy role or lane, and respawns at most once per sweep") - a different,
already-landed ticket. `git diff main...HEAD --name-only` on this parcel
names no chase/dedup/handoff path - BL-1728 never touches this area. Not
allowlisted (`swarmforge/scripts/property_suite_standing_allowlist.tsv` is
header-only, no rows at all). No row in `backlog/standing-reds.tsv`; no
open ticket in `backlog/active` or `backlog/paused` names this file.

Recovery path used per the guard's own header comment ("recovery-only;
never the standing recipe - see BL-1121"):
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 git commit ...`, named in the
commit message. BL-1728's own scope files were unaffected by this red -
`bash swarmforge/scripts/test/test_operator_runtime_babysitterd_watchdog.sh`
and the BL-1728 property test both pass on their own (see prior evidence).

By coder.
