# BL-1408: the fourth hand-written copy of the chain list — test_pipeline_code_on_main_guard.sh (specifier, 2026-09-06)

Trigger: coder `note`, priority 00, 2026-09-06T11:56Z, from the BL-1444
parcel: "unowned red: test_pipeline_code_on_main_guard.sh case02 fails
(BL-1408 gap)". Handled under the standing-red rule (2026-09-05): an
unowned red gets an owner at severity high the same pass and a register
row naming it.

## Reproduction on main at 6d4c5ed641 (12:0xZ)

`bash swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh`:

```
PASS: 01: a non-QA commit touching pipeline code on main is refused
.../commit_guard_chain_lib.sh: line 33: .../check_handler_module_graph.sh: No such file or directory
.../commit_guard_chain_lib.sh: line 33: .../check_bb_scripts_load.sh: No such file or directory
.../commit_guard_chain_lib.sh: line 33: .../check_standing_red_register.sh: No such file or directory
.../commit_guard_chain_lib.sh: line 33: .../check_constitution_doc_citations.sh: No such file or directory

pre-commit: COMMIT REFUSED. Guards reporting a violation: check_handler_module_graph.sh check_bb_scripts_load.sh check_standing_red_register.sh check_constitution_doc_citations.sh
pre-commit: these guards did not refuse cleanly - they failed unexpectedly (a crash, a missing script, or any non-refusal exit): check_handler_module_graph.sh (exit 127) check_bb_scripts_load.sh (exit 127) check_standing_red_register.sh (exit 127) check_constitution_doc_citations.sh (exit 127)
FAIL: 02: expected the QA role to be allowed to commit extension/src/ on main
```

## Mechanism

The test builds its fixture by copying each guard and lib it knows about
(lines 33-46 and 55, eleven `cp` lines) and then copies the REAL
`run_commit_guards.sh` and both hooks beside them (lines 43, 56, 57). The
runner names four guards the copy set lacks, added 09-04 (BL-1385,
BL-1395), 09-05 (BL-1428) and 09-06 (BL-1440). `run_guard` execs
`$GUARD_DIR/<name>`, so each missing guard exits 127 and the chain refuses
every commit the fixture attempts. Case 01 expects a refusal and passes by
coincidence; case 02 expects the QA role to be allowed and fails; the
test's `fail` exits, so 03-07 and the BL-925 cases never run.

Red since 2026-09-04 (`9121b628c9`, the runner gaining
`check_handler_module_graph.sh`). A `standing` row in `suite-manifest.tsv`
(line 388).

## Disposition

Owner: BL-1408 by amendment, not a new ticket. BL-1408 is the sweep of
every hand-written copy of the chain list ("so there is no fourth"), and
its description had excluded this file by a wrong reading ("reference one
guard for their own reasons") - `cp` lines naming each guard are the list
in another shape. Amended: title, a wiring anchor on the file, a "Since
mint" item, e2e steps, and scenario 04 in the feature file (a mirror of
scenario 01 for this test). The feature change re-pends `human_approval`
deliberately; the original approval is 74012e2058 and the three approved
scenarios are unchanged.

Register row: lane `shell`, file
`swarmforge/scripts/test/test_pipeline_code_on_main_guard.sh`, ticket
BL-1408, first_seen 2026-09-04.

Not duplicates (checked): BL-1398 (done; the BL-632 property fixture),
BL-1401 (done; the BL-632 acceptance handler), BL-1424 (paused; manifest
registration of ADDED test files, not chain lists), BL-1314 (done; this
file's BL-925 ancestry grep, a different pin).

## Side effect on BL-1444 (active, coder)

BL-1444 adds `run_guard check_art_director_tip.sh` to the pre-merge-commit
hook. `test_pre_merge_commit_hook.sh`'s `MERGE_GUARDS` (green today) and
this file's `cp` list (already red) both lack it. BL-1444 was amended the
same pass to hand-add the guard to both, recorded as the sixth and seventh
hand edits, which BL-1408's landing removes with the lists themselves.
