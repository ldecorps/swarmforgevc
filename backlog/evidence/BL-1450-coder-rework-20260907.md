# BL-1450 — coder rework (QA bounce D1)

Commit: this parcel · 2026-09-07 · worktree `swarmforge-coder`

## The bounce

QA (`backlog/evidence/BL-1450-bounce-20260907.md`, commit `6e517f02a3`):
the file's own internal `testTimeout` (120000ms) was measured only against
SOLO runs (44-50s alone, one 110s spike) and was hit twice under the real
full-lane pooled run (126046ms, 149518ms) - qa_e2e_procedure step 3's own
command. Blamed role: coder (the timeout constant's own choice).

## The fix

`extension/test/bl968MaterializedGuardSensitivity.property.test.js`:
`testTimeout` 120000 -> 240000, comment updated to record both measurement
regimes (solo vs pooled) and why 240000 is chosen (comfortable margin over
QA's worst pooled observation, 149518ms, while staying well under the
ORIGINAL 300000 this ticket lowered from). No other line touched - QA's
own evidence confirms every other part of this ticket's checklist (spawn
count, reach floors, acceptance, standing-reds retirement) is already
correct; this bounce is scoped to the one constant.

## A silent-revert trap in the merge, caught before committing

QA's branch bounce protocol reverts the bounced merge out of QA's OWN
branch (`d79f003542 Revert "Merge documenter 4db2ce8b96 into QA."` -
correct, expected QA behavior). Merging QA's post-revert commit
(`2fd8cedee3`) into this worktree via a plain `git merge` triggered the
merge-deletion guard: git's 3-way merge resolved the property test file
and five evidence/handler files to QA's REVERTED (pre-BL-1450-fix) side,
since my side read as "unchanged since the merge-base" once QA's branch
carried the revert. Left uncorrected, this would have silently thrown away
the whole BL-1450 fix (RUNS_PER_CELL 4->1, derived reach floors, 96->6
spawns) - not just the one timeout constant QA actually flagged - and
reintroduced a stale `backlog/standing-reds.tsv` row for the ALREADY-FIXED
original defect (96 spawns/300s timeout).

Caught via the merge-deletion guard's own refusal; resolved by aborting,
re-merging, then `git checkout HEAD --` on every flagged path (restoring
this branch's already-correct content) before committing, and manually
dropping the reintroduced stale standing-reds.tsv row. The merge commit
(`Merge QA 2fd8cedee3 into coder.`) ends up purely additive: QA's bounce
evidence file and the ticket's `bounce_history` entry.

## Verification

| check | result |
|---|---|
| File run solo (`vitest run ... test/bl968...property.test.js`) | **45.8s**, well under the 60s qa_e2e target and the new 240000ms timeout |
| `run_acceptance.sh` BL-1450 feature | **5/5**, unchanged |
| Full `npm run test:properties` pooled lane (this parcel's own commit) | bl968 not among the timed-out files (see this commit's own property-suite-guard log) |
| `backlog/standing-reds.tsv` | no BL-1450 row reintroduced |

Re-forwarding through the pipeline per the bounce.
