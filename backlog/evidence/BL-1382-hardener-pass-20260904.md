# BL-1382 — hardener pass, 2026-09-04

Merged architect commit `87b45a67fa` (COMPLIANT, clean sweep — every
claim independently re-executed, per the ticket's own live-data-loss
severity, since the original incident erased a human-installed crontab
schedule overnight —
`backlog/evidence/BL-1382-architect-20260904.md`).

## Checks re-run, all independently

- `test_bl1382_unmarked_cron_lines_survive.sh` — 11/11 ALL PASS: freshness
  line correctly removed, unmarked operator-script and scripts-dir lines
  survive both uninstall and a recognized-mode install byte-identical, a
  sibling root's marked line is untouched, an operator-schedule-marked
  line IS still removed, both paths report the unmarked line as "left in
  place", every check ran against the fixture crontab only.
- `test_bl1382_cron_ownership_agreement.sh` — 6/6 ALL PASS, including the
  non-vacuity case (editing one reader's marker list, not the other,
  makes the suite genuinely FAIL — confirmed, not just claimed).
- `npm run compile` clean, then
  `bl1382CronOwnershipMarkerOnly.property.test.js` — 3/3 pass.
- `run_acceptance.sh` on the BL-1382 feature — 5/5 pass.
- `check_feature_handler_registration.sh` — rc 0.
- `bl1162_swarmforge_cron_property_runner.sh` (the pre-existing regression
  suite for the function this ticket rewrote) — 14/14 PASS, multi-root
  isolation intact, re-tensed assertions read correctly.

## Own finding: a stale mutant in the pre-existing BL-1162 mutation sweep

Ran `bl1162_swarmforge_cron_mutation_sweep.sh` (BL-149 gate: run, for both
`swarmforge_cron_lib.sh` and `reconcile_shift_schedule_crontab.bb`) and
found one mutant reporting `skip` rather than `killed`: "cron lib drops
operator path ownership". Per this session's own standing rule (a
hand-authored sweep's `skipped` count is as load-bearing as
`survived=0` — a stale anchor is an UNRUN mutant, not a passing one),
investigated rather than accepted.

Confirmed: the mutant's anchor line
(`[[ "$line" == *"$root/.swarmforge/operator/"* ]] && return 0`) is the
EXACT operator-path-ownership clause the architect's own evidence
confirms was deleted from `swarmforge_cron_line_belongs_to_root` by this
ticket — not moved, not renamed. Path-based ownership of an unmarked line
is precisely the defect class BL-1382 exists to end (it is what erased
the human's schedule). There is no equivalent behavior left to re-anchor
the mutant to, so **retired it** (removed from the sweep script, with a
comment explaining why) rather than leaving it silently skipped or
inventing a substitute assertion for a behavior that no longer exists by
design. BL-1382's own three dedicated suites already cover marker-only
ownership far more thoroughly than this one mutant ever did.

Re-ran the sweep after retiring it: **6/6 killed, 0 survived, 0 skipped**,
`ALL MUTANTS KILLED` now genuinely true rather than concealing an unrun
case.

## BL-113 Gherkin mutation

`grep -c "Scenario Outline"` on the feature: 0 — inapplicable per BL-638.

## CRAP / DRY

`git show --stat 87b45a67fa` touches no file under `extension/src` — N/A.

## Process / fixture hygiene

No orphaned `node --test`/mutation processes (three unrelated bash pids
seen by `pgrep` are not test runners). No leftover `/tmp/bl1162_*.txt`
scratch files from the mutation sweep's own restore path. Clean working
tree after staging the one fix.

## Result

A live-data-loss defect fix (marker-only crontab ownership) re-verified
across e2e (17 checks total across two suites), property (3), acceptance
(5), and the pre-existing regression suite (14) — all clean. Found and
fixed a stale mutant anchor in the adjacent pre-existing mutation sweep,
retiring it with reasoning rather than leaving a false "ALL MUTANTS
KILLED" that concealed an unrun case. Forwarding to documenter.

By hardener.
