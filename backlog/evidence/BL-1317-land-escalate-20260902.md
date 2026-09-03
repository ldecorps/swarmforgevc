# BL-1317 — LAND_ESCALATE, 20260902

QA-approved commit `00e76c46b1` (full verification:
`backlog/evidence/BL-1317-qa-approval-20260902.md`) could not land.

## land_step_cli.bb

`bb swarmforge/scripts/land_step_cli.bb BL-1317-adapt-tier-effort-from-outcome-signals 00e76c46b1`
returned `LAND_ESCALATE`, naming 16 unlanded entangled siblings (BL-1040,
BL-1056, BL-1132, BL-1271, BL-1283, BL-1319, BL-1321, BL-1326, BL-1327,
BL-1330, BL-1334, BL-1338, BL-1340, BL-1344, BL-1345, BL-1346) — the same
BL-1343 attribution-walk defect already tracked (its own replay separately
reported "nothing to commit — own-paths identical to origin/main", the
exact BL-1343 failure shape, even though `git diff origin/main HEAD` shows
real content differences in BL-1317's own files).

## Attempted hand-land (per BL-1338's precedent) — a REAL blocker found, not just the tool defect

Built a tip-pure commit by hand: branched from `origin/main`, checked out
BL-1317's own files from the QA-approved tip
(`extension/test/bl1317Adapt*.{test,property.test}.js`,
`specs/pipeline/steps/bl1317AdaptEffortSteps.js` +  one require line in
`specs/pipeline/steps/index.js`, `swarmforge/scripts/{seat_difficulty_lib,
handoff_lib,done_with_current_task}.bb` + their test runners,
`swarmforge/scripts/test/test_bl1317_effort_ladder_parity.sh`, the ticket
YAML, docs, and this evidence trail).

Compile: clean. `handoff_lib_test_runner.bb`: PASS. `seat_difficulty_lib_test_runner.bb`:
PASS. Ladder parity: 5/5 PASS. **Acceptance: 2/3 — scenario "a clean streak
may drop one notch but not below the claim-time baseline" fails** with "a
single clean completion dropped a notch - the streak rule is not being
applied", reproducibly (ran twice, same result).

The identical files, byte-for-byte (`git diff swarmforge-QA -- <same
paths>` empty), pass 3/3 on the `swarmforge-QA` branch. So this is not a
flake and not (only) BL-1343's attribution bug: **BL-1317's own commit set
has an undeclared dependency on some other file that differs between
`origin/main` and `swarmforge-QA`**, not in the ticket's own required_wiring
or own-paths list, that the tip-pure replay needs to also carry. I did not
locate it — ruled out `pipeline_stage_lib.bb`, `backlog_depth_lib.bb`, and
require-order in `index.js` (tried both the original insertion point and
BL-1317's actual swarmforge-QA position, same failure both times) — before
time-boxing this attempt per the bounded-rematch discipline.

**Not pushed.** `origin/main` is untouched; the experimental branch and its
stash were discarded (never committed, never pushed); `swarmforge-QA` is
back at `00e76c46b1`; the publish lock is released.

## Adjudication needed

Per BL-1241's escalation ladder: rematch already attempted, still not
clean. This is now a **specifier** question, not a QA or coder retry: is
the missing dependency itself a stale/incomplete `required_wiring`
(same class of gap as this ticket's own D1), or a symptom of the BL-1343
tool defect masking a real one, or something else entirely? QA cannot
safely guess which shared file to carry without risking landing an
incomplete or wrong tip.

Same family as BL-1056/BL-1271/BL-1338: a fourth QA-approved parcel now
held off `main` behind BL-1343 (or a still-undiagnosed sibling defect it
may be hiding).

By QA.
