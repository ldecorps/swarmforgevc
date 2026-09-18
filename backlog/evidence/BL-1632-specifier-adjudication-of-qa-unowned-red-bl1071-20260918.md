# BL-1632 - specifier adjudication of QA's unowned red, bl1071, 2026-09-18

Inbound: QA note 00_20260918T080420Z_002906_from_QA (priority 00, to
specifier and coordinator), "BL-1614 held: unowned red
bl1071RecoveryBoundedInTime.property.test.js". QA evidence
`backlog/evidence/BL-1614-qa-unowned-red-bl1071-20260917.md` (QA branch
6392e8c63d); hold record `.worktrees/QA/.swarmforge/qa-holds/BL-1614.json`
naming parcel d5f41ac50d and the one red path.

## QA's text, verbatim

```
FAIL  test/bl1071RecoveryBoundedInTime.property.test.js > BL-1071/BL-654 invariant 2: a recovery that never returns is bounded, reported unfinished, and leaves nothing behind
AssertionError: a grandchild survived the kill (plain): 2 stray hangs before, 0 after

'0' !== '2'

Expected: "2"
Received: "0"

 ❯ test/bl1071RecoveryBoundedInTime.property.test.js:123:12
```

Solo re-run by QA, same commit, same host: 2/2 green in 8.47 s. A second
vitest lane from `.worktrees/coder2` was alive during the full-lane run
(QA, `pgrep -fl vitest` + `/proc/<pid>/cwd`).

## Reading

- Not a timeout (BL-1606/BL-1621 shape), not a temp-root sweep (BL-1623
  shape): an assertion on a HOST-WIDE process count. The probe at lines
  73-79 is `pgrep -f '[s]leep 3600' | wc -l`; `before` is read at line 87
  before the draw's sweep starts its hang, `after` at line 122 after the
  sweep's bounded kill; line 123 asserts `after === before`.
- "2 before, 0 after" means two processes carrying `sleep 3600` existed on
  the host before this draw had started anything (a fresh mkdtemp fixture
  cannot own them) and were gone after. Nothing of this draw survived; a
  peer's hangs left. The message names the opposite of what happened. The
  mirror case (0 before, N after) fires when a peer STARTS a hang during
  the draw and would also name a "surviving grandchild" that is someone
  else's process.
- The file is unchanged since it landed 2026-08-23 (e80ceab3e3); nothing
  on the BL-1614 branch touches it, its helper, or the sweep. Not a
  BL-1071 regression: every draw bounded, reported unfinished, left
  nothing of its own.
- Register (`backlog/standing-reds.tsv`) and allowlist
  (`swarmforge/scripts/property_suite_standing_allowlist.tsv`) carried no
  row for the file; no open ticket names it. First sighting.

## Census of peers that spawn the bare marker

`grep -rln "sleep 3600" extension/test specs/pipeline/steps swarmforge/scripts/test`
at 7c69a92ee7 - 15 files:

- extension/test/bl1071RecoveryBoundedInTime.property.test.js (this file;
  a second copy of the property lane on the host runs it too)
- extension/test/bl1370WorktreeStrayCheck.property.test.js (fixture-table
  string only, spawns nothing)
- specs/pipeline/steps/bl1071BabysitterSweepSurvivalSteps.js (the same
  grandchild shape, acceptance lane)
- specs/pipeline/steps/bl1021SubprocessOutlivesWaitBoundSteps.js
- specs/pipeline/steps/bl1103OneSharedBoundedRunnerSteps.js
- specs/pipeline/steps/bl967HandoffdCycleStallSteps.js
- specs/pipeline/steps/expeditorOfflineSingleTicketPipelineSteps.js
- swarmforge/scripts/test/test_handoffd_supervisor_job_reaper.sh
- swarmforge/scripts/test/test_babysitter_check.sh
- swarmforge/scripts/test/test_lifecycle_script_scope.sh
- swarmforge/scripts/test/process_table_lib_test_runner.bb
- swarmforge/scripts/test/bl887_scope_predicate_invariants_property_runner.bb
- swarmforge/scripts/test/test_expedite_cli.sh
- swarmforge/scripts/test/expedite_fixture.sh
- swarmforge/scripts/test/bounded_run_lib_test_runner.bb

Any of them alive across a draw's two samples flips the verdict. The
sole consumer of the count is this file's probe; scoping the probe to the
fixture makes every peer irrelevant without touching any of them.

## Marker demonstration on this host (bash 5.2.21, Linux)

A script file shaped like the fixture's grandchild hang, in a mkdtemp
root, each `sleep 3600` (3 s here) run as
`exec -a "bl1071-hang:$(dirname "$0")" sleep ...`:

```
marked for this root: 2   (expect 2: child + grandchild)
  pid 17348 comm=sleep cmdline=[bl1071-hang:/tmp/tmp.B9CElsf28Y 3 ]
  pid 17350 comm=sleep cmdline=[bl1071-hang:/tmp/tmp.B9CElsf28Y 3 ]
bare ^sleep 3$ host-wide: 1   (expect 0 from ours)
a different root sees: 0   (expect 0)
after exit: 0
```

The one bare `sleep 3` counted host-wide was an unrelated process alive on
this host during the pass - the pollution in one line. A first attempt
that passed the marker through `bash -c '... pgrep -f "<marker>" ...'`
counted 4: the shell wrappers whose own argv carried the literal matched
themselves. The ticket names that trap (invoke pgrep with no shell
wrapper; pgrep never reports itself).

## Decision

Mint BL-1632 (`type: defect`, `severity: high`, standing-red rule
2026-09-05), owner of the red; one `property` row in
`backlog/standing-reds.tsv` (first_seen 2026-09-17) and the allowlist
mirror row, both in the mint commit; resume note to QA (merge main first
so the hold's release reads the row from its own worktree - qa_hold_lib
reads `<root>/backlog/standing-reds.tsv` and `<root>/backlog/{paused,active}`)
and a paused-ready note to the coordinator.

No solo re-run by the specifier: QA's 8.47 s measurement stands, a
12-worker vitest lane was alive at 1-minute load 12.03 during this pass,
and running THIS file beside a live lane would perturb that lane's own
bl1071 draw - the defect itself (BL-1618, one verification command per
role).

By specifier.
