Feature: BL-1591 RETIRED 2026-09-21 - superseded by BL-1549

  This ticket was absorbed into BL-1549 by the specifier's consolidation sweep
  of 2026-09-21 (Consolidation Authority, BL-680; Article 5.3). Its
  scenarios live on as its scenarios 07, 08 and 09, the CLI row of 04 and the second row of 06 in
  specs/features/BL-1549-swarm-stamp-consult-session-5bdf93beed.feature.
  This file is kept as a tombstone with no scenarios: a merge that drops a
  tracked path is refused by check_merge_deletion.sh unless the MERGE
  message names the path's ticket, and the daemon's master-main reconcile
  (BL-891) merges with git's default message, so a deletion on one side of
  a diverged main can never join (BL-1242, BL-1341, BL-1662). A later
  cleanup may remove it in a commit whose subject names BL-1591.
