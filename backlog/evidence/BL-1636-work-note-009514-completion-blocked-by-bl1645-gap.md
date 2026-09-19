# BL-1636 - Work note 009514 completion blocked by the BL-1645 gap

Applying BL-1645's own documented interim (its `notes:` section) to the
same gate gap, hit here for BL-1636 instead of BL-1637.

## What happened

Coordinator Work note `10_20260918T144618Z_009514_from_coordinator_to_coder`
("Work BL-1636: merge main first, then read backlog/active") was already
stale by the time it dequeued at 2026-09-19T02:24:25Z: BL-1636 had already
been implemented, committed (`fde1a2db6f`), and `git_handoff`'d to the
cleaner at 2026-09-19T02:22:55Z - before this note's dequeue stamp, but
inevitably after its `created_at` (2026-09-18T14:46:18Z).

- Plain completion: `WORK_NOT_EVIDENCED` (the gate's evidence window opens
  at `dequeued_at`, not `created_at` - BL-1645's exact gap).
- `--no-work` completion: `WORK_ACTIVE_ON_MAIN` (BL-1636 is correctly still
  `active` in `backlog/active/` - it is mid-pipeline at the cleaner, not
  yet QA-approved - so BL-1614's clause refuses a stated reason too).

Both paths refuse a Work note whose ticket was, in fact, already fully
handled. Merging main (twice, staged around the unrelated
`check_standing_red_register.sh` ledger-merge false-positive documented in
`backlog/evidence/check-standing-red-register-ledger-merge-false-positive-20260919.md`)
does not change this outcome, since `ticket-active-on-main` reads the live
`backlog/active` state at the freshest of main/origin-main, which is
correctly `active` regardless of my own branch's merge state.

## Interim applied (per BL-1645's own notes)

This commit's subject leads with `BL-1636:`, is a real commit on the
coder@2 branch, lands after this note's `dequeued_at` stamp, and names the
ticket the note dispatched - satisfying the Work-note gate's evidence
check as written today, without resending the already-live parcel (still
correctly at the cleaner) and without fabricating unrelated work.

By coder.
