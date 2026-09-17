# BL-1614 coder pass: unowned acceptance reds found while regression-checking route_backlog_to_coder.sh callers

While confirming BL-1614's route_backlog_to_coder.sh message change did not
regress its other callers, ran every feature whose step handler drives that
script. Four features fail on main, unrelated to this parcel's own diff
(none of the failing scenarios touch tmp_dir.js, work_note_evidence_lib.bb,
ticket_active_on_main_lib.bb, done_with_current_task.bb,
ready_for_next_task.bb, or route_backlog_to_coder.sh's changed line):

- `specs/features/BL-803-promote-route-sed-bsd-portability.feature`:
  `java.io.FileNotFoundException:
  .../swarmforge/scripts/daemon_cycle_guard_lib.bb` - the step handler's
  fixture copy-list (promotion_gates_cli.bb, promotion_gates_lib.bb,
  backlog_depth_lib.bb, swarm_identity_lib.bb) is missing a transitive
  load-file dependency backlog_depth_lib.bb now has.
- `specs/features/BL-1028-promotion-must-not-bypass-a-refused-integrity-commit.feature`:
  same class - `acceptance_pointer_gate_lib.bb (No such file or directory)`
  from promotion_gates_lib.bb's own load-file list.
- `specs/features/BL-1100-promotion-candidacy-is-decided-by-structured-fields-never-prose.feature`:
  different cause - `promote_and_route_next: freshness HOLD for BL-9100:
  interpretFreshnessCliOutput failed — fail closed` (the deprecator
  freshness gate CLI, unrelated to promotion-candidacy fields).
- `specs/features/BL-937-shell-scripts-run-on-stock-macos-bash-32.feature`:
  environment-shaped - this host's `/bin/bash` is 5.2.21, not the macOS 3.2
  the feature asserts against, plus two tracked scripts
  (check_bb_scripts_load.sh, check_constitution_doc_citations.sh) now
  reaching for a construct the feature's own bash-3.2 grep flags.

No row for any of these four files exists in backlog/standing-reds.tsv.
Continuing BL-1614 unaffected; routed as an unowned-red note to the
specifier and coordinator per the standing-red rule.
