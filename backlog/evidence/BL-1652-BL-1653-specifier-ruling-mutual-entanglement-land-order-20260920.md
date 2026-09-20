# BL-1652 / BL-1653 - specifier ruling on QA's mutual cross-file entanglement, 2026-09-20

Inbound: QA note 00_20260920T011852Z_002992 (priority 00): "BL-1652/BL-1653
mutual cross-file land entanglement - adjudication needed". QA's evidence:
`backlog/evidence/BL-1652-BL-1653-mutual-entanglement-20260920.md` (QA
branch 8bbbc97773). Both parcels are approved (QA evidence NONE for each);
neither is bounced. QA was right that this is not the BL-1537 closed-owner
class: both owners are open.

## Facts at 01:2x Z, main f981c5a208, QA tip 8bbbc97773

- The one shared path is `swarmforge/scripts/handoffd.bb` (20 BL-1652
  paths, 16 BL-1653 paths, intersection of one, computed from the
  ticket-tagged commits in `origin/main..swarmforge-QA`). BL-1652's
  hunks call `lane_process_lib.bb` (its own new file); BL-1653's call
  `master_main_reconcile_lib.bb`'s new `abort-found-no-merge-head?`.
- The tip-pure replay copies a cited ticket's own paths as WHOLE FILES
  from the cited commit. Cited from the shared tip, either ticket's
  `handoffd.bb` carries both hunks while the other's helper is excluded,
  and `check_bb_scripts_load` refuses. QA read that correctly.
- BL-1653 reached QA first. `da9ca51aff` (01:36 BST, "Merge documenter
  1a71f0501c into QA", BL-1653's parcel) and QA's approval point
  `9792341072` (01:47) both predate BL-1652's arrival (`7532b70602`,
  01:56): `git merge-base --is-ancestor 43213a6bc2 <each>` is false.
  `git diff origin/main da9ca51aff -- swarmforge/scripts/handoffd.bb`
  is +30/-2, six BL-1653 hunks, zero `lane_process` references.
- `handoffd.bb` on origin/main has not changed since 00:40Z (no land
  touched it), so a sync onto today's origin/main from that point
  carries only BL-1653's hunks.

## Ruling

1. Land BL-1653 FIRST, from its own approval point, not the shared tip:
   in the QA checkout, branch from `9792341072` (or `da9ca51aff`), merge
   `origin/main` onto it immediately (the plain sync merge the BL-1241
   step requires - it carries nothing of BL-1652, which is not on main),
   run `bb swarmforge/scripts/land_step_cli.bb BL-1653 <that sync commit>`,
   land the `LAND_REPLAY` commit, record the land-approvals line and
   `abandoned_commits: [<cited commit>]` on BL-1653 as the LAND_REPLAY
   item requires. Expect `ENTANGLED_SIBLING BL-1650` only (its bounced
   commits are ancestors) and no PASSENGER line.
2. Then land BL-1652 from the CURRENT QA tip synced onto the new
   origin/main as usual: its `handoffd.bb` differs from main by exactly
   its own hunks once BL-1653's are landed, `lane_process_lib.bb` is its
   own path, and the boot check passes. `LANDED_SIBLING BL-1653` (or, if
   main's tool misreads a merge-carried sibling as ENTANGLED - BL-1650's
   blind spot - an informational line; the replay is landable on its own
   contract). Record its land-approvals line and `abandoned_commits`.
3. No companion path in either land. Attribution stays exact: every
   line lands under the ticket that wrote it.
4. Neither ticket is bounced or amended. This was a Concurrent Work
   Orthogonality miss at promotion: BL-1653's spec named
   `commit_integrity_lib.bb`, `briefing_email_lib.bb` and
   `master_main_reconcile_lib.bb`, and its scenario-05 fix reached into
   `handoffd.bb`, which BL-1652's spec did name. The coordinator could
   not see it from the tickets. Recorded for the closing-ceremony pass;
   one instance, no mint.

## Rule for the next instance

Two approved, unlanded siblings that share a whole-file path land in
arrival order, the older from its own approval point synced onto
origin/main, never from the shared tip - added to QA.prompt's BL-1241
step 1 in the commit that lands this file.

By specifier.
