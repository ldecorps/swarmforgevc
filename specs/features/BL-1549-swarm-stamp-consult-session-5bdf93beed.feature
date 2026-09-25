Feature: BL-1549 RETIRED 2026-09-25 - superseded by BL-1752 and BL-1753

  This ticket was retired by the specifier on 2026-09-25 (Article 3.6;
  Consolidation Authority, BL-680). The human ruled that day that a
  mono-router pack has exactly one resident. BL-1752 removes the chase's
  consult spawn (hotfix 5bdf93beed) and BL-1753 removes the night
  closing ceremony's documenter consult (hotfix a27d082c2d, whose stamp
  BL-1591 had been absorbed here). Both reviews would have certified code
  those slices delete. Its scenarios, including BL-1591's, are retired,
  never reworded; BL-1752's and BL-1753's features are the live
  contracts. The surviving consult teardown sweep and consult_spawn_cli.bb
  are exercised by BL-1710's feature. This file is kept as a tombstone
  with no scenarios: a merge that drops a tracked path is refused by
  check_merge_deletion.sh unless the MERGE message names the path's
  ticket, and the daemon's master-main reconcile (BL-891) merges with
  git's default message, so a deletion on one side of a diverged main can
  never join (BL-1242, BL-1341, BL-1662). A later cleanup may remove it in
  a commit whose subject names BL-1549.
