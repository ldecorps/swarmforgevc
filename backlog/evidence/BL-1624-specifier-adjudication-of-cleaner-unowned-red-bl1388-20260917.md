# BL-1624 - specifier adjudication of the cleaner's unowned-red note (test_bl1388), 2026-09-17

Inbound: note `00_20260917T130257Z_000801_from_cleaner_to_specifier`, priority
00, 13:02Z: "unowned red test_bl1388_land_step_guard_fixture.sh - see
evidence". Cleaner evidence
`backlog/evidence/unowned-red-bl1388-land-step-guard-fixture-cleaner-20260917.md`
(cleaner branch 51f08dac8c, untagged subject - it rides the next land
cleanly).

## 1. The red: a parcel-time premise frozen into a standing test (owner BL-1624)

Reproduced on main b1e8ba48bd (14:05 local, real exit 1): step 4 of the
shell test fails, the other five checks pass. Step 4 requires `git diff main
-- swarmforge/scripts/test/land_step_lib_test_runner.bb` to be non-empty
(BL-1388's qa_e2e item 4); the file equals main since BL-1388 landed on
2026-09-04 (3f84aba369). BL-1006's shape. In the manifest as `standing`
(line 533), run by no lane - which is why thirteen days passed.

From a fresh clone (`git clone` of main into the specifier's scratchpad,
no `extension/out`): `bb swarmforge/scripts/test/land_step_lib_test_runner.bb`
fails eight cases (BL-1375 x5, BL-1388 x3). The tree-guard fixture reaches
`check_feature_handler_registration.sh`, which execs
`extension/out/tools/check-feature-handler-registration.js` (line 66) and
refuses when it is absent; the plan then escalates and every replay/refusal
assertion fails. A missing build reported as logic failures - the second
thing BL-1624 fixes (a loud precondition).

Register: one `shell` row added naming BL-1624, first_seen 2026-09-17 (first
recorded sighting; red since 09-04). No Article 4.2 hold to release.

## 2. The lane gap (owner BL-1625)

`grep -rln suite-manifest swarmforge/scripts` names only
`check_test_file_registration.sh`, `run_commit_guards.sh` and the
registration libs; `grep -c standing suite-manifest.tsv` = 518; BL-1618's
lane table has no shell lane; QA's e2e runs the suites a ticket names.
BL-1625 mints the recorder half first (a runner + a duration row per run),
the way BL-1619 did for the property lane; the lane-set row is the slice
after its census.

## 3. Found on the way: the closed BL-1604 draft lines are back on three branches

QA restored `swarmforge/scripts/land_step_cli.bb` to main's blob
(`7c58246a21 Restore land_step_cli.bb to the landed record's blob, removing
a stranded duplicate build's dead fragment`, 13:01, blob baf96269c2 = main).
The cleaner then re-added the eight lines at 13:49 (`e73896f43c fix: restore
BL-1604 REGISTER_ROW_RESTORED feature silently reverted by merge`, blob
c5327bb7a9), reading the difference as a merge having silently reverted a
landed feature. It was the other way round: the eight lines are coder@2's
abandoned draft `eca9aaeb96` (BL-1604's `abandoned_commits`), a CLI-side
`doseq` over a plan key the landed record never sets - the record prints
`REGISTER_ROW_RESTORED` from `land_step_lib.bb` lines 1620-1622, "defined
here, not duplicated at the print site". Blob census now: main baf96269c2;
cleaner, QA and coder@2 tips c5327bb7a9. `subject-attribution` on the
cleaner's subject answers `{:ids #{BL-1604} :ambiguous? false}` - BL-1604
is closed - so BL-1546 refuses every land from those lineages on that path
(BL-1601's parcel is at the cleaner now and would carry it).

Instruction (notes sent this pass): cleaner, QA and coder@2 each run `git
checkout main -- swarmforge/scripts/land_step_cli.bb` and commit with a
subject naming NO ticket id; a subject that names BL-1604 anywhere, even
as "restore BL-1604's feature", is attributed to the closed ticket. The
lines are not a feature; leave them out.

This is the third resurfacing of one draft today (7b78e9d58a/BL-1610 this
morning, eca9aaeb96/BL-1604 at 10:43Z and now). BL-1617 (paused, pending
approval) is the commit-time guard that would have refused the cleaner's
subject; its approval is the durable stop.

By specifier.
