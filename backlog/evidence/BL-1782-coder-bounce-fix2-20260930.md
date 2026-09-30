# BL-1782 — coder bounce fix, 2026-09-30 (QA bounce, evidence ffd3bbe2c4)

## What changed

- `swarmforge/scripts/verification_debt_ledger_lib.bb`:
  - `default-conf-path` (D1): one shared helper naming
    `<root>/swarmforge/swarmforge.conf` - the real path every other conf
    reader in this codebase uses (`mutation_cooldown_gate.bb`,
    `swarm_identity_lib.bb`'s own `default-swarmforge-conf-path`). Kept
    local (a plain string, no `babashka.fs` dependency) rather than a
    cross-file require, for the same single-independently-loadable-file
    rationale this lib's own `parse-conf` already established.
  - `threshold` (D2): now falls back to `default-threshold` (3) unless
    the parsed value is a POSITIVE integer - `(or (some-> v parse-long)
    default-threshold)` let zero and negative values (valid longs, so
    truthy) pass straight through, throwing every recorded category over
    threshold and unowned on a typo'd or blank-meaning-zero conf value.
- `swarmforge/scripts/verification_debt_ledger_read.bb` and
  `verification_debt_ledger_update.bb`: both `conf-threshold` helpers now
  call `vdl/default-conf-path` instead of their own (identical, wrong)
  `(fs/path project-root "swarmforge.conf")`.
- `specs/pipeline/steps/bl1782VerificationDebtLedgerSteps.js`: `writeConf`
  now writes `<root>/swarmforge/swarmforge.conf` (creating the `swarmforge/`
  dir), so scenario 03's conf-threshold row exercises the real path
  instead of one both sides of the fixture agreed on by coincidence.
- `swarmforge/scripts/test/verification_debt_ledger_lib_test_runner.bb`:
  three new `threshold` rows (0, -2, a non-number all fall back to the
  default) and one `default-conf-path` row, per QA's own remediation
  pointer.

## Verification

- `bb swarmforge/scripts/test/verification_debt_ledger_lib_test_runner.bb`:
  ALL PASS. Non-vacuous: reverted the lib to its pre-fix content and
  re-ran - the new `default-conf-path` assertion errors
  (`Unable to resolve symbol`), and a standalone `bb -e` check against
  the pre-fix `threshold` showed `0` and `-2` passing straight through
  (the exact D2 bug); restored, re-ran, ALL PASS.
- `bash swarmforge/scripts/test/test_verification_debt_ledger_cli.sh`:
  ALL PASS (unaffected - commit-failure/rollback behavior, not conf
  reading).
- Reproduced QA's own D1/D2 repro directly against a `git init` mkdtemp
  fixture with one recorded row: `swarmforge/swarmforge.conf` holding
  `verification_debt_threshold 1` now reads back `threshold: 1,
  over_threshold: true` (was always 3, dead config); `0` and `-2` both
  now read back `threshold: 3, over_threshold: false` (were `0`/`-2`
  themselves, throwing the one-row category over threshold).
- `node specs/pipeline/cli.js specs/features/BL-1782-hand-verifications-are-recorded-in-a-verification-debt-ledger.feature`:
  13 of 13 ok (unchanged pass count; scenario 03's conf row now exercises
  the real path both sides of the fixture agree on for the right reason).
- `node -c specs/pipeline/steps/bl1782VerificationDebtLedgerSteps.js`:
  syntax OK.

## Scope

Only the two remediation pointers QA named (D1 conf path, D2 non-positive
threshold) and the runner rows it asked for. No change to the three
declared invariants (idempotency, ownership, single-writer/reader) or
their own review history - out of this bounce's scope, and already
cleared through multiple prior architect/hardener passes with no
objection.

By coder.
