# QA land-approvals backfill, 2026-09-05

Per specifier note (00_20260904T235746Z_001310) and QA.prompt amendment
`24ba823837` (BL-1334/BL-1405): all six hand-built tip-pure lands from
2026-09-04 (BL-1399, BL-1395, BL-1398, BL-1388, BL-1393, BL-1382) skipped
recording their land approval, so each landed commit read as unapproved
pipeline code to `is_qa_ancestor.sh` and every Article 4.2 consumer.
BL-1399 was actually two hand-lands (the original plus the amendment-2b
follow-up), so seven entries total.

## Actions taken

1. **`.swarmforge/land-approvals/2026-09.jsonl`** (master checkout,
   untracked runtime file per `.gitignore`): appended one line per
   hand-land, `{"at":<replay commit's own committer timestamp, UTC>,
   "ticket":<BL-id>,"commit":<replay 10-hex>,"source":<cited-approved
   10-hex>}`, in commit-chronological order:
   - BL-1399 `7b3d2108fc` ← `174391df60`
   - BL-1395 `6246c02ff3` ← `744a35ca13`
   - BL-1398 `3c90479fb1` ← `a329461e11`
   - BL-1388 `fb01c7b0f9` ← `4df546c367`
   - BL-1399 (amendment 2b) `0acb71adc5` ← `71711272be`
   - BL-1393 `8e53a3e853` ← `fd785f89ea`
   - BL-1382 `4392593af6` ← `398274db07`
2. Verified `bash swarmforge/scripts/is_qa_ancestor.sh <replay>` exits 0
   for all seven, each printing `approved: ... - BL-1334`.
3. **`abandoned_commits` backfilled on `origin/main`'s `done/` copies.**
   Found a second gap while doing this: each ticket's `abandoned_commits`
   field was recorded only in this QA worktree branch (a follow-up commit
   made AFTER the tip-pure push), never pushed to `origin/main` itself —
   the coordinator's `Close` commits moved these tickets to
   `backlog/done/` from `origin/main`'s state, which never carried the
   field. Hand-built a small patch commit adding `abandoned_commits:
   [<cited>]` (BL-1399 gets both `174391df60` and `71711272be`) to all six
   `backlog/done/M8/BL-*.yaml` files, rebased twice (bounded, BL-1144;
   origin advanced under me both times with unrelated BL-1370/BL-1404/
   BL-1405 mint commits), verified `git diff --stat origin/main HEAD`
   showed exactly the 6 files each time, pushed fast-forward
   (`2d9c8454a3..7a2dff32df main`).

## Note for the record

This confirms the LAND_REPLAY discipline's step 3 ("record
`abandoned_commits`") has the same gap as step 1 (land-approvals) had:
recording it only in the QA worktree branch, without a path back to
`origin/main`, is silently lossy whenever the coordinator's bookkeeping
commit lands first. Until BL-1405 ships `record_land_approval.bb` and a
QA-side habit forms of pushing bookkeeping fields promptly, every future
hand-build should push its `abandoned_commits` edit (or fold it into the
land commit itself, before push) rather than committing it afterward to
the worktree branch alone.

By QA.
