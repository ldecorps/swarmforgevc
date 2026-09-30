# BL-1821 — coder bounce fix, 2026-09-30 (QA bounce, evidence 6d9d3a3e62)

## What changed

- `swarmforge/scripts/recruiter_specifier_scout.sh` (D1): the score-table
  merge now clears the `incumbent` flag on every existing row of a role
  this run touched before merging this run's own rows in. An incumbent
  change across two runs (or a run that batteries no incumbent at all) no
  longer leaves a stale `incumbent: true` on an older row alongside the
  new one.
- `swarmforge/scripts/test/test_recruiter_specifier_scout.sh` (D2 + D1
  test): `FAIL_ONE` now differs from `FULL_PASS` on `quote-preserved` (a
  BL-1819 competency, the ticket's own `depends_on`), never on
  `deprecator-refuse` (a BL-1820 competency that may still change its
  grader). Both fixtures' `reality-check` answer now cites
  `extension/src/swarm/roleParser.ts`, the real path BL-1820's own D1 fix
  requires (`x.ts` now fails it). Added case 07: an incumbent change
  across two runs clears the old incumbent's flag, the old row is kept
  (not dropped), and exactly the new incumbent is flagged afterward.
- `specs/pipeline/steps/bl1821SpecifierScoutSteps.js` (D3): `FAIL_ORDER`
  now fails the five BL-1819 competencies first, so a scenario's "passes N
  of 10" always differs from full pass on a BL-1819 competency, never a
  BL-1820 one. `FULL_PASS`'s `reality-check` answer updated to the same
  real path as above.
- Everything else (`recruiter_hf_discover.py`'s `--batch` flag,
  `recruiter_nightly.sh`'s `run_specifier_scout` hook, and the other two
  test files) is the pre-bounce implementation, unchanged, restored after
  QA's whole-ticket revert.

## Verification

- `bash swarmforge/scripts/test/test_recruiter_specifier_scout.sh`: ALL
  PASS (11 checks, including the new incumbent-change case).
- `bash swarmforge/scripts/test/test_recruiter_hf_discover_batch.sh`: ALL
  PASS.
- `bash swarmforge/scripts/test/test_recruiter_nightly_specifier_scout.sh`:
  ALL PASS.
- `bash swarmforge/scripts/test/test_local_specifier_battery.sh`: ALL
  PASS (BL-1820's own suite, unaffected by this merge's restoration of its
  implementation).
- `node specs/pipeline/cli.js specs/features/BL-1821-the-recruiter-scouts-a-batch-of-specifier-candidates.feature`:
  6 of 6 ok.
- `cd extension && npm test`: 643 files, 10928 tests, all green.

## Invariant check

Declared invariant unchanged from the original pass and still holds: grep
over `recruiter_specifier_scout.sh` finds no `git` invocation and no write
under `swarmforge/packs/` or to `swarmforge.conf` - the script's only
writes are the score table, its report, the battery's own evidence, its
own log, and one Telegram outbox line. `test_recruiter_specifier_scout.sh`
case 05 asserts no pack conf/`swarmforge.conf` appears on disk after a
run. No separate property test: the invariant is "never writes outside a
named set of paths", checked exhaustively by grep over the script's own
source (a fixed, small file) rather than a space a generator would add
coverage over - same reasoning as the original coder pass, re-verified
against this bounce's own diff.

By coder.
