Feature: BL-1706 RETIRED 2026-09-25 - superseded by BL-1752

  This ticket was retired by the specifier on 2026-09-25 (Article 3.6;
  Consolidation Authority, BL-680). The human ruled that day that a
  mono-router pack has exactly one resident, and BL-1752 removes the
  chase's consult spawn together with consult-eligible? and the
  single_inference_slot knob this review would have certified. Its
  scenarios are retired, never reworded; BL-1752's feature is the live
  contract. This file is kept as a tombstone with no scenarios: a merge
  that drops a tracked path is refused by check_merge_deletion.sh unless
  the MERGE message names the path's ticket, and the daemon's master-main
  reconcile (BL-891) merges with git's default message, so a deletion on
  one side of a diverged main can never join (BL-1242, BL-1341, BL-1662).
  A later cleanup may remove it in a commit whose subject names BL-1706.
