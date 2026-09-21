Feature: BL-1521 RETIRED 2026-09-21 - superseded by BL-1520

  This ticket was absorbed into BL-1520 by the specifier's consolidation sweep
  of 2026-09-21 (Consolidation Authority, BL-680; Article 5.3). Its
  scenarios live on as rows 2-3 of its outline 01 and its scenario 03 in
  specs/features/BL-1520-telegram-topic-decisions-first-run-survivors-to-zero.feature.
  This file is kept as a tombstone with no scenarios: a merge that drops a
  tracked path is refused by check_merge_deletion.sh unless the MERGE
  message names the path's ticket, and the daemon's master-main reconcile
  (BL-891) merges with git's default message, so a deletion on one side of
  a diverged main can never join (BL-1242, BL-1341, BL-1662). A later
  cleanup may remove it in a commit whose subject names BL-1521.
