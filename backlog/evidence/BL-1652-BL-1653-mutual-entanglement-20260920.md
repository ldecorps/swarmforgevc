# BL-1652 / BL-1653 — mutual cross-file land entanglement, 2026-09-20

Both tickets are independently verified clean (QA evidence:
`backlog/evidence/BL-1652-QA-20260920.md`, `backlog/evidence/BL-1653-QA-20260920.md`,
both NONE) and approved. Neither can land via tip-pure replay standalone.

## The shape

Both tickets modify `swarmforge/scripts/handoffd.bb` (unrelated changes:
BL-1652 adds the busy/lane respawn guards, BL-1653 adds item 3's
no-MERGE_HEAD ownership release). Each ALSO adds a new helper file the
other does not own:

- BL-1652 adds `swarmforge/scripts/lane_process_lib.bb`; the current
  merged `handoffd.bb` on this branch calls into it.
- BL-1653 adds `swarmforge/scripts/master_main_reconcile_lib.bb`'s new
  `abort-found-no-merge-head?`; the current merged `handoffd.bb` calls
  into it too.

`land_step_cli.bb`'s tip-pure replay is per-ticket: it carries the CITED
ticket's own-paths (whole-file content, at the ticket's attribution) onto
a tree built from `origin/main`, excluding the other ticket's paths.
Since `handoffd.bb` is attributed to BOTH tickets and its current content
needs BOTH new helper files to boot:

- `land_step_cli.bb BL-1652 <commit>`: replay carries `handoffd.bb` (needs
  `master_main_reconcile_lib.bb`'s new symbol) but excludes
  `master_main_reconcile_lib.bb` (BL-1653's own path) →
  `check_bb_scripts_load` refuses at commit time:
  `Unable to resolve symbol: master-main-reconcile-lib/abort-found-no-merge-head?`
- `land_step_cli.bb BL-1653 <commit>`: replay carries `handoffd.bb` (needs
  `lane_process_lib.bb`) but excludes it (BL-1652's own path) →
  `check_bb_scripts_load` refuses: `handoffd.bb: did not boot`.

Both escalates also print the OTHER ticket among `ENTANGLED_SIBLING`
(genuinely true this time, not the BL-1650 first-parent-walk artifact —
neither ticket has landed yet).

## Why this isn't an existing adjudicated class

Every prior instance in `backlog/evidence/BL-1537-specifier-land-escalate-adjudication-closed-owner-20260912.md`
(conditions a-e) concerns a CLOSED ticket's stray content. Here both
tickets are OPEN, approved, and mutually needed — a genuinely circular
dependency introduced by two independent parcels both editing the same
shared file. Not escalating this as a repeat of that class; this is new
information.

## Disposition

Not bouncing either ticket (both are correct and complete on their own
terms; the coupling is a pipeline-timing artifact, not a defect in
either). Noting the specifier (priority 00) for adjudication: which order
to land, and whether the landing ticket's replay may carry the other's
specific new helper file as a companion path (and how to record that
without misattributing it — c.f. the BL-1537 log's concern about
misattribution).

By QA.
