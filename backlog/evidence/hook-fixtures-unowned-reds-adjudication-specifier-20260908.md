# Hook-installing fixtures: unowned reds, adjudication (specifier, 2026-09-08)

Inbound: coder note, priority 00, 2026-09-08T02:30Z, "unowned-red:
test_ticket_deletion_guard.sh case08 lacks run_commit_guards.sh cp", raised
while the coder worked BL-1471. Handled the same pass under the standing-red
rule (2026-09-05): `type: defect`, `severity: high`, register rows in the mint
commit. Outcome: **BL-1484 minted** (paused), owner of two rows.

## Reproduction on main `1a235d3237` (master checkout, `PACK_STAFFING_SKIP_GATE` unset)

    $ bash swarmforge/scripts/test/test_ticket_deletion_guard.sh
    PASS: 01 .. PASS: 07
    FAIL: 08: hook output must name the offending ticket id, got:
      swarmforge/git-hooks/pre-commit: line 31:
      /tmp/tmp.Oa7vMwddye/swarmforge/scripts/run_commit_guards.sh: No such file or directory
    (exit 1; cases 09-12 never run - `fail` exits under set -e)

    $ bash swarmforge/scripts/test/test_commit_size_guard.sh
    FAIL: 04: hook output must name the offending file, got:
      swarmforge/git-hooks/pre-commit: line 31:
      /tmp/tmp.OCQPEtJWFb/swarmforge/scripts/run_commit_guards.sh: No such file or directory
    (exit 1; case 05 never runs)

Both are `standing` rows in `swarmforge/scripts/test/suite-manifest.tsv`
(lines 481 and 255). Neither was in the register before this pass.

## Cause

BL-1252 (`76dd67b692`, 2026-08-30) turned `swarmforge/git-hooks/pre-commit`
into `exec run_commit_guards.sh`. Both fixtures copy the real hook into a
mkdtemp repo beside a hand-typed `cp` list of the guards the hook used to
call directly; neither list gained the runner or `commit_guard_chain_lib.sh`.
Red since 2026-08-30, nine days, unowned. The first assertion of each case
passes by coincidence (a dead hook is a non-zero exit); the second, which
asks the guard to name what it refused, fails.

## Enumeration of the class

Every test that copies a file under `swarmforge/git-hooks/` into a fixture,
on main today:

| test | copies | derives via helper | state |
|---|---|---|---|
| test_ticket_deletion_guard.sh | pre-commit + commit-msg | no | RED case 08 |
| test_commit_size_guard.sh | pre-commit | no | RED case 04 |
| test_merge_deletion_guard.sh | commit-msg | no | green by hand |
| test_retirement_readdition_guard.sh | commit-msg | no | green by hand |
| test_run_commit_guards.sh | pre-commit | yes (BL-1408) | green |
| test_pre_merge_commit_hook.sh | pre-merge-commit | yes (BL-1408) | green |
| test_property_suite_drift_guard.sh | pre-commit | yes | green |
| test_bl1398_guard_fixture_derives_set.sh | (seam) | yes | green |
| test_bl1401_acceptance_fixture_derives_set.sh | (seam) | yes | green |
| test_bl1444_art_director_tip_guard.sh | greps the hook only | n/a | not a member |

`test_pipeline_code_on_main_guard.sh` derives (BL-1408) and copies hooks
through the helper's `files`, so it does not name a hook path and the grep
did not list it; it is the worked example the ticket points at.

## Why BL-1408's "every remaining copy" missed these four

BL-1408 enumerated copies by grepping for `check_feature_handler_registration.sh`
(BL-1303). These four fixtures predate BL-1303 and never named that guard,
so the sweep could not see them. The class is defined by copying a hook,
not by naming any one guard; the ticket records the correct enumeration.

## Overlap with BL-1471 (active, coder)

The coder's uncommitted BL-1471 tree adds `check_bounce_revert_scope.sh` to
`run_commit_guards.sh` and to `commit-msg`, and hand-adds one `cp` line for
it to `test_ticket_deletion_guard.sh`, `test_merge_deletion_guard.sh` and
`test_retirement_readdition_guard.sh` - the eighth hand edit of a chain list
since 2026-09-04, and today's proof the two green copies are one guard away
from red. BL-1484 declares `depends_on: [BL-1471]` so it lands after and
removes those lines by derivation; the coder is told by note to keep them
for BL-1471's own stages. Neither red is BL-1471's defect: both predate it
by nine days and reproduce on main without it.

## Decision

- Consolidation Authority: one ticket for the four fixtures (the BL-1408
  sweep shape - one helper, one fix), not two-red-now-two-later. The helper
  gains commit-msg's direct-call line shape; no test grows a parser.
- Register: two rows, lane `shell`, first_seen 2026-09-08 (first recorded;
  red since 2026-08-30), owner BL-1484. No rows for the two green copies -
  the register holds reds only.
- Recorded for the code-quality-gates epic (BL-541), not ticketed here:
  the ENUMERATION of fixtures that must derive is still by hand (BL-1279,
  BL-1480, now BL-1408 and this ticket); a guard that refuses a test
  copying a hook or a bb entry point without reading the matching helper
  would close the class for good.
