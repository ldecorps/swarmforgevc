# BL-911-rotation-recomposes-the-role-prompt — QA bounce

QA ran the full gate inventory (Article 4.4 — complete pass, one bounce).
Every gate below was RUN, not assumed. Only D1 is a real defect; everything
else is recorded PASS/BLOCKED-BY-NONE for the record.

## D1 — unit: new `load-file` dependency not added to the BL-814 fixture's known-dependency list

1. **Failing command** (from `extension/`, run standalone with no concurrent
   test process, to rule out resource contention — see Non-vacuity note
   below):
   ```
   npx vitest run test/readLiveRoleHeldTicketsCli.test.js
   ```
   Also reproduced via the full `npm test` run (two independent full runs,
   one contaminated by concurrent commands, one clean — same 3 failures in
   both).
2. **Commit hash**: `18d993c339` (documenter's `merge_and_process` commit,
   citing lineage — `git merge-base --is-ancestor 8d7fcebbc HEAD` and
   `...818bd3826 HEAD` both confirmed true; this commit contains BL-911's own
   coder/hardener work, not a sibling ticket's).
3. **First error excerpt**:
   ```
   FAIL  test/readLiveRoleHeldTicketsCli.test.js > BL-487: reports a role-held ticket computed LIVE from the real in_process mailbox - no cache file involved at all
   RoleHeldTicketsComputationFailedError: readLiveRoleHeldTickets: pipeline_stage_cli.bb report did not produce a result: Command failed: bb .../swarmforge/scripts/pipeline_stage_cli.bb .../report
   ----- Error --------------------------------------------------------------------
   Type:     java.io.FileNotFoundException
   Message:  .../swarmforge/scripts/prompt_engine_lib.bb (No such file or directory)
   Location: .../swarmforge/scripts/handoff_lib.bb:36:1
   ----- Context ------------------------------------------------------------------
   32: ;; list is empty) - loaded here so recompose-role-prompt! below can reuse
   33: ;; PromptEngine's compose (the single composition authority, BL-546) rather
   34: ;; than growing a second composer. Same double-load-is-harmless shape as
   35: ;; ambulance-lib/mono-router-lib above.
   36: (load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "prompt_engine_lib.bb")))
   ```
   Same shape for all 3 failing tests in the file (fixture-root variants:
   plain, stale-cache, no-roles.tsv).
4. **Failure class**: `unit`.
5. **Expected vs observed**: Expected `readLiveRoleHeldTickets` to compute
   the live role-held map by shelling out to the real
   `pipeline_stage_cli.bb report` against the test's isolated fixture root
   (this file's whole reason for existing per its own header comment —
   "the REAL ... subprocess, never mocked"). Observed: the subprocess itself
   throws, because `handoff_lib.bb`'s new top-level
   `(load-file ... "prompt_engine_lib.bb")` (added by this ticket's coder
   pass, `swarmforge/scripts/handoff_lib.bb:36`) has no corresponding file in
   the fixture's copied script set — `extension/test/readLiveRoleHeldTicketsCli.test.js`'s
   `REQUIRED_SCRIPT_FILES` list (line 25) still reads
   `['pipeline_stage_cli.bb', 'pipeline_stage_lib.bb', 'handoff_lib.bb', 'ambulance_lib.bb', 'mono_router_lib.bb']`
   — `prompt_engine_lib.bb` is missing from it.

   This is the exact recurring defect class the test file's own comments
   (lines 17-24) name and warn about by history: "BL-655 added
   ambulance_lib.bb, BL-805 added mono_router_lib.bb — both times this copy
   list went stale and the fixture missed it." BL-911 is the third
   recurrence — a new `load-file` dependency landed in `handoff_lib.bb`
   without the sibling fixture list being updated to match.

   **Remediation pointer**: add `'prompt_engine_lib.bb'` to
   `REQUIRED_SCRIPT_FILES` in `extension/test/readLiveRoleHeldTicketsCli.test.js:25`.
   Owning role: **coder** (the role whose commit, `818bd3826`, introduced the
   new `load-file` call that this fixture list needed to track).

## Everything else run — complete inventory, none blocked

- **Compile** (`npm run compile` in `extension/`): PASS, clean.
- **Unit suite** (`npm test` in `extension/`, standalone, no concurrent
  process): 435/437 files pass, 7729/7733 tests pass. The only other
  failure — `test/bounceDrain.test.js > startGracefulBounceFileWatcher
  detects a bounce-graceful file and deletes it` (20s timeout on a real
  `fs.watch` event) — re-ran that file alone (`npx vitest run
  test/bounceDrain.test.js`): 21/21 PASS. Confirmed host-load flake (this
  host was also running two other full test passes back to back plus a
  contaminated first attempt with concurrent bb/acceptance runs); not
  reproducible in isolation, not this ticket's code (file untouched by this
  parcel's diff), not recorded as a defect.
- **Property suite** (`npm run test:properties`): 98/98 files, 306/306
  tests PASS. The 3 "Unhandled Error: [vitest-worker]: Timeout calling
  onTaskUpdate" lines are worker-RPC noise under host load, not test
  failures — Test Files/Tests counts both show 0 failed.
- **Acceptance** (`specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-911-rotation-recomposes-the-role-prompt.feature`): 7/7
  scenarios PASS.
- **BL-911 own unit runner** (`bb
  swarmforge/scripts/test/bl911_rotation_recompose_test_runner.bb`): ALL
  TESTS PASSED.
- **BL-911 own fixture script** (`bash
  swarmforge/scripts/test/test_rotate_recomposes_role_prompt.sh`): 4/4 PASS.
- **BL-805 regression gate** (`bash
  swarmforge/scripts/test/test_rotate_to_role_stuck_parcel_gate.sh`): 8/8
  PASS — correctly exercises the new no-metadata-sidecar degrade path
  (prints the expected WARNING, still rotates).
- **Wiring**: confirmed both named rotation drivers actually call the new
  code — `rotate-resident-to!` (`handoff_lib.bb:735`) calls
  `recompose-role-prompt!` before the pane respawn; both
  `respawn-as!`/`rotate_to_role.bb`'s resident path (`handoff_lib.bb:780`)
  and `handoffd.bb`'s daemon chase (`handoffd.bb:1336`) call
  `rotate-resident-to!` directly — the single chokepoint the ticket's "How"
  section named.
- **Docs currency**: `Specification.MD` and
  `swarmforge/handoff-protocol.md`'s new BL-911 section both read accurate
  against the actual diff — chokepoint, invariant 2 degrade behavior, scope
  (two named drivers, `respawn-self!` explicitly out of scope per the
  architect's own follow-up note), and out-of-scope items all match.
- **Orphaned processes**: checked before and after
  (`pgrep -fl 'node --test|stryker|vitest'`) — none, both times.

## Non-vacuity

The first `npm test` run was contaminated by QA itself running other test
processes (bb runners, `run_acceptance.sh`) concurrently in the same
window — a mistake per this role's own "no test running on top of a
leftover run" rule. Re-ran standalone with zero concurrent commands;
`readLiveRoleHeldTicketsCli.test.js`'s 3 failures reproduced identically
both times (same FileNotFoundException, same 3 test names), confirming
they are not contention artifacts. `bounceDrain.test.js`'s single flake did
NOT reproduce in isolation, confirming it IS a contention/host-load
artifact and correctly excluded from this bounce.

By QA.
